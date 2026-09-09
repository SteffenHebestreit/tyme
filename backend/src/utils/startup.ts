/**
 * @fileoverview Startup Initialization Script
 * 
 * Runs on application startup to initialize system resources
 * - Initialize existing Keycloak users (create storage buckets)
 * - Verify system health
 * 
 * @module utils/startup
 */

import { userInitializationService } from '../services/auth/user-initialization.service';
import { keycloakService } from '../services/keycloak.service';
import { logger } from './logger';
import { getDbClient } from './database';
import { ensureMigrationLedger, hasRun, markAsRun, runOnce } from './migrations';
import { resyncCurrentProjectRates } from '../services/business/project-rate-scheduler.service';
import fs from 'fs';
import path from 'path';

/**
 * Initialize all existing users from Keycloak
 * Creates storage buckets for users who don't have them yet
 */
async function initializeExistingUsers(): Promise<void> {
  try {
    logger.info('[Startup] Starting user initialization...');

    // Get all users from Keycloak
    const users = await keycloakService.getAllUsers();

    if (!users || users.length === 0) {
      logger.info('[Startup] No users found in Keycloak, skipping initialization');
      return;
    }

    logger.info(`[Startup] Found ${users.length} users in Keycloak`);

    // Map to required format
    const usersToInit = users.map((user: any) => ({
      id: user.id,
      email: user.email || `${user.username}@example.com`,
      username: user.username || user.id,
    }));

    // Initialize users (this won't fail the startup even if some users fail)
    const result = await userInitializationService.initializeExistingUsers(usersToInit);

    logger.info(
      `[Startup] User initialization complete: ${result.success} succeeded, ${result.failed} failed`
    );
  } catch (error) {
    logger.error('[Startup] Error during user initialization:', error);
    // Don't throw - startup should continue even if initialization fails
    logger.warn('[Startup] User buckets will be created on-demand when users upload files');
  }
}

/**
 * Ensure backup system tables exist
 * Creates system_backups and system_backup_schedule tables if missing
 * This is critical after a database restore operation
 */
async function ensureBackupTablesExist(): Promise<void> {
  const db = getDbClient();
  
  try {
    logger.info('[Startup] Checking backup system tables...');

    // Check if tables exist
    const checkQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'system_backups'
      ) as backups_exists,
      EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'system_backup_schedule'
      ) as schedule_exists;
    `;
    
    const result = await db.query(checkQuery);
    const { backups_exists, schedule_exists } = result.rows[0];

    if (backups_exists && schedule_exists) {
      logger.info('[Startup] ✓ Backup system tables already exist');
      return;
    }

    logger.warn('[Startup] Backup system tables missing, creating them...');

    // Create system_backups table
    if (!backups_exists) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_backups (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          backup_name VARCHAR(255) NOT NULL,
          backup_type VARCHAR(50) NOT NULL CHECK (backup_type IN ('manual', 'scheduled', 'auto')),
          status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
          backup_path TEXT,
          file_size_bytes BIGINT,
          includes_database BOOLEAN DEFAULT true,
          includes_storage BOOLEAN DEFAULT true,
          includes_config BOOLEAN DEFAULT false,
          started_by VARCHAR(255),
          started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP WITH TIME ZONE,
          error_message TEXT,
          metadata JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_system_backups_status ON system_backups(status);
        CREATE INDEX IF NOT EXISTS idx_system_backups_started_at ON system_backups(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_system_backups_backup_type ON system_backups(backup_type);
      `);
      logger.info('[Startup] ✓ Created system_backups table');
    }

    // Create system_backup_schedule table
    if (!schedule_exists) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_backup_schedule (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          schedule_name VARCHAR(255) NOT NULL,
          cron_expression VARCHAR(100) NOT NULL,
          backup_type VARCHAR(50) NOT NULL DEFAULT 'scheduled',
          is_enabled BOOLEAN NOT NULL DEFAULT true,
          retention_days INTEGER DEFAULT 30,
          includes_database BOOLEAN DEFAULT true,
          includes_storage BOOLEAN DEFAULT true,
          includes_config BOOLEAN DEFAULT false,
          last_run_at TIMESTAMP WITH TIME ZONE,
          last_run_status VARCHAR(50),
          next_run_at TIMESTAMP WITH TIME ZONE,
          created_by VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_system_backup_schedule_enabled ON system_backup_schedule(is_enabled);
        CREATE INDEX IF NOT EXISTS idx_system_backup_schedule_next_run ON system_backup_schedule(next_run_at);
      `);
      logger.info('[Startup] ✓ Created system_backup_schedule table');
    }

    logger.info('[Startup] ✓ Backup system tables initialized successfully');
    
    // Rescan backups directory to register any existing backups
    await rescanBackups();
    
  } catch (error) {
    logger.error('[Startup] Error ensuring backup tables exist:', error);
    // Don't throw - startup should continue
  }
}

/**
 * Scan backups directory and register any existing backups in the database
 * This is crucial after a database restore to repopulate backup records
 */
async function rescanBackups(): Promise<void> {
  const db = getDbClient();
  
  try {
    logger.info('[Startup] Scanning backups directory...');
    
    const backupsDir = path.join(process.cwd(), 'backups');
    
    // Check if backups directory exists
    if (!fs.existsSync(backupsDir)) {
      logger.info('[Startup] No backups directory found, skipping rescan');
      return;
    }
    
    // Get all directories in backups folder
    const entries = fs.readdirSync(backupsDir, { withFileTypes: true });
    const backupDirs = entries.filter(entry => entry.isDirectory());
    
    if (backupDirs.length === 0) {
      logger.info('[Startup] No backup directories found');
      return;
    }
    
    logger.info(`[Startup] Found ${backupDirs.length} backup directories`);
    
    let registered = 0;
    let skipped = 0;
    
    for (const dir of backupDirs) {
      const backupName = dir.name;
      const backupPath = path.join(backupsDir, backupName);
      
      // Check if backup already exists in database
      const existing = await db.query(
        'SELECT id FROM system_backups WHERE backup_name = $1',
        [backupName]
      );
      
      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }
      
      // Find the tar.gz file
      const files = fs.readdirSync(backupPath);
      const tarFile = files.find(f => f.endsWith('.tar.gz'));
      
      if (!tarFile) {
        logger.warn(`[Startup] No tar.gz file found in ${backupName}`);
        continue;
      }
      
      const tarFilePath = path.join(backupPath, tarFile);
      const stats = fs.statSync(tarFilePath);
      const fileSize = stats.size;
      
      // Extract timestamp from backup name (format: backup_YYYYMMDD_HHMMSS)
      const timestampMatch = backupName.match(/(\d{8}_\d{6})/);
      let backupTimestamp = new Date();
      
      if (timestampMatch) {
        const ts = timestampMatch[1];
        const year = ts.substring(0, 4);
        const month = ts.substring(4, 6);
        const day = ts.substring(6, 8);
        const hour = ts.substring(9, 11);
        const minute = ts.substring(11, 13);
        const second = ts.substring(13, 15);
        backupTimestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
      }
      
      // Determine backup type (manual if no schedule info found)
      const backupType = 'manual';
      
      // Insert backup record
      await db.query(`
        INSERT INTO system_backups (
          backup_name,
          backup_type,
          status,
          backup_path,
          file_size_bytes,
          includes_database,
          includes_storage,
          includes_config,
          started_at,
          completed_at,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        backupName,
        backupType,
        'completed',
        backupPath,
        fileSize,
        true,
        true,
        false,
        backupTimestamp,
        backupTimestamp,
        backupTimestamp
      ]);
      
      registered++;
      logger.info(`[Startup] ✓ Registered backup: ${backupName} (${fileSize} bytes)`);
    }
    
    logger.info(`[Startup] Backup rescan complete: ${registered} registered, ${skipped} skipped`);
    
  } catch (error) {
    logger.error('[Startup] Error rescanning backups:', error);
    // Don't throw - startup should continue
  }
}

/**
 * Apply additive, idempotent schema upgrades for features added after the
 * initial schema. All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
 * so they are safe to run on every startup and never drop or modify data.
 */
async function ensureSchemaUpgrades(): Promise<void> {
  const db = getDbClient();

  try {
    logger.info('[Startup] Applying additive schema upgrades...');

    // Invoice/PDF locale preference (e.g. 'de', 'en'). Default 'de' preserves
    // existing German-formatted invoice behaviour.
    await db.query(
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_language VARCHAR(5) DEFAULT 'de'`
    );

    // Opt-in flag for emailing the account owner about newly-overdue invoices.
    await db.query(
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS overdue_reminders_enabled BOOLEAN DEFAULT false`
    );

    // Backup schedule last-run status (updateScheduleLastRun writes this column).
    // Without it, scheduled-backup metadata updates fail and retention cleanup is
    // silently skipped.
    await db.query(
      `ALTER TABLE system_backup_schedule ADD COLUMN IF NOT EXISTS last_run_status VARCHAR(50)`
    );

    // Composite index for the hottest time-entry access path: per-user,
    // per-project, date-ranged queries (summaries, patterns, back-fill checks).
    // The existing single-column indexes can't serve the combined filter well.
    await db.query(
      `CREATE INDEX IF NOT EXISTS idx_time_entries_user_project_date
       ON time_entries (user_id, project_id, entry_date)`
    );

    // Durable per-conversation AI state (sticky tool set) — survives restarts
    // so follow-up turns keep their context and the prompt prefix stays stable.
    await db.query(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS metadata JSONB`);

    // VAT number belonging to the separate billing address. Distinct from
    // clients.tax_id, which is the client entity's own tax ID.
    await db.query(
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_tax_id VARCHAR(100)`
    );

    // AI chat hot paths: the per-turn history window (ORDER BY created_at with
    // LIMIT) and the pending-approval lookups (metadata status filter) — both
    // grow with conversation age without these.
    await db.query(
      `CREATE INDEX IF NOT EXISTS idx_ai_messages_conv_created
       ON ai_messages (conversation_id, created_at)`
    );
    await db.query(
      `CREATE INDEX IF NOT EXISTS idx_ai_messages_pending
       ON ai_messages (conversation_id) WHERE metadata->>'status' = 'awaiting_approval'`
    );

    // Recurring invoice schedules (retainers). Each row is a template that the
    // recurring-invoice scheduler uses to generate draft invoices on a cadence.
    await db.query(`
      CREATE TABLE IF NOT EXISTS recurring_invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
        start_date DATE NOT NULL,
        end_date DATE,
        next_occurrence DATE,
        is_active BOOLEAN NOT NULL DEFAULT true,
        currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
        tax_rate_id VARCHAR(50),
        payment_terms_days INTEGER NOT NULL DEFAULT 30,
        invoice_headline VARCHAR(255),
        notes TEXT,
        line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
        last_generated_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_recurring_invoices_user ON recurring_invoices(user_id);
      CREATE INDEX IF NOT EXISTS idx_recurring_invoices_due
        ON recurring_invoices(is_active, next_occurrence)
        WHERE is_active = true;
    `);

    // Date-effective project hourly rates. Each row is the rate applying from
    // valid_from until the next row's valid_from; time entries stamp their rate
    // at creation, so editing a rate never re-prices already-logged work.
    await db.query(`
      CREATE TABLE IF NOT EXISTS project_rate_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        hourly_rate NUMERIC(10,2) NOT NULL CHECK (hourly_rate >= 0),
        valid_from DATE NOT NULL,
        note TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_project_rate_history_project_date
        ON project_rate_history(project_id, valid_from);
      CREATE INDEX IF NOT EXISTS idx_project_rate_history_user ON project_rate_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_project_rate_history_lookup
        ON project_rate_history(project_id, valid_from DESC);
    `);

    // Signed client documents (contracts and similar). A new version points at
    // the row it replaces; SET NULL so deleting one version never cascades the
    // rest of the chain away.
    await db.query(`
      CREATE TABLE IF NOT EXISTS client_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        document_type VARCHAR(50) NOT NULL DEFAULT 'contract'
          CHECK (document_type IN ('contract', 'amendment', 'nda', 'offer', 'order', 'invoice_terms', 'other')),
        file_url TEXT,
        file_filename VARCHAR(255),
        file_size INTEGER,
        file_mimetype VARCHAR(100),
        version INTEGER NOT NULL DEFAULT 1,
        supersedes_document_id UUID REFERENCES client_documents(id) ON DELETE SET NULL,
        signed_at DATE,
        valid_from DATE,
        valid_until DATE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_client_documents_user ON client_documents(user_id);
      CREATE INDEX IF NOT EXISTS idx_client_documents_client
        ON client_documents(client_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_client_documents_project
        ON client_documents(project_id) WHERE project_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_client_documents_supersedes
        ON client_documents(supersedes_document_id) WHERE supersedes_document_id IS NOT NULL;
    `);

    // Ledger for one-time DATA migrations (DDL above is idempotent by nature).
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        details JSONB
      )
    `);

    // Index exactly the rows the recurring rate repair looks for, so its cost is
    // proportional to the damage rather than to the table.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_time_entries_unstamped
        ON time_entries(project_id, entry_date)
        WHERE hourly_rate IS NULL AND project_id IS NOT NULL
    `);

    await enforceLinearDocumentVersions();

    logger.info('[Startup] ✓ Schema upgrades applied');
  } catch (error) {
    logger.error('[Startup] Error applying schema upgrades:', error);
    // Don't throw - startup should continue
  }
}

/**
 * Make "a document may be superseded at most once" a database invariant.
 *
 * Two concurrent uploads against the same predecessor both read its version and
 * both insert version+1 — a row lock on the predecessor cannot prevent it,
 * because the value being read is never the value anyone writes. The result is a
 * branched chain with duplicate versions, in which the UI silently hides one of
 * the signed documents.
 *
 * A partial UNIQUE index closes it for every writer, not just the ones that
 * remember to take a lock, and turns the race into a clean 23505.
 *
 * Runs in its own try/catch: ensureSchemaUpgrades is a single try block, so an
 * error raised here would skip every statement registered after it.
 */
async function enforceLinearDocumentVersions(): Promise<void> {
  const db = getDbClient();

  try {
    // Existing data may already contain branches, which would make the unique
    // index fail to build. Detach all but the earliest successor rather than
    // relinking them into a chain: relinking would assert that C replaces B when
    // the user never said so, and for signed contracts that is falsification.
    // A detached document simply becomes its own root — which is exactly how the
    // UI already renders it.
    const repaired = await db.query(`
      UPDATE client_documents d
      SET supersedes_document_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE d.supersedes_document_id IS NOT NULL
        AND d.id <> (
          SELECT keep.id FROM client_documents keep
          WHERE keep.supersedes_document_id = d.supersedes_document_id
          ORDER BY keep.version ASC, keep.created_at ASC, keep.id ASC
          LIMIT 1
        )
    `);

    if (repaired.rowCount) {
      logger.warn(
        `[Startup] ${repaired.rowCount} branched document version(s) detached into their own chains ` +
          'so version history could be made linear. No file was deleted.'
      );
    }

    // A NEW name on purpose: CREATE INDEX IF NOT EXISTS matches on the name, so
    // reusing idx_client_documents_supersedes would find the existing
    // NON-unique index and silently do nothing.
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_client_documents_supersedes
        ON client_documents(supersedes_document_id) WHERE supersedes_document_id IS NOT NULL
    `);
    await db.query(`DROP INDEX IF EXISTS idx_client_documents_supersedes`);

    // Post-condition: prove the index is actually there, unique and valid,
    // rather than trusting that no error means success.
    const check = await db.query(
      `SELECT i.indisunique AND i.indisvalid AS ok
       FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
       WHERE c.relname = 'uq_client_documents_supersedes'`
    );
    if (!check.rows[0]?.ok) {
      logger.error(
        '[Startup] uq_client_documents_supersedes is missing or not a valid unique index — ' +
          'concurrent document uploads can still create duplicate versions'
      );
    }
  } catch (error) {
    logger.error('[Startup] Could not enforce linear document versions:', error);
    // Don't throw - startup should continue
  }
}

/**
 * Name of the one-time rate seed. Never rename: the ledger keys on it.
 */
const RATE_SEED_MIGRATION = '2026_09_seed_project_rate_timelines';

/**
 * Give every project with a rate an opening period on its timeline — once, ever.
 *
 * This ran on every boot originally, guarded by "this project has no rate
 * history". That guard is a reversible state predicate, not an idempotency key:
 * deleting a project's last rate period made the next restart re-create it, so a
 * deliberate deletion silently came back. The ledger fixes that — the seed and
 * its ledger row commit together, and it never runs again.
 *
 * valid_from reaches back to the project's earliest time entry, so no logged
 * work falls into a period with no rate.
 */
async function seedProjectRateTimelines(): Promise<void> {
  // An install that already ran the old unguarded backfill has the work done but
  // no ledger row to prove it. Adopt it, or the first boot after this upgrade
  // would re-seed once more — exactly the resurrection being fixed.
  if (!(await hasRun(RATE_SEED_MIGRATION))) {
    const db = getDbClient();
    const existing = await db.query(`SELECT 1 FROM project_rate_history LIMIT 1`);
    if ((existing.rowCount ?? 0) > 0) {
      await markAsRun(RATE_SEED_MIGRATION, { adopted: true, reason: 'timeline already populated by a previous release' });
      logger.info('[Startup] Rate seed adopted as already applied (timeline was populated by an earlier release)');
      return;
    }
  }

  await runOnce(RATE_SEED_MIGRATION, async (client) => {
    const seeded = await client.query(`
      INSERT INTO project_rate_history (user_id, project_id, hourly_rate, valid_from, note)
      SELECT p.user_id,
             p.id,
             p.hourly_rate,
             COALESCE(
               LEAST(p.start_date, (SELECT MIN(te.entry_date) FROM time_entries te WHERE te.project_id = p.id)),
               p.start_date,
               (SELECT MIN(te.entry_date) FROM time_entries te WHERE te.project_id = p.id),
               p.created_at::date
             ),
             'Initial rate (migrated from project)'
      FROM projects p
      WHERE p.hourly_rate IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM project_rate_history h WHERE h.project_id = p.id)
      ON CONFLICT (project_id, valid_from) DO NOTHING
    `);

    return { projects_seeded: seeded.rowCount ?? 0 };
  });
}

/**
 * Stamp historical time entries that never captured a rate.
 *
 * Unlike the seed this is NOT one-time: entries can still be created unstamped
 * (TimeEntryService.create swallows a failed rate lookup rather than blocking
 * time tracking), and an unstamped entry is re-priced at the project's current
 * rate by invoicing. The partial index makes the pass cost an index scan over
 * exactly the broken rows, so running it forever is cheap and self-draining.
 *
 * time_entries has a BEFORE UPDATE trigger that rewrites updated_at, which would
 * make years of history look freshly edited. Suppressing it needs
 * session_replication_role — superuser-only — so it is attempted inside a
 * savepoint and simply skipped on a role that lacks the privilege.
 */
async function stampUnratedTimeEntries(): Promise<void> {
  const pool = getDbClient();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let triggersSuppressed = true;
    await client.query('SAVEPOINT before_trigger_suppression');
    try {
      await client.query(`SET LOCAL session_replication_role = replica`);
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT before_trigger_suppression');
      triggersSuppressed = false;
    }

    // Same rate resolution as ProjectRateService.getEffectiveRate: the period
    // covering the entry's date, else the earliest period ever agreed. Never
    // projects.hourly_rate — that is the denormalised CURRENT rate, and reading
    // it here would make the stamped value depend on when the repair happened to
    // run.
    const stamped = await client.query(`
      UPDATE time_entries te
      SET hourly_rate = COALESCE(
            (SELECT h.hourly_rate FROM project_rate_history h
             WHERE h.project_id = te.project_id AND h.valid_from <= te.entry_date
             ORDER BY h.valid_from DESC LIMIT 1),
            (SELECT h.hourly_rate FROM project_rate_history h
             WHERE h.project_id = te.project_id
             ORDER BY h.valid_from ASC LIMIT 1)
          )
      WHERE te.hourly_rate IS NULL
        AND te.project_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM project_rate_history h WHERE h.project_id = te.project_id)
    `);

    await client.query('COMMIT');

    if (stamped.rowCount) {
      logger.info(
        `[Startup] ✓ ${stamped.rowCount} time entr(ies) stamped from the rate timeline` +
          (triggersSuppressed ? '' : ' (updated_at refreshed — triggers could not be suppressed)')
      );
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('[Startup] Error stamping unrated time entries:', error);
    // Don't throw - startup should continue
  } finally {
    client.release();
  }
}

/**
 * Bring the rate timeline and everything derived from it up to date at boot.
 */
async function applyProjectRateMaintenance(): Promise<void> {
  try {
    await ensureMigrationLedger();
    await seedProjectRateTimelines();
    await stampUnratedTimeEntries();

    // A period scheduled for a date that has since arrived becomes the current
    // rate here, so a restart never leaves the displayed rate behind. Shares the
    // scheduler's implementation rather than duplicating the statement.
    const advanced = await resyncCurrentProjectRates();
    if (advanced > 0) {
      logger.info(`[Startup] ✓ ${advanced} project rate(s) advanced to a newly effective period`);
    }
  } catch (error) {
    logger.error('[Startup] Error during project rate maintenance:', error);
    // Don't throw - startup should continue
  }
}

/**
 * Run all startup initialization tasks
 */
export async function runStartupInitialization(): Promise<void> {
  try {
    logger.info('[Startup] Running startup initialization tasks...');

    // Ensure backup tables exist (critical after restore)
    await ensureBackupTablesExist();

    // Apply additive schema upgrades for newer features
    await ensureSchemaUpgrades();

    // Seed rate history (one-time), stamp unrated entries, advance due periods
    await applyProjectRateMaintenance();

    // Initialize users from Keycloak
    await initializeExistingUsers();

    logger.info('[Startup] Startup initialization complete ✓');
  } catch (error) {
    logger.error('[Startup] Error during startup initialization:', error);
    // Don't throw - let the app start even if initialization has issues
  }
}

/**
 * Check if startup initialization should run
 * Can be controlled via environment variable
 */
export function shouldRunStartupInitialization(): boolean {
  const envValue = process.env.RUN_STARTUP_INITIALIZATION;

  // Default to true if not specified
  if (envValue === undefined || envValue === null) {
    return true;
  }

  // Check for explicit false values
  return envValue !== 'false' && envValue !== '0' && envValue !== 'no';
}

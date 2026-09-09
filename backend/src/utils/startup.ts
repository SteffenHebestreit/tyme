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

    logger.info('[Startup] ✓ Schema upgrades applied');
  } catch (error) {
    logger.error('[Startup] Error applying schema upgrades:', error);
    // Don't throw - startup should continue
  }
}

/**
 * Seed rate history and stamp historical time entries, once.
 *
 * Unlike {@link ensureSchemaUpgrades} this DOES modify data — deliberately, and
 * it is the only place in startup that does. Both statements are guarded so
 * re-running them on every boot is a no-op:
 *
 *  1. Every project with a rate but no history gets one opening row. valid_from
 *     reaches back to the earliest time entry on that project, so no logged
 *     entry can fall into a period with no rate.
 *  2. Every time entry still carrying a NULL rate is stamped with the rate that
 *     was effective on its own entry_date. After this, a rate change can never
 *     re-price past work, because no money path has to fall back to the
 *     project's current rate.
 *
 * time_entries has a BEFORE UPDATE trigger that overwrites updated_at
 * (init.sql: set_timestamp). Backfilling would therefore make years of history
 * look freshly edited, so the UPDATE runs with session_replication_role =
 * replica, which suppresses triggers for this transaction only. That needs a
 * dedicated connection — SET LOCAL on a pool is not scoped to later queries.
 */
async function backfillProjectRates(): Promise<void> {
  const pool = getDbClient();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1) Opening rate row per project. LEAST ignores NULLs in Postgres, so a
    // project with no time entries simply falls back to its own start date.
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
    `);

    // 2) Stamp entries that never captured a rate. Entries without a project
    // are skipped: every money path INNER JOINs projects, so they are already
    // unreachable and there is no rate to resolve for them.
    // Suppressing the BEFORE UPDATE trigger keeps years of updated_at history
    // intact, but session_replication_role is superuser-only. On a role without
    // it the SET raises, which would abort the transaction and roll the seed
    // back — on every single boot. A savepoint makes it optional: if it fails we
    // continue and accept the updated_at churn rather than losing the backfill.
    let triggersSuppressed = true;
    await client.query('SAVEPOINT before_trigger_suppression');
    try {
      await client.query(`SET LOCAL session_replication_role = replica`);
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT before_trigger_suppression');
      triggersSuppressed = false;
      logger.warn(
        '[Startup] Could not suppress triggers for the rate backfill (needs a superuser role); ' +
          'proceeding, but updated_at will be refreshed on backfilled time entries'
      );
    }

    const stamped = await client.query(`
      UPDATE time_entries te
      SET hourly_rate = (
        SELECT prh.hourly_rate
        FROM project_rate_history prh
        WHERE prh.project_id = te.project_id
          AND prh.valid_from <= te.entry_date
        ORDER BY prh.valid_from DESC
        LIMIT 1
      )
      WHERE te.hourly_rate IS NULL
        AND te.project_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM project_rate_history prh
          WHERE prh.project_id = te.project_id
            AND prh.valid_from <= te.entry_date
        )
    `);

    await client.query('COMMIT');

    // A period scheduled for a date that has since arrived becomes the current
    // rate here, so a restart never leaves the displayed rate behind.
    const advanced = await client.query(`
      UPDATE projects p
      SET hourly_rate = derived.rate, updated_at = CURRENT_TIMESTAMP
      FROM (
        SELECT p2.id,
               (SELECT h.hourly_rate FROM project_rate_history h
                WHERE h.project_id = p2.id AND h.valid_from <= CURRENT_DATE
                ORDER BY h.valid_from DESC LIMIT 1) AS rate
        FROM projects p2
      ) AS derived
      WHERE p.id = derived.id
        AND derived.rate IS NOT NULL
        AND p.hourly_rate IS DISTINCT FROM derived.rate
    `);

    if (advanced.rowCount) {
      logger.info(`[Startup] ✓ ${advanced.rowCount} project rate(s) advanced to a newly effective period`);
    }

    if (seeded.rowCount || stamped.rowCount) {
      logger.info(
        `[Startup] ✓ Rate backfill: ${seeded.rowCount} project rate(s) seeded, ${stamped.rowCount} time entr(ies) stamped` +
          (triggersSuppressed ? '' : ' (updated_at refreshed — triggers could not be suppressed)')
      );
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error('[Startup] Error backfilling project rates:', error);
    // Don't throw - startup should continue
  } finally {
    client.release();
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

    // Seed rate history and stamp historical time entries (idempotent)
    await backfillProjectRates();

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

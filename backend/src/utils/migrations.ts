/**
 * @fileoverview Minimal one-time migration ledger.
 *
 * This project has no migration framework: schema changes are idempotent DDL
 * re-run on every boot (see ensureSchemaUpgrades in ./startup). That works for
 * DDL, which is naturally idempotent, but not for one-time DATA migrations —
 * those need to know whether they have already run.
 *
 * The alternative, deriving "have I run?" from the data itself, is what caused
 * the bug this module exists to fix: the rate backfill guarded on "this project
 * has no rate history", so deleting a project's last rate period made the next
 * restart helpfully re-create it. A reversible state predicate cannot be an
 * idempotency key.
 *
 * Deliberately NOT a general framework — no ordering, no up/down, no file
 * discovery. Just "run this once, ever, and record that you did".
 *
 * @module utils/migrations
 */

import { PoolClient } from 'pg';
import { getDbClient } from './database';
import { logger } from './logger';

export type MigrationOutcome = 'applied' | 'skipped' | 'failed';

/**
 * Create the ledger table. Idempotent; safe on every boot.
 *
 * Kept separate from ensureSchemaUpgrades so a caller can provision the ledger
 * before any migration needs it, and so tests can set it up in isolation.
 */
export async function ensureMigrationLedger(): Promise<void> {
  const db = getDbClient();
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      details JSONB
    )
  `);
}

/**
 * Whether a named migration has already been recorded as applied.
 */
export async function hasRun(name: string): Promise<boolean> {
  const db = getDbClient();
  const result = await db.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [name]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Record a migration as applied without running it.
 *
 * For adopting work that a previous release already performed: an install that
 * ran the old unguarded backfill must not have it run again, but there is no
 * ledger row to prove it. Without this, the very first boot after upgrading
 * would re-apply the migration once more.
 *
 * @returns true if a row was inserted, false if one already existed.
 */
export async function markAsRun(name: string, details?: Record<string, unknown>): Promise<boolean> {
  const db = getDbClient();
  const result = await db.query(
    `INSERT INTO schema_migrations (name, details) VALUES ($1, $2)
     ON CONFLICT (name) DO NOTHING`,
    [name, details ? JSON.stringify(details) : null]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Run a one-time migration exactly once, ever.
 *
 * The ledger row and the work share ONE transaction on ONE connection, so they
 * commit or roll back together — the ledger can never claim work that did not
 * happen, and work can never happen without being recorded. The row is inserted
 * FIRST with ON CONFLICT DO NOTHING, which also serialises two processes racing
 * to run the same migration: the loser's INSERT reports 0 rows and it skips.
 *
 * `work` receives the transaction's client and MUST use it — a query issued on
 * the pool instead would land outside the transaction and survive a rollback.
 *
 * @param name - Stable identifier; never reuse or rename one that has shipped.
 * @param work - The migration, receiving the transaction client.
 * @returns 'applied' when it ran, 'skipped' when already recorded, 'failed' on error.
 */
export async function runOnce(
  name: string,
  work: (client: PoolClient) => Promise<Record<string, unknown> | void>
): Promise<MigrationOutcome> {
  const pool = getDbClient();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const claimed = await client.query(
      `INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [name]
    );

    if ((claimed.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return 'skipped';
    }

    const details = await work(client);

    if (details) {
      await client.query(`UPDATE schema_migrations SET details = $2 WHERE name = $1`, [
        name,
        JSON.stringify(details),
      ]);
    }

    await client.query('COMMIT');
    logger.info(`[Migration] ✓ ${name} applied${details ? `: ${JSON.stringify(details)}` : ''}`);
    return 'applied';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logger.error(`[Migration] ✗ ${name} failed (will be retried on next start):`, error);
    return 'failed';
  } finally {
    client.release();
  }
}

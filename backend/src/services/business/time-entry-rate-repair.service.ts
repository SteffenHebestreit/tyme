/**
 * @fileoverview Stamps time entries that never captured an hourly rate.
 *
 * A time entry records the rate that applied on the day the work happened, at
 * the moment it is created. That is what stops a later rate change re-pricing
 * work already logged.
 *
 * Entries can still slip through unstamped: TimeEntryService.create deliberately
 * swallows a failed rate lookup rather than blocking time tracking, and rows can
 * be inserted by other means. An unstamped entry is not harmless — invoice
 * generation COALESCEs a NULL rate to the project's CURRENT rate, which is
 * precisely the retroactive pricing this feature exists to prevent. So this
 * repair runs on every boot and once a day, not as a one-time migration.
 *
 * It is cheap: a partial index over exactly the unstamped rows means the pass
 * costs an index scan proportional to the damage, not to the table, and it
 * drains to nothing once every entry is stamped.
 *
 * It is deterministic: the rate comes only from the project's rate timeline —
 * the period covering the entry's date, or failing that the earliest period
 * ever agreed. It never reads projects.hourly_rate, so running the repair twice
 * cannot produce two different answers just because the current rate moved in
 * between. This mirrors ProjectRateService.getEffectiveRate exactly.
 *
 * @module services/business/time-entry-rate-repair
 */

import { getDbClient } from '../../utils/database';
import { logger } from '../../utils/logger';

export interface RateRepairResult {
  /** Entries stamped with the rate effective on their own date. */
  stamped: number;
  /** Entries still unstamped because their project has no rate at all. */
  unpriceable: number;
}

/**
 * Stamp every unstamped time entry from its project's rate timeline.
 *
 * @param userId - Optional tenant scope; omitted means all tenants (boot/cron).
 * @returns How many entries were stamped, and how many remain unpriceable.
 */
export async function repairTimeEntryRates(userId?: string): Promise<RateRepairResult> {
  const db = getDbClient();
  const scope = userId ? 'AND te.user_id = $1' : '';
  const params = userId ? [userId] : [];

  // COALESCE of the two lookups mirrors getEffectiveRate: the period covering
  // the entry's date, else the earliest period ever agreed. Work predating the
  // first agreed rate is priced at that first rate — stable, and never today's.
  const stamped = await db.query(
    `UPDATE time_entries te
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
       ${scope}
       AND EXISTS (SELECT 1 FROM project_rate_history h WHERE h.project_id = te.project_id)`,
    params
  );

  const remaining = await db.query(
    `SELECT count(*)::int AS n FROM time_entries te
     WHERE te.hourly_rate IS NULL AND te.project_id IS NOT NULL ${scope}`,
    params
  );

  return { stamped: stamped.rowCount ?? 0, unpriceable: remaining.rows[0]?.n ?? 0 };
}

/**
 * Run the repair and log only when there is something to say.
 *
 * Unpriceable entries are surfaced as a warning: they are the rows invoicing
 * would silently price at the project's current rate, so they should be visible
 * rather than accumulating unnoticed.
 */
export async function runRateRepair(context: string): Promise<RateRepairResult> {
  try {
    const result = await repairTimeEntryRates();

    if (result.stamped > 0) {
      logger.info(`[RateRepair] ${context}: ${result.stamped} time entr(ies) stamped from the rate timeline`);
    }
    if (result.unpriceable > 0) {
      logger.warn(
        `[RateRepair] ${context}: ${result.unpriceable} time entr(ies) still have no rate — ` +
          'their projects have no rate timeline. Invoicing will fall back to the current project rate for these.'
      );
    }

    return result;
  } catch (error) {
    logger.error(`[RateRepair] ${context}: repair failed:`, error);
    return { stamped: 0, unpriceable: 0 };
  }
}

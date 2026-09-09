/**
 * @fileoverview Keeps the denormalised current project rate in step with the
 * rate timeline.
 *
 * `projects.hourly_rate` mirrors "the rate effective today" so every existing
 * screen and report keeps working. It is rewritten whenever a rate period is
 * added, edited or removed — but a period scheduled for a FUTURE date takes
 * effect on its own, with no write to trigger the resync. Without this job, a
 * rate agreed in November for 1 January would silently never become the
 * displayed rate.
 *
 * Time entries are unaffected either way: they are stamped from the timeline
 * itself, not from this column.
 *
 * @module services/business/project-rate-scheduler.service
 */

import cron, { ScheduledTask } from 'node-cron';
import { getDbClient } from '../../utils/database';
import { runRateRepair } from './time-entry-rate-repair.service';
import { logger } from '../../utils/logger';

/**
 * Re-derives `projects.hourly_rate` from the timeline for every project.
 *
 * Only touches rows that are actually wrong, so a normal run updates nothing
 * and the `updated_at` of untouched projects is preserved.
 *
 * @returns The number of projects whose rate was corrected.
 */
export async function resyncCurrentProjectRates(): Promise<number> {
  const db = getDbClient();

  const result = await db.query(`
    UPDATE projects p
    SET hourly_rate = derived.rate,
        updated_at = CURRENT_TIMESTAMP
    FROM (
      SELECT p2.id,
             (SELECT h.hourly_rate FROM project_rate_history h
              WHERE h.project_id = p2.id AND h.valid_from <= CURRENT_DATE
              ORDER BY h.valid_from DESC LIMIT 1) AS rate
      FROM projects p2
    ) AS derived
    WHERE p.id = derived.id
      AND derived.rate IS NOT NULL
      AND (p.hourly_rate IS DISTINCT FROM derived.rate)
  `);

  return result.rowCount ?? 0;
}

class ProjectRateSchedulerService {
  private cronJob: ScheduledTask | null = null;

  /**
   * Initialize the scheduler. Runs daily at 00:05 (server local time) by
   * default — just after midnight, so a period starting today becomes the
   * current rate on the day it starts; override with PROJECT_RATE_SYNC_CRON.
   */
  public initialize(): void {
    const cronExpression = process.env.PROJECT_RATE_SYNC_CRON || '5 0 * * *';

    if (!cron.validate(cronExpression)) {
      logger.error(`[ProjectRates] Invalid cron expression "${cronExpression}", scheduler not started`);
      return;
    }

    this.cronJob = cron.schedule(cronExpression, async () => {
      try {
        const updated = await resyncCurrentProjectRates();
        if (updated > 0) {
          logger.info(`[ProjectRates] ${updated} project rate(s) advanced to a newly effective period`);
        }

        // Catch entries that were saved unstamped since the last run — a rate
        // lookup can fail without blocking time tracking, and an unstamped entry
        // is re-priced at the current rate when it reaches an invoice.
        await runRateRepair('daily');
      } catch (error) {
        logger.error('[ProjectRates] Rate resync job failed:', error);
      }
    });

    logger.info(`[ProjectRates] Scheduler initialized (cron: "${cronExpression}")`);
  }

  /** Stop the scheduler. */
  public stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }
}

export default new ProjectRateSchedulerService();

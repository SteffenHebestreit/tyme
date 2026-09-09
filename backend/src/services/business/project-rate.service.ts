/**
 * @fileoverview Date-effective project hourly rates
 *
 * The rate a project bills at is a timeline, not a value. Each row in
 * `project_rate_history` opens a period that runs until the next row's
 * `valid_from`; {@link ProjectRateService.getEffectiveRate} answers "what did
 * this project cost on date X".
 *
 * Time entries stamp their rate at creation from this timeline, so changing a
 * rate here never re-prices work that is already logged — which is the whole
 * point of the table.
 *
 * `projects.hourly_rate` is kept in sync as a denormalised "rate as of today"
 * so every existing read path (project list, forms, budget maths) keeps working
 * unchanged. It is derived, never the source of truth.
 *
 * @module services/business/project-rate
 */

import { getDbClient } from '../../utils/database';
import { logger } from '../../utils/logger';
import {
  ProjectRate,
  ProjectRatePeriod,
  UpdateProjectRateDto,
} from '../../models/business/project-rate.model';

/**
 * Manages the rate timeline of a project.
 *
 * Every method is scoped by `user_id` through a join on `projects`. This is
 * deliberate and must stay: ProjectService.findById has no tenant filter, so
 * using it to authorise would expose another tenant's rates.
 */
export class ProjectRateService {
  private db = getDbClient();

  /**
   * Confirm the project belongs to the caller.
   *
   * @returns The project's id and current rate, or null when it does not exist
   *          or belongs to someone else — the caller cannot tell the two apart,
   *          which is intended.
   */
  private async assertOwnedProject(
    projectId: string,
    userId: string
  ): Promise<{ id: string; hourly_rate: string | null } | null> {
    const result = await this.db.query(
      `SELECT id, hourly_rate FROM projects WHERE id = $1 AND user_id = $2`,
      [projectId, userId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Re-derive `projects.hourly_rate` from the timeline.
   *
   * Runs on the caller's transaction client so it commits atomically with the
   * change that triggered it.
   */
  private async syncCurrentRate(client: any, projectId: string): Promise<void> {
    await client.query(
      `UPDATE projects p
       SET hourly_rate = COALESCE(
             -- the period covering today
             (SELECT h.hourly_rate FROM project_rate_history h
              WHERE h.project_id = p.id AND h.valid_from <= CURRENT_DATE
              ORDER BY h.valid_from DESC LIMIT 1),
             -- only future periods exist yet: show the first one rather than
             -- blanking a rate the user just entered
             (SELECT h.hourly_rate FROM project_rate_history h
              WHERE h.project_id = p.id
              ORDER BY h.valid_from ASC LIMIT 1),
             -- timeline emptied entirely: keep whatever the project had, so the
             -- column never points at a rate that no longer exists
             p.hourly_rate
           ),
           updated_at = CURRENT_TIMESTAMP
       WHERE p.id = $1`,
      [projectId]
    );
  }

  /**
   * The full rate timeline of a project, oldest first, with each period's
   * exclusive end and a flag marking the period covering today.
   */
  async listRates(projectId: string, userId: string): Promise<ProjectRatePeriod[]> {
    if (!(await this.assertOwnedProject(projectId, userId))) return [];

    const result = await this.db.query(
      `SELECT id, user_id, project_id, hourly_rate, valid_from, note, created_at, updated_at,
              LEAD(valid_from) OVER (ORDER BY valid_from) AS valid_until
       FROM project_rate_history
       WHERE project_id = $1
       ORDER BY valid_from ASC`,
      [projectId]
    );

    // The current period is the last one that has already started. Computed
    // here rather than in SQL so future-dated periods are unambiguous.
    const startedIdx = result.rows.reduce(
      (acc: number, row: any, idx: number) =>
        this.toDateString(row.valid_from) <= this.today() ? idx : acc,
      -1
    );

    return result.rows.map((row: any, idx: number) => ({
      ...row,
      hourly_rate: parseFloat(row.hourly_rate),
      valid_from: this.toDateString(row.valid_from),
      valid_until: row.valid_until ? this.toDateString(row.valid_until) : null,
      is_current: idx === startedIdx,
    }));
  }

  /**
   * The rate effective on a given date — what a time entry on that date is
   * stamped with.
   *
   * Falls back to `projects.hourly_rate` only when the project has no timeline
   * at all, which after the startup backfill means a project whose rate was
   * never set.
   *
   * @param date - YYYY-MM-DD; defaults to today.
   * @returns The rate, or null when none applies (e.g. the entry predates the
   *          first agreed rate).
   */
  async getEffectiveRate(
    projectId: string,
    userId: string,
    date?: string
  ): Promise<number | null> {
    const project = await this.assertOwnedProject(projectId, userId);
    if (!project) return null;

    const onDate = date || this.today();
    const result = await this.db.query(
      `SELECT
         (SELECT h.hourly_rate
          FROM project_rate_history h
          WHERE h.project_id = $1 AND h.valid_from <= $2
          ORDER BY h.valid_from DESC
          LIMIT 1) AS effective_rate,
         (SELECT h.hourly_rate
          FROM project_rate_history h
          WHERE h.project_id = $1
          ORDER BY h.valid_from ASC
          LIMIT 1) AS earliest_rate`,
      [projectId, onDate]
    );

    const { effective_rate: effectiveRate, earliest_rate: earliestRate } = result.rows[0];
    if (effectiveRate !== null && effectiveRate !== undefined) return parseFloat(effectiveRate);

    // Work dated before the first agreed rate: price it at the EARLIEST rate on
    // the timeline, not at today's. Returning null here would leave the entry
    // unstamped, and invoicing COALESCEs an unstamped entry to the project's
    // current rate — reintroducing exactly the retroactive pricing this feature
    // removes, one layer up where it is invisible. The earliest rate is stable:
    // it never changes when a later rate is agreed.
    if (earliestRate !== null && earliestRate !== undefined) return parseFloat(earliestRate);

    // No timeline at all — fall back to the project's own rate.
    return project.hourly_rate !== null ? parseFloat(project.hourly_rate) : null;
  }

  /**
   * Open a new rate period.
   *
   * The insert and the `projects.hourly_rate` resync share one transaction, so
   * the timeline and the denormalised current rate can never disagree. Note
   * `getDbClient()` hands back a Pool — issuing BEGIN on it would not be a
   * transaction at all, hence the explicit connect().
   *
   * @throws If a period already starts on that date (one rate per project per day).
   */
  async addRate(
    projectId: string,
    userId: string,
    data: { hourly_rate: number; valid_from: string; note?: string | null }
  ): Promise<ProjectRate | null> {
    if (!(await this.assertOwnedProject(projectId, userId))) return null;

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const inserted = await client.query(
        `INSERT INTO project_rate_history (user_id, project_id, hourly_rate, valid_from, note)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [userId, projectId, data.hourly_rate, data.valid_from, data.note || null]
      );

      await this.syncCurrentRate(client, projectId);
      await client.query('COMMIT');

      return this.parseRow(inserted.rows[0]);
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error?.code === '23505') {
        throw new Error('A rate already starts on that date for this project.');
      }
      logger.error('Error adding project rate:', error);
      throw new Error(`Failed to add project rate: ${error.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Correct an existing rate period (a typo in the agreed rate or its start).
   *
   * This does NOT re-price time entries already stamped from the old value —
   * those are immutable by design. Correcting a period that has already been
   * billed is therefore a bookkeeping action, and the UI warns about it.
   */
  async updateRate(
    rateId: string,
    userId: string,
    data: UpdateProjectRateDto
  ): Promise<ProjectRate | null> {
    const setParts: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.hourly_rate !== undefined) {
      setParts.push(`hourly_rate = $${paramIndex++}`);
      values.push(data.hourly_rate);
    }
    if (data.valid_from !== undefined) {
      setParts.push(`valid_from = $${paramIndex++}`);
      values.push(data.valid_from);
    }
    if (data.note !== undefined) {
      setParts.push(`note = $${paramIndex++}`);
      values.push(data.note || null);
    }
    if (setParts.length === 0) return this.findRateById(rateId, userId);

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // No updated_at trigger exists on this table (only the original
      // pg_dump-era tables have one), so it is set explicitly.
      const result = await client.query(
        `UPDATE project_rate_history h
         SET ${setParts.join(', ')}, updated_at = CURRENT_TIMESTAMP
         FROM projects p
         WHERE h.id = $${paramIndex} AND h.project_id = p.id AND p.user_id = $${paramIndex + 1}
         RETURNING h.*`,
        [...values, rateId, userId]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      await this.syncCurrentRate(client, result.rows[0].project_id);
      await client.query('COMMIT');

      return this.parseRow(result.rows[0]);
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error?.code === '23505') {
        throw new Error('A rate already starts on that date for this project.');
      }
      logger.error('Error updating project rate:', error);
      throw new Error(`Failed to update project rate: ${error.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Remove a rate period. Time entries stamped from it keep their rate.
   */
  async deleteRate(rateId: string, userId: string): Promise<boolean> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `DELETE FROM project_rate_history h
         USING projects p
         WHERE h.id = $1 AND h.project_id = p.id AND p.user_id = $2
         RETURNING h.project_id`,
        [rateId, userId]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      await this.syncCurrentRate(client, result.rows[0].project_id);
      await client.query('COMMIT');
      return true;
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      logger.error('Error deleting project rate:', error);
      throw new Error(`Failed to delete project rate: ${error.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * A single rate period, scoped to its owner.
   */
  async findRateById(rateId: string, userId: string): Promise<ProjectRate | null> {
    const result = await this.db.query(
      `SELECT h.*
       FROM project_rate_history h
       JOIN projects p ON p.id = h.project_id
       WHERE h.id = $1 AND p.user_id = $2`,
      [rateId, userId]
    );
    return result.rows.length > 0 ? this.parseRow(result.rows[0]) : null;
  }

  /** pg returns numeric as a string and date as a Date; normalise both. */
  private parseRow(row: any): ProjectRate {
    return {
      ...row,
      hourly_rate: parseFloat(row.hourly_rate),
      valid_from: this.toDateString(row.valid_from),
    };
  }

  private toDateString(value: Date | string): string {
    if (typeof value === 'string') return value.slice(0, 10);
    return value.toISOString().slice(0, 10);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

export const projectRateService = new ProjectRateService();

import { getDbClient } from '../../utils/database';
import {
  CreateTimeEntryDto,
  UpdateTimeEntryDto,
  TimeEntry as ITimeEntry,
  TimeEntryStatus
} from '../../models/business/time-entry.model';
import { logger } from '../../utils/logger';
import { projectRateService } from './project-rate.service';

const db = getDbClient();

/**
 * Service for managing time entry-related business logic and database operations.
 * Handles CRUD operations for time entries, including time tracking and billing calculations.
 * Automatically calculates duration when both start and end dates are provided.
 * 
 * @class TimeEntryService
 */
export class TimeEntryService {

  /**
   * Creates a new time entry in the database.
   * Automatically calculates duration_hours if both date_start and date_end are provided.
   * 
   * @async
   * @param {CreateTimeEntryDto} timeEntryData - The time entry data to create
   * @returns {Promise<ITimeEntry>} The created time entry with project details
   * @throws {Error} If project_id or user_id is invalid (foreign key violation)
   * @throws {Error} If the database operation fails
   * 
   * @example
   * const entry = await timeEntryService.create({
   *   user_id: 'user-uuid',
   *   project_id: 'project-uuid',
   *   description: 'Working on homepage redesign',
   *   date_start: new Date('2024-01-15T09:00:00Z'),
   *   date_end: new Date('2024-01-15T12:30:00Z'),
   *   is_billable: true
   * });
   */
  async create(timeEntryData: CreateTimeEntryDto): Promise<ITimeEntry> {
    const db = getDbClient();

    // Stamp the rate that was effective on the day the work happened, so a
    // later rate change cannot re-price this entry. Only when the caller did
    // not supply one — an explicit rate, including 0, always wins. Without this
    // the entry would keep a NULL rate and invoicing would fall back to the
    // project's current rate at billing time.
    let effectiveRate = timeEntryData.hourly_rate;
    if (
      (effectiveRate === undefined || effectiveRate === null) &&
      timeEntryData.project_id &&
      timeEntryData.user_id
    ) {
      try {
        // entry_date is typed as Date but arrives as a 'YYYY-MM-DD' string from
        // the API layer; accept both and normalise to the date-only form the
        // rate lookup compares against.
        const rawDate: any = timeEntryData.entry_date;
        const onDate =
          rawDate instanceof Date
            ? rawDate.toISOString().slice(0, 10)
            : typeof rawDate === 'string' && rawDate
              ? rawDate.slice(0, 10)
              : undefined;

        effectiveRate = (await projectRateService.getEffectiveRate(
          timeEntryData.project_id,
          timeEntryData.user_id,
          onDate
        )) ?? undefined;
      } catch (error) {
        // A failed lookup must not block time tracking; the entry is simply
        // saved unstamped and the startup backfill picks it up later.
        logger.error('Error resolving effective rate for new time entry:', error);
      }
    }

    // New model uses entry_date, entry_time, entry_end_time, and duration_hours directly
    const queryText = `
      INSERT INTO time_entries 
        (user_id, project_id, description, task_name, entry_date, entry_time, entry_end_time, 
         duration_hours, is_billable, category, tags, hourly_rate, date_start)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
      RETURNING id, user_id, project_id, description, task_name, entry_date, entry_time, 
                entry_end_time, duration_hours, is_billable, category, tags, hourly_rate, 
                created_at, updated_at
    `;
    const values = [
      timeEntryData.user_id,
      timeEntryData.project_id,
      timeEntryData.description ?? '', // Keep empty string for NOT NULL constraint
      timeEntryData.task_name || null,
      timeEntryData.entry_date || null,
      timeEntryData.entry_time || null,
      timeEntryData.entry_end_time || null,
      timeEntryData.duration_hours ?? null, // Use ?? to preserve 0 value
      timeEntryData.is_billable ?? true, // Default to true
      timeEntryData.category || null,
      timeEntryData.tags || null,
      effectiveRate ?? null, // ?? not ||, so an explicit rate of 0 survives
      timeEntryData.date_start || null, // Keep for backward compatibility
    ];

    try {
      const result = await db.query(queryText, values);
      return this.getTimeEntryWithDetails(result.rows[0]);
    } catch (error) {
      logger.error('Error creating time entry:', error);
      if ((error as any).code === '23503') { // foreign_key_violation
        const field = (error as any).constraint.includes('project_id') ? 'project_id' : 'user_id';
        throw new Error(`Invalid '${field}' specified.`);
      }
      throw new Error(`Failed to create time entry: ${(error as any).message}`);
    }
  }

  /**
   * Retrieves time entries from the database with optional filtering.
   * Returns time entries with associated project details, ordered by start date (newest first).
   * 
   * @async
   * @param {Object} [options] - Optional filtering parameters
   * @param {string} [options.user_id] - Filter by user ID
   * @param {string} [options.project_id] - Filter by project ID
   * @param {Date} [options.start_date] - Filter entries on or after this date
   * @param {Date} [options.end_date] - Filter entries on or before this date
   * @returns {Promise<ITimeEntry[]>} Array of time entries with project details
   * @throws {Error} If the query fails
   * 
   * @example
   * // Get all time entries
   * const allEntries = await timeEntryService.findAll();
   * 
   * // Get time entries for a specific project in date range
   * const projectEntries = await timeEntryService.findAll({
   *   project_id: 'project-uuid',
   *   start_date: new Date('2024-01-01'),
   *   end_date: new Date('2024-01-31')
   * });
   */
  async findAll(options: { user_id: string; project_id?: string; start_date?: Date; end_date?: Date }): Promise<ITimeEntry[]> {
    const db = getDbClient();
    let queryText = `
      SELECT te.id, te.user_id, te.project_id, te.description, te.task_name, 
             te.entry_date, te.entry_time, te.entry_end_time, te.date_start,
             te.duration_hours, te.is_billable, te.category, te.tags, te.hourly_rate, 
             te.created_at, te.updated_at,
             p.id as project_id_temp, p.name as project_name,
             c.name as client_name
      FROM time_entries te
      LEFT JOIN projects p ON te.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
    `;
    const values: any[] = [];
    const conditions: string[] = [];

    // ALWAYS filter by user_id for multi-tenant isolation
    conditions.push(`te.user_id = $${values.length + 1}`);
    values.push(options.user_id);

    if (options?.project_id) {
      conditions.push(`te.project_id = $${values.length + 1}`);
      values.push(options.project_id);
    }
    if (options?.start_date) {
      conditions.push(`DATE(te.entry_date) >= DATE($${values.length + 1})`);
      values.push(options.start_date.toISOString().split('T')[0]);
    }
    if (options?.end_date) {
      conditions.push(`DATE(te.entry_date) <= DATE($${values.length + 1})`);
      values.push(options.end_date.toISOString().split('T')[0]);
    }

    queryText += ' WHERE ' + conditions.join(' AND ');
    
    queryText += ` ORDER BY te.entry_date DESC, te.entry_time DESC`;

    try {
      const result = await db.query(queryText, values);
      
      return result.rows.map((row: any) => ({
        id: row.id,
        user_id: row.user_id,
        project_id: row.project_id,
        description: row.description,
        task_name: row.task_name,
        entry_date: row.entry_date,
        entry_time: row.entry_time,
        entry_end_time: row.entry_end_time,
        duration_hours: row.duration_hours ? parseFloat(row.duration_hours) : null,
        is_billable: row.is_billable,
        category: row.category,
        tags: row.tags,
        hourly_rate: row.hourly_rate ? parseFloat(row.hourly_rate) : null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        date_start: row.date_start, // Legacy field
        project: row.project_name ? { id: row.project_id_temp, name: row.project_name } : undefined,
        project_name: row.project_name || null,
        client_name: row.client_name || null
      }));
    } catch (error) {
      logger.error('Error fetching all time entries:', error);
      throw new Error(`Failed to fetch time entries: ${(error as any).message}`);
    }
  }

  /**
   * Retrieves a single time entry by its ID.
   * Returns the time entry with associated project details if found.
   * 
   * @async
   * @param {string} id - The UUID of the time entry to retrieve
   * @returns {Promise<ITimeEntry | null>} The time entry with project details, or null if not found
   * @throws {Error} If the query fails
   * 
   * @example
   * const entry = await timeEntryService.findById('entry-uuid');
   * if (entry) {
   *   console.log(`Duration: ${entry.duration_hours}h on ${entry.project?.name}`);
   * }
   */
  async findById(id: string): Promise<ITimeEntry | null> {
    const db = getDbClient();
    const queryText = `
      SELECT te.id, te.user_id, te.project_id, te.description, te.task_name, 
             te.entry_date, te.entry_time, te.date_start,
             te.duration_hours, te.is_billable, te.category, te.tags, te.hourly_rate,
             te.created_at, te.updated_at
      FROM time_entries te WHERE id = $1
    `;
    try {
      const result = await db.query(queryText, [id]);
      if (result.rows.length === 0) return null;
      return this.getTimeEntryWithDetails(result.rows[0]);
    } catch (error) {
      logger.error('Error fetching time entry by ID:', error);
      throw new Error(`Failed to fetch time entry: ${(error as any).message}`);
    }
  }

  /**
   * Updates an existing time entry with partial data.
   * Only provided fields will be updated; undefined fields are ignored.
   * Returns null if the time entry is not found.
   * 
   * @async
   * @param {string} id - The UUID of the time entry to update
   * @param {UpdateTimeEntryDto} timeEntryData - The partial time entry data to update
   * @returns {Promise<ITimeEntry | null>} The updated time entry with project details, or null if not found
   * @throws {Error} If project_id or user_id is invalid (foreign key violation)
   * @throws {Error} If the update operation fails
   * 
   * @example
   * const updated = await timeEntryService.update('entry-uuid', {
   *   description: 'Updated description',
   *   is_billable: false
   * });
   */
  async update(id: string, timeEntryData: UpdateTimeEntryDto): Promise<ITimeEntry | null> {
    const db = getDbClient();
    const setParts = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (timeEntryData.user_id !== undefined) {
      setParts.push(`user_id = $${paramIndex++}`);
      values.push(timeEntryData.user_id);
    }
    if (timeEntryData.project_id !== undefined) {
      setParts.push(`project_id = $${paramIndex++}`);
      values.push(timeEntryData.project_id);
    }
    if (timeEntryData.description !== undefined) {
      setParts.push(`description = $${paramIndex++}`);
      values.push(timeEntryData.description !== null && timeEntryData.description !== undefined ? timeEntryData.description : '');
    }
    if (timeEntryData.task_name !== undefined) {
      setParts.push(`task_name = $${paramIndex++}`);
      values.push(timeEntryData.task_name || null);
    }
    if (timeEntryData.entry_date !== undefined) {
      setParts.push(`entry_date = $${paramIndex++}`);
      values.push(timeEntryData.entry_date);
    }
    if (timeEntryData.entry_time !== undefined) {
      setParts.push(`entry_time = $${paramIndex++}`);
      values.push(timeEntryData.entry_time);
    }
    if (timeEntryData.entry_end_time !== undefined) {
      setParts.push(`entry_end_time = $${paramIndex++}`);
      values.push(timeEntryData.entry_end_time || null);
    }
    if (timeEntryData.duration_hours !== undefined) {
      setParts.push(`duration_hours = $${paramIndex++}`);
      values.push(timeEntryData.duration_hours ?? null);
    }
    if (timeEntryData.is_billable !== undefined) {
      setParts.push(`is_billable = $${paramIndex++}`);
      values.push(timeEntryData.is_billable);
    }
    if (timeEntryData.category !== undefined) {
      setParts.push(`category = $${paramIndex++}`);
      values.push(timeEntryData.category || null);
    }
    if (timeEntryData.tags !== undefined) {
      setParts.push(`tags = $${paramIndex++}`);
      values.push(timeEntryData.tags || null);
    }
    if (timeEntryData.hourly_rate !== undefined) {
      setParts.push(`hourly_rate = $${paramIndex++}`);
      values.push(timeEntryData.hourly_rate || null);
    }
    // Legacy field support
    if (timeEntryData.date_start !== undefined) {
      setParts.push(`date_start = $${paramIndex++}`);
      values.push(timeEntryData.date_start);
    }

    if (setParts.length === 0) {
      return this.findById(id); // No changes, return existing
    }

    const queryText = `
      UPDATE time_entries 
      SET ${setParts.join(', ')}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $${paramIndex} 
      RETURNING id, user_id, project_id, description, task_name, entry_date, entry_time, entry_end_time,
                duration_hours, is_billable, category, tags, hourly_rate, created_at, updated_at, date_start
    `;
    values.push(id);

    try {
      const result = await db.query(queryText, values);
      if (result.rows.length === 0) return null;
      return this.getTimeEntryWithDetails(result.rows[0]);
    } catch (error) {
      logger.error('Error updating time entry:', error);
      if ((error as any).code === '23503') { // foreign_key_violation
        const field = (error as any).constraint.includes('project_id') ? 'project_id' : 'user_id';
        throw new Error(`Invalid '${field}' specified.`);
      }
      throw new Error(`Failed to update time entry: ${(error as any).message}`);
    }
  }

  /**
   * Deletes a time entry from the database.
   * 
   * @async
  * @param {string} id - The UUID of the time entry to delete
  * @param {string} userId - The UUID of the authenticated owner
   * @returns {Promise<boolean>} True if the time entry was deleted, false if not found
   * @throws {Error} If the deletion fails
   * 
   * @example
  * const deleted = await timeEntryService.delete('entry-uuid', 'user-uuid');
   * if (deleted) console.log('Time entry deleted successfully');
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const db = getDbClient();
    const queryText = `DELETE FROM time_entries WHERE id = $1 AND user_id = $2`;
    try {
      const result = await db.query(queryText, [id, userId]);
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Error deleting time entry:', error);
      throw new Error(`Failed to delete time entry: ${(error as any).message}`);
    }
  }

  /**
   * Finds existing time entries that overlap a proposed time range on a given date.
   * Used to warn the user about double-booking the same time slot.
   *
   * Two entries overlap when, on the same date, the proposed range [start, end)
   * intersects an existing range. Active timers (duration 0 with no end time) and
   * an optionally excluded entry (the one being edited) are ignored.
   *
   * @async
   * @param {Object} params - Overlap query parameters
   * @param {string} params.user_id - Authenticated user ID (multi-tenant isolation)
   * @param {string} params.entry_date - Date in YYYY-MM-DD format
   * @param {string} params.entry_time - Proposed start time (HH:mm[:ss])
   * @param {string} params.entry_end_time - Proposed end time (HH:mm[:ss])
   * @param {string} [params.exclude_id] - Time entry ID to exclude (when editing)
   * @returns {Promise<Array>} Overlapping entries with project name
   */
  async findOverlapping(params: {
    user_id: string;
    entry_date: string;
    entry_time: string;
    entry_end_time: string;
    exclude_id?: string;
  }): Promise<any[]> {
    const db = getDbClient();
    const queryText = `
      SELECT te.id, te.entry_date, te.entry_time, te.entry_end_time,
             te.duration_hours, te.task_name, te.description,
             p.name AS project_name
      FROM time_entries te
      LEFT JOIN projects p ON te.project_id = p.id
      WHERE te.user_id = $1
        AND te.entry_date = $2::date
        AND te.duration_hours > 0
        AND ($5::uuid IS NULL OR te.id <> $5::uuid)
        AND te.entry_time::time < $4::time
        AND $3::time < COALESCE(
              te.entry_end_time::time,
              (te.entry_time::time + (te.duration_hours * INTERVAL '1 hour'))::time
            )
      ORDER BY te.entry_time ASC
    `;
    try {
      const result = await db.query(queryText, [
        params.user_id,
        params.entry_date,
        params.entry_time,
        params.entry_end_time,
        params.exclude_id || null,
      ]);
      return result.rows;
    } catch (error) {
      logger.error('Error checking time entry overlap:', error);
      throw new Error(`Failed to check time entry overlap: ${(error as any).message}`);
    }
  }

  /**
   * Private helper method to enrich a time entry row with project details.
   * Fetches the associated project name from the database and attaches it to the time entry.
   * 
   * @private
   * @async
   * @param {any} timeEntryRow - The raw time entry row from the database
   * @returns {Promise<ITimeEntry>} The time entry with project details attached
   * 
   * @example
   * // Internal use only
   * const enrichedEntry = await this.getTimeEntryWithDetails(rawEntryRow);
   */
  private async getTimeEntryWithDetails(timeEntryRow: any): Promise<ITimeEntry> {
    const db = getDbClient();
    if (!timeEntryRow.project_id) {
      return timeEntryRow;
    }
    
    const projectQueryText = `SELECT id, name FROM projects WHERE id = $1`;
    const projectResult = await db.query(projectQueryText, [timeEntryRow.project_id]);
    
    let projectDetails;
    if (projectResult.rows.length > 0) {
      projectDetails = { id: projectResult.rows[0].id, name: projectResult.rows[0].name };
    }

    return {
      ...timeEntryRow,
      project: projectDetails
    };
  }
}

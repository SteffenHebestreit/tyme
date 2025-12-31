/**
 * @fileoverview Expense service for managing business expenses.
 * 
 * Provides functionality for:
 * - CRUD operations for expenses
 * - Receipt file management
 * - Expense approval workflow
 * - Expense filtering and querying
 * - Expense analytics and summaries
 * 
 * @module services/business/expense
 */

import { getDbClient } from '../../utils/database';
import {
  Expense,
  ExpenseWithProject,
  ExpenseFilters,
  ExpenseSummary,
  CreateExpenseData,
  UpdateExpenseData,
  ExpenseStatus,
} from '../../models/business/expense.model';
import { promises as fs } from 'fs';
import { join, basename, extname } from 'path';

export class ExpenseService {
  private db = getDbClient();
  private uploadsDir = join(process.cwd(), 'uploads', 'receipts');

  constructor() {
    // Ensure uploads directory exists
    this.ensureUploadsDir();
  }

  /**
   * Ensure receipts upload directory exists
   */
  private async ensureUploadsDir(): Promise<void> {
    try {
      await fs.access(this.uploadsDir);
    } catch {
      await fs.mkdir(this.uploadsDir, { recursive: true });
    }
  }

  /**
   * Create a new expense
   * 
   * @param {string} userId - User creating the expense
   * @param {CreateExpenseData} data - Expense data
   * @returns {Promise<Expense>} Created expense
   */
  async createExpense(userId: string, data: CreateExpenseData): Promise<Expense> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      // Calculate next_occurrence for recurring expenses
      let nextOccurrence = null;
      if (data.is_recurring && data.recurrence_start_date && data.recurrence_frequency) {
        // Calculate next occurrence from start date, advancing to current or future date
        nextOccurrence = this.calculateNextOccurrenceFromStart(
          data.recurrence_start_date,
          data.recurrence_frequency,
          data.recurrence_end_date || null
        );
      }

      const query = `
        INSERT INTO expenses (
          user_id, project_id, category, description, amount, net_amount, 
          tax_rate, tax_amount, currency, expense_date, is_billable, 
          is_reimbursable, tags, notes, is_recurring, recurrence_frequency,
          recurrence_start_date, recurrence_end_date, next_occurrence
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING *
      `;

      const values = [
        userId,
        data.project_id || null,
        data.category,
        data.description,
        data.amount,
        data.net_amount,
        data.tax_rate ?? 0,
        data.tax_amount ?? 0,
        data.currency,
        data.expense_date,
        data.is_billable ?? false,
        data.is_reimbursable ?? false,
        data.tags || [],
        data.notes || null,
        data.is_recurring ?? false,
        data.recurrence_frequency || null,
        data.recurrence_start_date || null,
        data.recurrence_end_date || null,
        nextOccurrence,
      ];

      const result = await client.query(query, values);
      const newExpense = result.rows[0];

      // If recurring, generate all past expenses from start_date to now
      if (data.is_recurring && data.recurrence_start_date && data.recurrence_frequency) {
        await this.backfillRecurringExpenses(client, newExpense);
      }

      await client.query('COMMIT');
      return newExpense;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Backfill all past recurring expenses from start date to today
   */
  private async backfillRecurringExpenses(client: any, template: any): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Start from the expense_date, not recurrence_start_date
    // If expense_date is before recurrence_start_date in the same month, skip it
    const expenseDate = new Date(template.expense_date);
    const startDate = new Date(template.recurrence_start_date);
    expenseDate.setHours(0, 0, 0, 0);
    startDate.setHours(0, 0, 0, 0);

    const endDate = template.recurrence_end_date ? new Date(template.recurrence_end_date) : null;
    if (endDate) endDate.setHours(0, 0, 0, 0);

    // If the expense_date is before the recurrence_start_date, adjust to start from the first valid occurrence
    let currentDate = new Date(expenseDate);
    if (currentDate < startDate) {
      // Move to the same day in the month/quarter/year of the start date
      currentDate = new Date(startDate);
      currentDate.setUTCDate(expenseDate.getUTCDate());
    }

    // Generate expenses for all past occurrences
    // IMPORTANT: Skip any occurrence that falls in the same month/year as the template expense_date
    // because the template itself represents that occurrence
    
    while (currentDate < today) {
      // Check if we've exceeded end date
      if (endDate && currentDate > endDate) {
        break;
      }

      // Check if this occurrence is in the same month/year as the template expense_date
      const isSameMonth = (
        currentDate.getFullYear() === expenseDate.getFullYear() &&
        currentDate.getMonth() === expenseDate.getMonth()
      );

      // Check if this occurrence is after the recurrence_start_date
      // Skip occurrences that match the template's month to avoid duplicating
      if (currentDate >= startDate && !isSameMonth) {
        const insertQuery = `
          INSERT INTO expenses (
            user_id, project_id, category, description, amount, net_amount,
            tax_rate, tax_amount, currency, expense_date, is_billable,
            is_reimbursable, status, tags, notes, is_recurring, parent_expense_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `;

        const values = [
          template.user_id,
          template.project_id,
          template.category,
          `${template.description} (Auto-generated)`,
          template.amount,
          template.net_amount,
          template.tax_rate,
          template.tax_amount,
          template.currency,
          currentDate.toISOString().split('T')[0],
          template.is_billable,
          template.is_reimbursable,
          'approved', // Auto-approve generated expenses
          template.tags,
          template.notes,
          false,
          template.id,
        ];

        await client.query(insertQuery, values);
      }

      // Advance to next occurrence
      switch (template.recurrence_frequency) {
        case 'monthly':
          currentDate.setMonth(currentDate.getMonth() + 1);
          break;
        case 'quarterly':
          currentDate.setMonth(currentDate.getMonth() + 3);
          break;
        case 'yearly':
          currentDate.setFullYear(currentDate.getFullYear() + 1);
          break;
      }
    }
  }

  /**
   * Helper function to calculate next occurrence, advancing from start date to current/future
   */
  private calculateNextOccurrenceFromStart(
    startDate: string,
    frequency: string,
    endDate: string | null
  ): string | null {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time to start of day
    
    let currentOccurrence = new Date(startDate);
    currentOccurrence.setHours(0, 0, 0, 0);

    // If start date is in the future, return it as-is
    if (currentOccurrence > today) {
      return startDate;
    }

    // Advance until we reach current or future date
    while (currentOccurrence <= today) {
      // Check if we've exceeded end date
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(0, 0, 0, 0);
        if (currentOccurrence > end) {
          return null; // Past end date, don't schedule
        }
      }

      // Calculate next occurrence
      switch (frequency) {
        case 'monthly':
          currentOccurrence.setMonth(currentOccurrence.getMonth() + 1);
          break;
        case 'quarterly':
          currentOccurrence.setMonth(currentOccurrence.getMonth() + 3);
          break;
        case 'yearly':
          currentOccurrence.setFullYear(currentOccurrence.getFullYear() + 1);
          break;
        default:
          throw new Error(`Unknown recurrence frequency: ${frequency}`);
      }
    }

    return currentOccurrence.toISOString().split('T')[0];
  }

  /**
   * Get expense by ID
   * 
   * @param {string} id - Expense ID
   * @param {string} userId - User requesting the expense
   * @returns {Promise<ExpenseWithProject | null>} Expense with project details or null
   */
  async getExpenseById(id: string, userId: string): Promise<ExpenseWithProject | null> {
    const query = `
      SELECT 
        e.*,
        p.name AS project_name,
        c.name AS client_name
      FROM expenses e
      LEFT JOIN projects p ON e.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE e.id = $1 AND e.user_id = $2
    `;

    const result = await this.db.query(query, [id, userId]);
    return result.rows[0] || null;
  }

  /**
   * Get all expenses with filtering, sorting, and pagination
   * 
   * @param {ExpenseFilters} filters - Filter options
   * @returns {Promise<{expenses: ExpenseWithProject[], total: number}>} Filtered expenses and total count
   */
  async getExpenses(filters: ExpenseFilters): Promise<{ expenses: ExpenseWithProject[]; total: number }> {
    const conditions: string[] = ['e.user_id = $1'];
    const values: any[] = [filters.user_id];
    let paramIndex = 2;

    // Build WHERE clause
    if (filters.project_id) {
      conditions.push(`e.project_id = $${paramIndex++}`);
      values.push(filters.project_id);
    }

    if (filters.category) {
      conditions.push(`e.category = $${paramIndex++}`);
      values.push(filters.category);
    }

    if (filters.status) {
      conditions.push(`e.status = $${paramIndex++}`);
      values.push(filters.status);
    }

    if (filters.is_billable !== undefined) {
      conditions.push(`e.is_billable = $${paramIndex++}`);
      values.push(filters.is_billable);
    }

    if (filters.is_reimbursable !== undefined) {
      conditions.push(`e.is_reimbursable = $${paramIndex++}`);
      values.push(filters.is_reimbursable);
    }

    if (filters.date_from) {
      conditions.push(`e.expense_date >= $${paramIndex++}`);
      values.push(filters.date_from);
    }

    if (filters.date_to) {
      conditions.push(`e.expense_date <= $${paramIndex++}`);
      values.push(filters.date_to);
    }

    if (filters.search) {
      conditions.push(`(e.description ILIKE $${paramIndex} OR e.notes ILIKE $${paramIndex} OR e.id::text ILIKE $${paramIndex})`);
      values.push(`%${filters.search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total matching records
    const countQuery = `
      SELECT COUNT(*) as total
      FROM expenses e
      ${whereClause}
    `;

    const countResult = await this.db.query(countQuery, values);
    const total = parseInt(countResult.rows[0].total);

    // Get paginated results
    const sortBy = filters.sort_by || 'expense_date';
    const sortOrder = filters.sort_order || 'desc';
    const offset = filters.offset || 0;
    
    // If limit is 0 or -1, fetch all results (no limit)
    // Otherwise use provided limit or default to 50
    const useLimit = filters.limit === 0 || filters.limit === -1 ? false : true;
    const limit = useLimit ? (filters.limit || 50) : total;

    let dataQuery = `
      SELECT 
        e.*,
        p.name AS project_name,
        c.name AS client_name
      FROM expenses e
      LEFT JOIN projects p ON e.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      ${whereClause}
      ORDER BY e.${sortBy} ${sortOrder.toUpperCase()}
    `;

    // Only add LIMIT/OFFSET if we're actually limiting
    if (useLimit) {
      dataQuery += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      values.push(limit, offset);
    }
    
    const dataResult = await this.db.query(dataQuery, values);

    return {
      expenses: dataResult.rows,
      total,
    };
  }

  /**
   * Update an expense
   * 
   * @param {string} id - Expense ID
   * @param {string} userId - User updating the expense
   * @param {UpdateExpenseData} data - Updated fields
   * @returns {Promise<Expense>} Updated expense
   */
  async updateExpense(id: string, userId: string, data: UpdateExpenseData): Promise<Expense> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      // Check if recurring settings are being changed
      const currentExpenseResult = await client.query(
        'SELECT * FROM expenses WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      
      if (currentExpenseResult.rows.length === 0) {
        throw new Error('Expense not found or unauthorized');
      }
      
      const currentExpense = currentExpenseResult.rows[0];
      const isRecurringSettingsChanged = currentExpense.is_recurring && (
        (data.recurrence_start_date !== undefined && data.recurrence_start_date !== currentExpense.recurrence_start_date) ||
        (data.recurrence_end_date !== undefined && data.recurrence_end_date !== currentExpense.recurrence_end_date) ||
        (data.recurrence_frequency !== undefined && data.recurrence_frequency !== currentExpense.recurrence_frequency)
      );

      const fields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      // Build SET clause dynamically
      if (data.project_id !== undefined) {
        fields.push(`project_id = $${paramIndex++}`);
        values.push(data.project_id);
      }

      if (data.category) {
        fields.push(`category = $${paramIndex++}`);
        values.push(data.category);
      }

      if (data.description) {
        fields.push(`description = $${paramIndex++}`);
        values.push(data.description);
      }

      if (data.amount !== undefined) {
        fields.push(`amount = $${paramIndex++}`);
        values.push(data.amount);
      }

      if (data.net_amount !== undefined) {
        fields.push(`net_amount = $${paramIndex++}`);
        values.push(data.net_amount);
      }

      if (data.tax_rate !== undefined) {
        fields.push(`tax_rate = $${paramIndex++}`);
        values.push(data.tax_rate);
      }

      if (data.tax_amount !== undefined) {
        fields.push(`tax_amount = $${paramIndex++}`);
        values.push(data.tax_amount);
      }

      if (data.currency) {
        fields.push(`currency = $${paramIndex++}`);
        values.push(data.currency);
      }

      if (data.expense_date) {
        fields.push(`expense_date = $${paramIndex++}`);
        values.push(data.expense_date);
      }

      if (data.is_billable !== undefined) {
        fields.push(`is_billable = $${paramIndex++}`);
        values.push(data.is_billable);
      }

      if (data.is_reimbursable !== undefined) {
        fields.push(`is_reimbursable = $${paramIndex++}`);
        values.push(data.is_reimbursable);
      }

      if (data.status) {
        fields.push(`status = $${paramIndex++}`);
        values.push(data.status);
      }

      if (data.tags) {
        fields.push(`tags = $${paramIndex++}`);
        values.push(data.tags);
      }

      if (data.notes !== undefined) {
        fields.push(`notes = $${paramIndex++}`);
        values.push(data.notes);
      }

      if (data.is_recurring !== undefined) {
        fields.push(`is_recurring = $${paramIndex++}`);
        values.push(data.is_recurring);
      }

      if (data.recurrence_frequency !== undefined) {
        fields.push(`recurrence_frequency = $${paramIndex++}`);
        values.push(data.recurrence_frequency);
      }

      if (data.recurrence_start_date !== undefined) {
        fields.push(`recurrence_start_date = $${paramIndex++}`);
        values.push(data.recurrence_start_date);
      }

      if (data.recurrence_end_date !== undefined) {
        fields.push(`recurrence_end_date = $${paramIndex++}`);
        values.push(data.recurrence_end_date);
      }

      // Depreciation fields
      if (data.depreciation_type !== undefined) {
        fields.push(`depreciation_type = $${paramIndex++}`);
        values.push(data.depreciation_type);
        
        // When changing to 'immediate' or 'none', ALWAYS clear depreciation fields
        if (data.depreciation_type === 'immediate' || data.depreciation_type === 'none') {
          // Force these fields to NULL, overriding any values sent by frontend
          fields.push(`depreciation_years = NULL`);
          fields.push(`depreciation_start_date = NULL`);
          // Skip adding depreciation_years and depreciation_start_date below
          data.depreciation_years = null as any;
          data.depreciation_start_date = null as any;
        } else if (data.depreciation_type === 'partial') {
          // When changing to 'partial', ensure depreciation_start_date is set if not provided
          if (data.depreciation_start_date === undefined) {
            fields.push(`depreciation_start_date = COALESCE(depreciation_start_date, expense_date)`);
          }
        }
      }

      // Only add depreciation_years if not already forced to NULL above
      if (data.depreciation_years !== undefined && data.depreciation_years !== null) {
        fields.push(`depreciation_years = $${paramIndex++}`);
        values.push(data.depreciation_years);
      }

      // Only add depreciation_start_date if not already forced to NULL above
      if (data.depreciation_start_date !== undefined && data.depreciation_start_date !== null) {
        fields.push(`depreciation_start_date = $${paramIndex++}`);
        values.push(data.depreciation_start_date);
      }

      if (data.depreciation_method !== undefined) {
        fields.push(`depreciation_method = $${paramIndex++}`);
        values.push(data.depreciation_method);
      }

      if (data.useful_life_category !== undefined) {
        fields.push(`useful_life_category = $${paramIndex++}`);
        values.push(data.useful_life_category);
      }

      if (data.tax_deductible_amount !== undefined) {
        fields.push(`tax_deductible_amount = $${paramIndex++}`);
        values.push(data.tax_deductible_amount);
      }

      if (data.tax_deductible_percentage !== undefined) {
        fields.push(`tax_deductible_percentage = $${paramIndex++}`);
        values.push(data.tax_deductible_percentage);
      }

      if (data.tax_deductibility_reasoning !== undefined) {
        fields.push(`tax_deductibility_reasoning = $${paramIndex++}`);
        values.push(data.tax_deductibility_reasoning);
      }

      // Recalculate next_occurrence if recurring settings changed
      if (isRecurringSettingsChanged) {
        const newStartDate = data.recurrence_start_date || currentExpense.recurrence_start_date;
        const newFrequency = data.recurrence_frequency || currentExpense.recurrence_frequency;
        const newEndDate = data.recurrence_end_date !== undefined ? data.recurrence_end_date : currentExpense.recurrence_end_date;
        
        const nextOccurrence = this.calculateNextOccurrenceFromStart(
          newStartDate,
          newFrequency,
          newEndDate
        );
        
        fields.push(`next_occurrence = $${paramIndex++}`);
        values.push(nextOccurrence);
      }

      if (fields.length === 0) {
        throw new Error('No fields to update');
      }

      const query = `
        UPDATE expenses
        SET ${fields.join(', ')}
        WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
        RETURNING *
      `;

      values.push(id, userId);
      const result = await client.query(query, values);
      const updatedExpense = result.rows[0];

      // If recurring settings changed, regenerate all child expenses
      if (isRecurringSettingsChanged) {
        // Delete all existing generated expenses
        await client.query(
          'DELETE FROM expenses WHERE parent_expense_id = $1',
          [id]
        );

        // Regenerate expenses with new settings
        await this.backfillRecurringExpenses(client, updatedExpense);
      }

      await client.query('COMMIT');
      
      // After committing the parent update, update all child expenses if this is a recurring template
      if (currentExpense.is_recurring && currentExpense.parent_expense_id === null) {
        // Update child expenses with inherited fields (category, depreciation settings, etc.)
        // This runs AFTER commit to avoid long transactions
        await this.updateChildExpenses(id, data);
      }
      
      return updatedExpense;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete an expense
   * 
   * @param {string} id - Expense ID
   * @param {string} userId - User deleting the expense
   * @returns {Promise<void>}
   */
  async deleteExpense(id: string, userId: string): Promise<void> {
    // Get expense to check for receipt file
    const expense = await this.getExpenseById(id, userId);
    if (!expense) {
      throw new Error('Expense not found or unauthorized');
    }

    // Delete receipt file if exists
    if (expense.receipt_url) {
      await this.deleteReceiptFile(expense.receipt_url);
    }

    // Delete expense from database
    const query = 'DELETE FROM expenses WHERE id = $1 AND user_id = $2';
    await this.db.query(query, [id, userId]);
  }

  /**
   * Save receipt file for an expense
   * 
   * @param {string} id - Expense ID
   * @param {string} userId - User uploading receipt
   * @param {Express.Multer.File} file - Uploaded file
   * @returns {Promise<Expense>} Updated expense with receipt URL
   */
  async saveReceipt(id: string, userId: string, file: Express.Multer.File): Promise<Expense> {
    const expense = await this.getExpenseById(id, userId);
    if (!expense) {
      throw new Error('Expense not found or unauthorized');
    }

    // Import MinIO service dynamically to avoid circular dependencies
    const { minioService } = await import('../storage/minio.service');

    // Delete old receipt if exists
    if (expense.receipt_url) {
      await this.deleteReceiptFile(expense.receipt_url);
    }

    // Upload to MinIO
    const uploadResult = await minioService.uploadFile(
      userId,
      file.buffer,
      file.originalname,
      file.mimetype,
      'receipts'
    );

    // Update database with MinIO URL and file metadata
    const query = `
      UPDATE expenses
      SET receipt_url = $1, 
          receipt_filename = $2,
          receipt_size = $3,
          receipt_mimetype = $4
      WHERE id = $5 AND user_id = $6
      RETURNING *
    `;

    const result = await this.db.query(query, [
      uploadResult.url,
      uploadResult.filename,
      file.size,
      file.mimetype,
      id,
      userId,
    ]);
    
    return result.rows[0];
  }

  /**
   * Delete receipt file
   * 
   * @param {string} receiptUrl - Receipt URL path from MinIO
   * @returns {Promise<void>}
   */
  private async deleteReceiptFile(receiptUrl: string): Promise<void> {
    try {
      // Import MinIO service dynamically
      const { minioService } = await import('../storage/minio.service');
      
      // Delete from MinIO
      await minioService.deleteFileFromPath(receiptUrl);
    } catch (error) {
      console.error('Error deleting receipt file:', error);
      // Don't throw - file might already be deleted
    }
  }

  /**
   * Delete receipt from expense
   * 
   * @param {string} id - Expense ID
   * @param {string} userId - User deleting receipt
   * @returns {Promise<Expense>} Updated expense
   */
  async deleteReceipt(id: string, userId: string): Promise<Expense> {
    const expense = await this.getExpenseById(id, userId);
    if (!expense) {
      throw new Error('Expense not found or unauthorized');
    }

    if (expense.receipt_url) {
      await this.deleteReceiptFile(expense.receipt_url);
    }

    const query = `
      UPDATE expenses
      SET receipt_url = NULL, 
          receipt_filename = NULL,
          receipt_size = NULL,
          receipt_mimetype = NULL
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `;

    const result = await this.db.query(query, [id, userId]);
    return result.rows[0];
  }

  /**
   * Get receipt file stream for download
   * 
   * @param {string} id - Expense ID
   * @param {string} userId - User downloading receipt
   * @returns {Promise<{stream: import('stream').Readable, filename: string, mimetype: string}>} Receipt file stream and metadata
   */
  async getReceiptFileStream(id: string, userId: string): Promise<{
    stream: import('stream').Readable;
    filename: string;
    mimetype: string;
  }> {
    const expense = await this.getExpenseById(id, userId);
    if (!expense) {
      throw new Error('Expense not found or unauthorized');
    }

    if (!expense.receipt_url) {
      throw new Error('No receipt found for this expense');
    }

    // Import MinIO service dynamically
    const { minioService } = await import('../storage/minio.service');

    // Extract bucket and object name from URL
    // URL format: /receipts/userid/receipts/filename or /bucket/objectName
    // We need to parse this correctly
    const urlParts = expense.receipt_url.replace(/^\//, '').split('/');
    const bucket = urlParts[0]; // First part is the bucket name
    const objectName = urlParts.slice(1).join('/'); // Rest is the object name

    // Get file stream from MinIO
    const stream = await minioService.getFileStream(bucket, objectName);

    return {
      stream,
      filename: expense.receipt_filename || 'receipt',
      mimetype: expense.receipt_mimetype || 'application/octet-stream',
    };
  }

  /**
   * Approve or reject an expense
   * 
   * @param {string} id - Expense ID
   * @param {string} userId - User approving/rejecting
   * @param {ExpenseStatus} status - New status (approved or rejected)
   * @param {string} [notes] - Optional approval notes
   * @returns {Promise<Expense>} Updated expense
   */
  async approveExpense(
    id: string,
    userId: string,
    status: ExpenseStatus.APPROVED | ExpenseStatus.REJECTED,
    notes?: string
  ): Promise<Expense> {
    const query = `
      UPDATE expenses
      SET status = $1, notes = COALESCE($2, notes)
      WHERE id = $3 AND user_id = $4
      RETURNING *
    `;

    const result = await this.db.query(query, [status, notes, id, userId]);

    if (result.rows.length === 0) {
      throw new Error('Expense not found or unauthorized');
    }

    return result.rows[0];
  }

  /**
   * Mark expense as reimbursed
   * 
   * @param {string} id - Expense ID
   * @param {string} userId - User marking as reimbursed
   * @returns {Promise<Expense>} Updated expense
   */
  async markReimbursed(id: string, userId: string): Promise<Expense> {
    const query = `
      UPDATE expenses
      SET status = $1
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `;

    const result = await this.db.query(query, [ExpenseStatus.REIMBURSED, id, userId]);

    if (result.rows.length === 0) {
      throw new Error('Expense not found or unauthorized');
    }

    return result.rows[0];
  }

  /**
   * Get expense summary/analytics
   * 
   * @param {string} userId - User ID
   * @param {object} filters - Optional date filters
   * @returns {Promise<ExpenseSummary>} Expense summary
   */
  async getExpenseSummary(
    userId: string,
    filters?: { date_from?: string; date_to?: string; project_id?: string }
  ): Promise<ExpenseSummary> {
    const conditions: string[] = ['user_id = $1'];
    const values: any[] = [userId];
    let paramIndex = 2;

    if (filters?.date_from) {
      conditions.push(`expense_date >= $${paramIndex++}`);
      values.push(filters.date_from);
    }

    if (filters?.date_to) {
      conditions.push(`expense_date <= $${paramIndex++}`);
      values.push(filters.date_to);
    }

    if (filters?.project_id) {
      conditions.push(`project_id = $${paramIndex++}`);
      values.push(filters.project_id);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Get totals
    const totalsQuery = `
      SELECT
        COUNT(*) AS total_expenses,
        COALESCE(SUM(amount), 0) AS total_amount,
        COALESCE(SUM(net_amount), 0) AS net_amount,
        COALESCE(SUM(tax_amount), 0) AS tax_amount,
        COALESCE(SUM(CASE WHEN is_billable = true THEN amount ELSE 0 END), 0) AS billable_amount,
        COALESCE(SUM(CASE WHEN is_billable = false THEN amount ELSE 0 END), 0) AS non_billable_amount,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) AS pending_amount,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) AS approved_amount,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN net_amount ELSE 0 END), 0) AS approved_net_amount,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN tax_amount ELSE 0 END), 0) AS approved_tax_amount
      FROM expenses
      ${whereClause}
    `;

    const totalsResult = await this.db.query(totalsQuery, values);
    const totals = totalsResult.rows[0];

    // Get by category
    const categoryQuery = `
      SELECT
        category,
        COUNT(*) AS count,
        COALESCE(SUM(amount), 0) AS total_amount
      FROM expenses
      ${whereClause}
      GROUP BY category
      ORDER BY total_amount DESC
    `;

    const categoryResult = await this.db.query(categoryQuery, values);

    return {
      total_expenses: parseInt(totals.total_expenses),
      total_amount: parseFloat(totals.total_amount),
      net_amount: parseFloat(totals.net_amount),
      tax_amount: parseFloat(totals.tax_amount),
      billable_amount: parseFloat(totals.billable_amount),
      non_billable_amount: parseFloat(totals.non_billable_amount),
      pending_amount: parseFloat(totals.pending_amount),
      approved_amount: parseFloat(totals.approved_amount),
      approved_net_amount: parseFloat(totals.approved_net_amount),
      approved_tax_amount: parseFloat(totals.approved_tax_amount),
      by_category: categoryResult.rows.map((row: any) => ({
        category: row.category,
        count: parseInt(row.count),
        total_amount: parseFloat(row.total_amount),
      })),
    };
  }

  /**
   * Get billable expenses for a project
   * Used for invoice generation
   * 
   * @param {string} projectId - Project ID
   * @param {string} userId - User ID
   * @returns {Promise<Expense[]>} Billable approved expenses
   */
  async getBillableExpensesForProject(projectId: string, userId: string): Promise<Expense[]> {
    const query = `
      SELECT *
      FROM expenses
      WHERE project_id = $1
        AND user_id = $2
        AND is_billable = true
        AND status = 'approved'
      ORDER BY expense_date ASC
    `;

    const result = await this.db.query(query, [projectId, userId]);
    return result.rows;
  }

  /**
   * Get all expenses generated from a recurring parent expense
   */
  async getExpensesByParent(parentExpenseId: string, userId: string): Promise<ExpenseWithProject[]> {
    const query = `
      SELECT
        e.*,
        p.name AS project_name,
        c.name AS client_name
      FROM expenses e
      LEFT JOIN projects p ON e.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE e.parent_expense_id = $1 AND e.user_id = $2
      ORDER BY e.expense_date DESC
    `;

    const result = await this.db.query(query, [parentExpenseId, userId]);
    return result.rows;
  }

  /**
   * Calculate depreciation schedule for an expense
   * Uses linear depreciation with pro-rata calculation for first/last year
   *
   * @param {string} expenseId - Expense ID
   * @param {string} userId - User ID
   * @param {number} years - Number of years to depreciate
   * @param {Date} startDate - Depreciation start date
   * @param {string} method - Depreciation method ('linear' or 'degressive')
   * @returns {Promise<void>}
   */
  async calculateDepreciationSchedule(
    expenseId: string,
    userId: string,
    years: number,
    startDate: Date,
    method: 'linear' | 'degressive' = 'linear'
  ): Promise<void> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      // Get expense details
      const expenseResult = await client.query(
        'SELECT net_amount FROM expenses WHERE id = $1 AND user_id = $2',
        [expenseId, userId]
      );

      if (expenseResult.rows.length === 0) {
        throw new Error('Expense not found');
      }

      const netAmount = parseFloat(expenseResult.rows[0].net_amount);

      // Delete existing schedule entries
      await client.query(
        'DELETE FROM expense_depreciation_schedule WHERE expense_id = $1',
        [expenseId]
      );

      // Calculate annual depreciation amount (linear method)
      const annualDepreciation = netAmount / years;

      // Calculate pro-rata for first year (months remaining in year)
      const startMonth = startDate.getMonth() + 1; // 1-12
      const monthsInFirstYear = 13 - startMonth; // Remaining months including start month
      const firstYearAmount = (annualDepreciation / 12) * monthsInFirstYear;

      // Generate schedule entries
      const startYear = startDate.getFullYear();
      let cumulativeAmount = 0;

      for (let i = 0; i < years; i++) {
        const year = startYear + i;
        let yearAmount: number;

        if (i === 0) {
          // First year - pro-rata
          yearAmount = firstYearAmount;
        } else if (i === years - 1) {
          // Last year - remaining amount to reach net_amount
          yearAmount = netAmount - cumulativeAmount;
        } else {
          // Full years
          yearAmount = annualDepreciation;
        }

        cumulativeAmount += yearAmount;
        const remainingValue = netAmount - cumulativeAmount;
        const isFinalYear = i === years - 1;

        await client.query(
          `INSERT INTO expense_depreciation_schedule
           (expense_id, user_id, year, amount, cumulative_amount, remaining_value, is_final_year)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [expenseId, userId, year, yearAmount, cumulativeAmount, remainingValue, isFinalYear]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update depreciation settings for an expense
   * 
   * If the expense is a recurring template (parent), this will also:
   * - Update all generated child expenses with the same depreciation settings
   * - Generate depreciation schedules for all children if partial depreciation
   *
   * @param {string} expenseId - Expense ID
   * @param {string} userId - User ID
   * @param {Object} depreciationData - Depreciation settings
   * @returns {Promise<Expense>} Updated expense
   */
  async updateDepreciationSettings(
    expenseId: string,
    userId: string,
    depreciationData: {
      depreciation_type: 'none' | 'immediate' | 'partial';
      depreciation_years?: number;
      depreciation_start_date?: Date;
      depreciation_method?: 'linear' | 'degressive';
      useful_life_category?: string;
      category?: string; // AI-suggested expense category
      tax_deductible_percentage?: number;
      tax_deductibility_reasoning?: string;
      ai_recommendation?: string;
      ai_analysis_performed?: boolean;
    }
  ): Promise<Expense> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      // Get expense details
      const expenseResult = await client.query(
        'SELECT * FROM expenses WHERE id = $1 AND user_id = $2',
        [expenseId, userId]
      );

      if (expenseResult.rows.length === 0) {
        throw new Error('Expense not found');
      }

      const expense = expenseResult.rows[0];
      const netAmount = parseFloat(expense.net_amount);

      // Calculate tax_deductible_amount based on depreciation type
      let taxDeductibleAmount: number;

      if (depreciationData.depreciation_type === 'none' || depreciationData.depreciation_type === 'immediate') {
        // Immediate deduction
        taxDeductibleAmount = netAmount;
      } else if (depreciationData.depreciation_type === 'partial') {
        // Calculate first year amount
        if (!depreciationData.depreciation_years || !depreciationData.depreciation_start_date) {
          throw new Error('depreciation_years and depreciation_start_date required for partial depreciation');
        }

        // For 1-year depreciation, always use full amount (no pro-rata)
        // Since 2021, IT equipment has 1-year useful life and is fully deductible in year of purchase
        if (depreciationData.depreciation_years === 1) {
          taxDeductibleAmount = netAmount;
        } else {
          // For multi-year depreciation, calculate pro-rata for first year
          const annualDepreciation = netAmount / depreciationData.depreciation_years;
          const startMonth = new Date(depreciationData.depreciation_start_date).getMonth() + 1;
          const monthsInFirstYear = 13 - startMonth;
          taxDeductibleAmount = (annualDepreciation / 12) * monthsInFirstYear;
        }

        // Generate depreciation schedule
        await this.calculateDepreciationSchedule(
          expenseId,
          userId,
          depreciationData.depreciation_years,
          new Date(depreciationData.depreciation_start_date),
          depreciationData.depreciation_method || 'linear'
        );
      } else {
        taxDeductibleAmount = netAmount;
      }

      // Update expense with depreciation settings
      const updateQuery = `
        UPDATE expenses
        SET
          depreciation_type = $1,
          depreciation_years = $2,
          depreciation_start_date = $3,
          depreciation_method = $4,
          useful_life_category = $5,
          tax_deductible_amount = $6,
          category = COALESCE($7, category),
          tax_deductible_percentage = COALESCE($8, tax_deductible_percentage),
          tax_deductibility_reasoning = COALESCE($9, tax_deductibility_reasoning),
          ai_recommendation = $10,
          ai_analysis_performed = $11,
          ai_analyzed_at = CASE WHEN $11 = true THEN CURRENT_TIMESTAMP ELSE ai_analyzed_at END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $12 AND user_id = $13
        RETURNING *
      `;

      const updateResult = await client.query(updateQuery, [
        depreciationData.depreciation_type,
        depreciationData.depreciation_years || null,
        depreciationData.depreciation_start_date || null,
        depreciationData.depreciation_method || 'linear',
        depreciationData.useful_life_category || null,
        taxDeductibleAmount,
        depreciationData.category || null,
        depreciationData.tax_deductible_percentage || null,
        depreciationData.tax_deductibility_reasoning || null,
        depreciationData.ai_recommendation || null,
        depreciationData.ai_analysis_performed ?? false,
        expenseId,
        userId,
      ]);

      // If this is a recurring template (parent expense), update all generated children too
      if (expense.is_recurring && !expense.parent_expense_id) {
        await client.query(`
          UPDATE expenses
          SET
            depreciation_type = $1,
            depreciation_years = $2,
            depreciation_start_date = $3,
            depreciation_method = $4,
            useful_life_category = $5,
            tax_deductible_amount = $6,
            category = COALESCE($7, category),
            tax_deductible_percentage = COALESCE($8, tax_deductible_percentage),
            tax_deductibility_reasoning = COALESCE($9, tax_deductibility_reasoning),
            ai_recommendation = $10,
            ai_analysis_performed = $11,
            ai_analyzed_at = CASE WHEN $11 = true THEN CURRENT_TIMESTAMP ELSE ai_analyzed_at END,
            updated_at = CURRENT_TIMESTAMP
          WHERE parent_expense_id = $12 AND user_id = $13
        `, [
          depreciationData.depreciation_type,
          depreciationData.depreciation_years || null,
          depreciationData.depreciation_start_date || null,
          depreciationData.depreciation_method || 'linear',
          depreciationData.useful_life_category || null,
          taxDeductibleAmount,
          depreciationData.category || null,
          depreciationData.tax_deductible_percentage || null,
          depreciationData.tax_deductibility_reasoning || null,
          depreciationData.ai_recommendation || null,
          depreciationData.ai_analysis_performed ?? false,
          expenseId, // parent_expense_id
          userId,
        ]);

        // Also generate depreciation schedules for all children if partial depreciation
        if (depreciationData.depreciation_type === 'partial' && 
            depreciationData.depreciation_years && 
            depreciationData.depreciation_start_date) {
          
          const childExpenses = await client.query(
            'SELECT id FROM expenses WHERE parent_expense_id = $1 AND user_id = $2',
            [expenseId, userId]
          );

          for (const child of childExpenses.rows) {
            await this.calculateDepreciationSchedule(
              child.id,
              userId,
              depreciationData.depreciation_years,
              new Date(depreciationData.depreciation_start_date),
              depreciationData.depreciation_method || 'linear'
            );
          }
        }
      }

      await client.query('COMMIT');
      return updateResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get tax-deductible amount for a specific year
   *
   * @param {string} expenseId - Expense ID
   * @param {string} userId - User ID
   * @param {number} year - Year to get deduction for
   * @returns {Promise<number>} Tax-deductible amount
   */
  async getTaxDeductibleAmount(expenseId: string, userId: string, year: number): Promise<number> {
    const expenseResult = await this.db.query(
      'SELECT depreciation_type, net_amount, tax_deductible_amount, EXTRACT(YEAR FROM expense_date) as expense_year FROM expenses WHERE id = $1 AND user_id = $2',
      [expenseId, userId]
    );

    if (expenseResult.rows.length === 0) {
      throw new Error('Expense not found');
    }

    const expense = expenseResult.rows[0];
    const expenseYear = parseInt(expense.expense_year);

    if (expense.depreciation_type === 'none' || expense.depreciation_type === 'immediate') {
      // Fully deductible in expense year only
      return year === expenseYear ? parseFloat(expense.net_amount) : 0;
    }

    if (expense.depreciation_type === 'partial') {
      // Get from depreciation schedule
      const scheduleResult = await this.db.query(
        'SELECT amount FROM expense_depreciation_schedule WHERE expense_id = $1 AND year = $2',
        [expenseId, year]
      );

      return scheduleResult.rows.length > 0 ? parseFloat(scheduleResult.rows[0].amount) : 0;
    }

    return 0;
  }

  /**
   * Get depreciation schedule for an expense
   *
   * @param {string} expenseId - Expense ID
   * @param {string} userId - User ID
   * @returns {Promise<any[]>} Depreciation schedule entries
   */
  async getDepreciationSchedule(expenseId: string, userId: string): Promise<any[]> {
    const query = `
      SELECT
        year,
        amount,
        cumulative_amount,
        remaining_value,
        is_final_year
      FROM expense_depreciation_schedule
      WHERE expense_id = $1 AND user_id = $2
      ORDER BY year ASC
    `;

    const result = await this.db.query(query, [expenseId, userId]);
    return result.rows.map(row => ({
      year: row.year,
      amount: parseFloat(row.amount),
      cumulative_amount: parseFloat(row.cumulative_amount),
      remaining_value: parseFloat(row.remaining_value),
      is_final_year: row.is_final_year,
    }));
  }

  /**
   * Save AI analysis response to database
   * Stores the complete analysis JSON so it can be displayed when reopening the expense
   *
   * @param {string} userId - User ID
   * @param {string} expenseId - Expense ID
   * @param {any} analysisResponse - Complete AI analysis object (as sent to frontend)
   */
  async saveAIAnalysis(userId: string, expenseId: string, analysisResponse: any): Promise<void> {
    const query = `
      UPDATE expenses
      SET ai_analysis_response = $1,
          ai_analyzed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND user_id = $3
    `;

    await this.db.query(query, [JSON.stringify(analysisResponse), expenseId, userId]);
  }

  /**
   * Clear saved AI analysis response
   * Called when re-analyzing or when analysis fails
   *
   * @param {string} userId - User ID
   * @param {string} expenseId - Expense ID
   */
  async clearAIAnalysis(userId: string, expenseId: string): Promise<void> {
    const query = `
      UPDATE expenses
      SET ai_analysis_response = NULL,
          ai_analyzed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2
    `;

    await this.db.query(query, [expenseId, userId]);
  }

  /**
   * Update all child expenses of a recurring template
   * Propagates changes from parent to all generated children
   *
   * @param {string} parentId - Parent expense ID (recurring template)
   * @param {UpdateExpenseData} data - Update data to propagate
   */
  private async updateChildExpenses(parentId: string, data: UpdateExpenseData): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Only propagate fields that should be inherited from parent template
    // Do NOT propagate: amount, expense_date, receipt, status (these are instance-specific)
    
    if (data.category !== undefined) {
      fields.push(`category = $${paramIndex++}`);
      values.push(data.category);
    }

    if (data.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }

    if (data.notes !== undefined) {
      fields.push(`notes = $${paramIndex++}`);
      values.push(data.notes);
    }

    if (data.is_billable !== undefined) {
      fields.push(`is_billable = $${paramIndex++}`);
      values.push(data.is_billable);
    }

    if (data.is_reimbursable !== undefined) {
      fields.push(`is_reimbursable = $${paramIndex++}`);
      values.push(data.is_reimbursable);
    }

    if (data.tags !== undefined) {
      fields.push(`tags = $${paramIndex++}`);
      values.push(data.tags);
    }

    // Propagate depreciation settings
    if (data.depreciation_type !== undefined) {
      fields.push(`depreciation_type = $${paramIndex++}`);
      values.push(data.depreciation_type);
      
      // Handle depreciation_start_date based on type
      // Don't set it again if data.depreciation_start_date is explicitly provided
      if (data.depreciation_start_date === undefined) {
        if (data.depreciation_type === 'partial') {
          // If setting to 'partial', ensure depreciation_start_date is set to expense_date
          fields.push(`depreciation_start_date = COALESCE(depreciation_start_date, expense_date)`);
        } else {
          // If changing to 'immediate' or 'none', clear depreciation fields
          fields.push(`depreciation_start_date = NULL`);
          fields.push(`depreciation_years = NULL`);
        }
      }
    }

    if (data.depreciation_years !== undefined) {
      fields.push(`depreciation_years = $${paramIndex++}`);
      values.push(data.depreciation_years);
    }

    if (data.depreciation_start_date !== undefined) {
      fields.push(`depreciation_start_date = $${paramIndex++}`);
      values.push(data.depreciation_start_date);
    }

    if (data.depreciation_method !== undefined) {
      fields.push(`depreciation_method = $${paramIndex++}`);
      values.push(data.depreciation_method);
    }

    if (data.useful_life_category !== undefined) {
      fields.push(`useful_life_category = $${paramIndex++}`);
      values.push(data.useful_life_category);
    }

    if (data.tax_deductible_percentage !== undefined) {
      fields.push(`tax_deductible_percentage = $${paramIndex++}`);
      values.push(data.tax_deductible_percentage);
    }

    if (data.tax_deductibility_reasoning !== undefined) {
      fields.push(`tax_deductibility_reasoning = $${paramIndex++}`);
      values.push(data.tax_deductibility_reasoning);
    }

    // If there are no fields to update, return early
    if (fields.length === 0) {
      return;
    }

    // Add updated_at timestamp
    fields.push(`updated_at = CURRENT_TIMESTAMP`);

    const query = `
      UPDATE expenses
      SET ${fields.join(', ')}
      WHERE parent_expense_id = $${paramIndex}
    `;

    values.push(parentId);
    
    const result = await this.db.query(query, values);
    console.log(`[UpdateChildExpenses] Updated ${result.rowCount} child expenses for parent ${parentId}`);
  }
}

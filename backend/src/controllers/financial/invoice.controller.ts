import { Request, Response, NextFunction } from 'express';
import { InvoiceService } from '../../services/financial/invoice.service';
import { BillingValidationService } from '../../services/financial/billing-validation.service';
import { getDbClient } from '../../utils/database'; // Import the DB client utility
import { InvoicePdfController } from './invoice-pdf.controller';
import { logger } from '../../utils/logger';
import { processPlaceholders, PlaceholderContext, getAvailablePlaceholders } from '../../utils/placeholder';

// Joi Validation Schemas
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  addLineItemsSchema,
  generateFromTimeEntriesSchema,
  billingHistoryParamsSchema,
  findInvoiceByNumberParamsSchema,
  invoiceIdSchema, 
} from '../../schemas/financial/invoice.schema';

/**
 * Generic validation middleware using Joi schemas.
 * Validates request body against provided schema.
 * 
 * @param {any} schema - Joi validation schema
 * @returns {Function} Express middleware function
 */
const validate = (schema: any) => (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body || {}, { abortEarly: false });
    if (error) {
        // Joi.ValidationErrorItem is an internal type. We can use `any` or a more generic type if available.
        // For simplicity and to avoid import complexity, we'll use `any` here for detail.message.
        const errorMessage = error.details.map((detail: any) => detail.message).join(', ');
        res.status(400).json({ message: 'Validation failed', details: errorMessage });
        return;
    }
    next();
};

/**
 * Validation middleware for request params or query parameters.
 * Validates against provided Joi schema.
 * 
 * @param {any} schema - Joi validation schema
 * @param {'params' | 'query'} target - Target to validate (params or query)
 * @returns {Function} Express middleware function
 */
const validateParams = (schema: any, target: 'params' | 'query' = 'params') => (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req[target], { abortEarly: false });
    if (error) {
        // Joi.ValidationErrorItem is an internal type. We can use `any` or a more generic type if available.
        // For simplicity and to avoid import complexity, we'll use `any` here for detail.message.
        const errorMessage = error.details.map((detail: any) => detail.message).join(', ');
        res.status(400).json({ message: 'Validation failed', details: errorMessage });
        return;
    }
    next();
};

/**
 * Interface for time entry records used in invoice generation.
 * Represents time entries that will be converted to invoice line items.
 * 
 * @interface TimeEntryForInvoice
 */
interface TimeEntryForInvoice {
  id: string;
  description?: string | null;
  duration_hours?: number | null; // Hours worked (may be NULL if calculated from timestamps)
  date_start?: Date | string | null; // Start timestamp for calculating duration
  date_end?: Date | string | null; // End timestamp for calculating duration
  hourly_rate?: number | null; // Hourly rate from time entry (may be NULL)
  time_entry_rate?: number | null; // Explicit time entry rate
  project_rate?: number | null; // Fallback hourly rate from project
  effective_rate?: number; // Calculated rate with fallback logic (time entry -> project -> 0)
  project_id: string | null;
  project_name?: string | null; // Project name for description fallback
  task_name?: string | null; // Task name for description fallback
  entry_date: string; // DATE type from PostgreSQL returns a string representation
}

/**
 * Controller for handling HTTP requests related to invoice management.
 * Provides CRUD operations, invoice generation from time entries, and billing history.
 * Includes comprehensive validation and automatic calculation of financial totals.
 * 
 * @class InvoiceController
 */
export class InvoiceController {
  private invoiceService: InvoiceService;
  private billingValidationService: BillingValidationService;
  private invoicePdf: InvoicePdfController;

  constructor() {
    this.invoiceService = new InvoiceService();
    this.billingValidationService = new BillingValidationService();
    this.invoicePdf = new InvoicePdfController();
  }

  /**
   * Provides access to the database client for complex queries.
   * 
   * @private
   * @returns {Pool} PostgreSQL connection pool
   */
  private get db() {
    return getDbClient(); // Provide access to the db client for complex queries
  }

  /**
   * Creates a new invoice in the database.
   * Validates request body against createInvoiceSchema.
   * Automatically injects user_id from authenticated user.
   * Processes placeholders in text fields (invoice_text, footer_text, tax_exemption_text, notes).
   * 
   * @async
   * @param {Request} req - Express request object with invoice data in body
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 201 with created invoice or error response
   * 
   * @example
   * POST /api/invoices
   * Body: {
   *   "client_id": "client-uuid",
   *   "project_id": "project-uuid",
   *   "status": "draft",
   *   "issue_date": "2024-01-15",
   *   "due_date": "2024-02-15",
   *   "invoice_text": "Invoice for {{client}} - {{month-1}} {{year}}"
   * }
   * Response: 201 { message: "Invoice created successfully", invoice: {...} }
   */
  async create(req: Request, res: Response) {
    try {
      const validatedBody = req.body; // Joi schema will validate all required fields
      const userId = (req as any).user?.id;

      // Fetch client and project data for placeholder context
      let clientData: any = null;
      let projectData: any = null;

      if (validatedBody.client_id) {
        const clientResult = await this.db.query(
          'SELECT id, name, email, phone FROM clients WHERE id = $1',
          [validatedBody.client_id]
        );
        clientData = clientResult.rows[0];
      }

      if (validatedBody.project_id) {
        const projectResult = await this.db.query(
          'SELECT id, name FROM projects WHERE id = $1',
          [validatedBody.project_id]
        );
        projectData = projectResult.rows[0];
      }

      // Get user's preferred language from request or default to 'en'
      const userLanguage = (req as any).user?.language || 'en';

      // Build placeholder context
      const placeholderContext: PlaceholderContext = {
        client_name: clientData?.name,
        client_email: clientData?.email,
        client_phone: clientData?.phone,
        project_name: projectData?.name,
        issue_date: validatedBody.issue_date ? new Date(validatedBody.issue_date) : undefined,
        due_date: validatedBody.due_date ? new Date(validatedBody.due_date) : undefined,
        currency: validatedBody.currency || 'USD',
        language: userLanguage,
        referenceDate: new Date(),
      };

      // Process placeholders in text fields
      const invoiceData = {
        ...validatedBody,
        user_id: userId,
        invoice_headline: validatedBody.invoice_headline 
          ? processPlaceholders(validatedBody.invoice_headline, placeholderContext) 
          : validatedBody.invoice_headline,
        invoice_text: validatedBody.invoice_text 
          ? processPlaceholders(validatedBody.invoice_text, placeholderContext) 
          : validatedBody.invoice_text,
        footer_text: validatedBody.footer_text 
          ? processPlaceholders(validatedBody.footer_text, placeholderContext) 
          : validatedBody.footer_text,
        tax_exemption_text: validatedBody.tax_exemption_text 
          ? processPlaceholders(validatedBody.tax_exemption_text, placeholderContext) 
          : validatedBody.tax_exemption_text,
        notes: validatedBody.notes 
          ? processPlaceholders(validatedBody.notes, placeholderContext) 
          : validatedBody.notes,
      };

      const invoice = await this.invoiceService.create(invoiceData);
      res.status(201).json({
        message: 'Invoice created successfully',
        invoice,
      });
    } catch (err: any) {
      logger.error('Create invoice error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  /**
   * Retrieves all invoices from the database.
   * Returns invoices ordered by creation date (newest first).
   * 
   * @async
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 with array of invoices or error response
   * 
   * @example
   * GET /api/invoices
   * Response: 200 [{ id: "uuid", invoice_number: "INV-20240115-001", status: "sent", ... }, ...]
   */
  async findAll(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const invoices = await this.invoiceService.findAll(userId);
      res.status(200).json(invoices);
    } catch (err: any) {
      logger.error('Find all invoices error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  /**
   * Retrieves a single invoice by its ID.
   * Validates the ID format using Joi schema before querying.
   * 
   * @async
   * @param {Request} req - Express request object with params.id
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 with invoice or 404 if not found
   * 
   * @example
   * GET /api/invoices/123e4567-e89b-12d3-a456-426614174000
   * Response: 200 { id: "uuid", invoice_number: "INV-20240115-001", status: "sent", ... }
   * Response: 404 { message: "Invoice not found" }
   */
  async findById(req: Request, res: Response) {
    // Validate id using Joi schema before proceeding
    const { error } = invoiceIdSchema.validate(req.params.id); 
    if (error) {
        res.status(400).json({ message: 'Invalid Invoice ID.', details: error.details[0].message });
        return;
    }
    
    try {
      const invoice = await this.invoiceService.findById(req.params.id);
      if (invoice) {
        res.status(200).json(invoice);
      } else {
        res.status(404).json({ message: 'Invoice not found' });
      }
    } catch (err: any) {
      logger.error('Find invoice by ID error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  /**
   * Updates an existing invoice with partial data.
   * Only provided fields will be updated. Validates ID format and body schema.
   * Processes placeholders in text fields if they are being updated.
   * 
   * @async
   * @param {Request} req - Express request object with params.id and body containing update data
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 with updated invoice or 404 if not found
   * 
   * @example
   * PUT /api/invoices/123e4567-e89b-12d3-a456-426614174000
   * Body: { status: "paid", notes: "Payment received on {{date}}" }
   * Response: 200 { message: "Invoice updated successfully", invoice: { ... } }
   * Response: 404 { message: "Invoice not found" }
   */
  async update(req: Request, res: Response) {
    // Validate id using Joi schema before proceeding
    const { error } = invoiceIdSchema.validate(req.params.id); 
    if (error) {
        res.status(400).json({ message: 'Invalid Invoice ID.', details: error.details[0].message });
        return;
    }

    try {
      const validatedBody = req.body; // Joi schema will validate all required fields

      // Fetch current invoice to get context data
      const currentInvoice = await this.invoiceService.findById(req.params.id);
      if (!currentInvoice) {
        res.status(404).json({ message: 'Invoice not found' });
        return;
      }

      // Fetch client and project data if they exist
      let clientData: any = null;
      let projectData: any = null;

      const clientId = validatedBody.client_id || currentInvoice.client_id;
      const projectId = validatedBody.project_id || currentInvoice.project_id;

      if (clientId) {
        const clientResult = await this.db.query(
          'SELECT id, name, email, phone FROM clients WHERE id = $1',
          [clientId]
        );
        clientData = clientResult.rows[0];
      }

      if (projectId) {
        const projectResult = await this.db.query(
          'SELECT id, name FROM projects WHERE id = $1',
          [projectId]
        );
        projectData = projectResult.rows[0];
      }

      // Get user's preferred language
      const userLanguage = (req as any).user?.language || 'en';

      // Build placeholder context
      const placeholderContext: PlaceholderContext = {
        invoice_number: validatedBody.invoice_number || currentInvoice.invoice_number,
        client_name: clientData?.name,
        client_email: clientData?.email,
        client_phone: clientData?.phone,
        project_name: projectData?.name,
        issue_date: validatedBody.issue_date 
          ? new Date(validatedBody.issue_date) 
          : currentInvoice.issue_date,
        due_date: validatedBody.due_date 
          ? new Date(validatedBody.due_date) 
          : currentInvoice.due_date,
        total: validatedBody.total_amount || currentInvoice.total_amount,
        currency: validatedBody.currency || currentInvoice.currency,
        language: userLanguage,
        referenceDate: new Date(),
      };

      // Process placeholders in text fields if they're being updated
      // Empty strings should be converted to null to clear the field
      const updateData = {
        ...validatedBody,
        invoice_headline: validatedBody.invoice_headline !== undefined
          ? (validatedBody.invoice_headline === '' ? null : processPlaceholders(validatedBody.invoice_headline, placeholderContext))
          : undefined,
        invoice_text: validatedBody.invoice_text !== undefined
          ? (validatedBody.invoice_text === '' ? null : processPlaceholders(validatedBody.invoice_text, placeholderContext))
          : undefined,
        footer_text: validatedBody.footer_text !== undefined
          ? (validatedBody.footer_text === '' ? null : processPlaceholders(validatedBody.footer_text, placeholderContext))
          : undefined,
        tax_exemption_text: validatedBody.tax_exemption_text !== undefined
          ? (validatedBody.tax_exemption_text === '' ? null : processPlaceholders(validatedBody.tax_exemption_text, placeholderContext))
          : undefined,
        notes: validatedBody.notes !== undefined
          ? (validatedBody.notes === '' ? null : processPlaceholders(validatedBody.notes, placeholderContext))
          : undefined,
      };

      // Remove undefined fields so we don't overwrite with undefined
      // Note: null values should remain to clear fields
      Object.keys(updateData).forEach(key => 
        updateData[key as keyof typeof updateData] === undefined && delete updateData[key as keyof typeof updateData]
      );

      const updatedInvoice = await this.invoiceService.update(req.params.id, updateData);
      if (updatedInvoice) {
        res.status(200).json({
          message: 'Invoice updated successfully',
          invoice: updatedInvoice,
        });
      } else {
        res.status(404).json({ message: 'Invoice not found' });
      }
    } catch (err: any) {
      logger.error('Update invoice error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  /**
   * Cancels an invoice by setting its status to 'cancelled'.
   * Cannot cancel invoices that are already cancelled.
   * 
   * @async
   * @param {Request} req - Express request object with params.id
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 on success, 404 if not found, or 400 if already cancelled
   * 
   * @example
   * PATCH /api/invoices/123e4567-e89b-12d3-a456-426614174000/cancel
   * Response: 200 { message: "Invoice cancelled successfully", invoice: {...} }
   */
  async cancel(req: Request, res: Response) {
    // Validate id using Joi schema before proceeding
    const { error } = invoiceIdSchema.validate(req.params.id); 
    if (error) {
        res.status(400).json({ message: 'Invalid Invoice ID.', details: error.details[0].message });
        return;
    }

    try {
      // Get current invoice to check status
      const currentInvoice = await this.invoiceService.findById(req.params.id);
      
      if (!currentInvoice) {
        res.status(404).json({ message: 'Invoice not found' });
        return;
      }

      if (currentInvoice.status === 'cancelled') {
        res.status(400).json({ message: 'Invoice is already cancelled' });
        return;
      }

      // Update status to cancelled
      const cancelledInvoice = await this.invoiceService.update(req.params.id, { status: 'cancelled' });
      
      res.status(200).json({
        message: 'Invoice cancelled successfully',
        invoice: cancelledInvoice,
      });
    } catch (err: any) {
      logger.error('Cancel invoice error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  /**
   * Creates a correction for an existing invoice.
   * Stores the original invoice data and allows modifications.
   * The original invoice data is preserved for generating correction PDFs.
   * 
   * @async
   * @param {Request} req - Express request object with params.id and body with correction data
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 with corrected invoice
   * 
   * @example
   * POST /api/invoices/123e4567-e89b-12d3-a456-426614174000/correct
   * Body: { correction_reason: "Price adjustment", items: [...], notes: "..." }
   * Response: 200 { message: "Invoice correction created", invoice: {...} }
   */
  async createCorrection(req: Request, res: Response) {
    const { error } = invoiceIdSchema.validate(req.params.id);
    if (error) {
      res.status(400).json({ message: 'Invalid Invoice ID.', details: error.details[0].message });
      return;
    }

    try {
      // Fetch current invoice with all data
      const currentInvoice = await this.invoiceService.findById(req.params.id);
      
      if (!currentInvoice) {
        res.status(404).json({ message: 'Invoice not found' });
        return;
      }

      // Only allow corrections for non-draft, non-cancelled invoices
      if (currentInvoice.status === 'draft') {
        res.status(400).json({ message: 'Draft invoices can be edited directly without creating a correction' });
        return;
      }

      if (currentInvoice.status === 'cancelled') {
        res.status(400).json({ message: 'Cannot create a correction for a cancelled invoice' });
        return;
      }

      // Store original data snapshot before making changes
      const originalData = {
        invoice_number: currentInvoice.invoice_number,
        issue_date: currentInvoice.issue_date,
        due_date: currentInvoice.due_date,
        delivery_date: currentInvoice.delivery_date,
        sub_total: currentInvoice.sub_total,
        tax_rate: currentInvoice.tax_rate,
        tax_amount: currentInvoice.tax_amount,
        total_amount: currentInvoice.total_amount,
        currency: currentInvoice.currency,
        notes: currentInvoice.notes,
        invoice_headline: currentInvoice.invoice_headline,
        invoice_text: currentInvoice.invoice_text,
        footer_text: currentInvoice.footer_text,
        items: (currentInvoice as any).items?.map((item: any) => ({
          id: item.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.total,
        })),
      };

      const { correction_reason, items, ...updateFields } = req.body;

      // Build dynamic UPDATE query for invoice fields
      const updateParts: string[] = [
        'original_data = $1',
        'correction_reason = $2',
        'correction_date = NOW()',
        'updated_at = NOW()'
      ];
      const updateValues: any[] = [JSON.stringify(originalData), correction_reason || 'Correction'];
      let paramIndex = 3;

      // Add any provided update fields (due_date, issue_date, notes, etc.)
      const allowedFields = ['invoice_number', 'due_date', 'issue_date', 'delivery_date', 'notes', 'invoice_headline', 'invoice_text', 'footer_text'];
      for (const field of allowedFields) {
        if (updateFields[field] !== undefined) {
          updateParts.push(`${field} = $${paramIndex}`);
          updateValues.push(updateFields[field]);
          paramIndex++;
        }
      }

      // Add the invoice ID as the last parameter
      updateValues.push(req.params.id);

      // Update invoice with correction data and any changed fields
      const correctedInvoice = await this.db.query(
        `UPDATE invoices 
         SET ${updateParts.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING *`,
        updateValues
      );

      // If there are line items updates, handle them
      if (items && Array.isArray(items)) {
        // Delete existing line items
        await this.db.query('DELETE FROM invoice_items WHERE invoice_id = $1', [req.params.id]);
        
        // Insert new line items
        for (const item of items) {
          await this.db.query(
            `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total_price)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              req.params.id,
              item.description,
              item.quantity,
              item.unit_price,
              item.quantity * item.unit_price,
            ]
          );
        }

        // Recalculate totals using the service method
        await this.invoiceService.calculateInvoiceTotals(req.params.id);
      }

      // Fetch the updated invoice with all relations
      const updatedInvoice = await this.invoiceService.findById(req.params.id);

      res.status(200).json({
        message: 'Invoice correction created successfully',
        invoice: updatedInvoice,
      });
    } catch (err: any) {
      logger.error('Create correction error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  /**
   * Deletes an invoice from the database.
   * May fail if the invoice has associated line items (foreign key constraint).
   * 
   * @async
   * @param {Request} req - Express request object with params.id
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 on success, 404 if not found, or 500 on constraint violation
   * 
   * @example
   * DELETE /api/invoices/123e4567-e89b-12d3-a456-426614174000
   * Response: 200 { message: "Invoice deleted successfully" }
   * Response: 404 { message: "Invoice not found or already deleted" }
   * Response: 500 { message: "Cannot delete invoice with line items" }
   */
  async delete(req: Request, res: Response) {
    // Validate id using Joi schema before proceeding
    const { error } = invoiceIdSchema.validate(req.params.id); 
    if (error) {
        res.status(400).json({ message: 'Invalid Invoice ID.', details: error.details[0].message });
        return;
    }

    try {
      const deleted = await this.invoiceService.delete(req.params.id);
      if (deleted) {
        res.status(200).json({ message: 'Invoice deleted successfully' });
      } else {
        res.status(404).json({ message: 'Invoice not found or already deleted' });
      }
    } catch (err: any) {
      logger.error('Delete invoice error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  /**
   * Adds line items to an existing invoice.
   * Each line item can optionally reference a time entry for tracking billable hours.
   * After adding items, automatically recalculates invoice totals.
   * 
   * @async
   * @param {Request} req - Express request object with params.id and body.items array
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 with updated invoice including new line items
   * 
   * @example
   * POST /api/invoices/123e4567-e89b-12d3-a456-426614174000/items
   * Body: { items: [{ description: "Development", quantity: 10, unit_price: 100, time_entry_id: "uuid" }] }
   * Response: 200 { message: "Line items added successfully", invoice: { ..., items: [...] } }
   */
  // Add line items to an existing invoice
  async addLineItems(req: Request, res: Response) {
    // Validate id using Joi schema before proceeding
    const { error } = invoiceIdSchema.validate(req.params.id); 
    if (error) {
        res.status(400).json({ message: 'Invalid Invoice ID.', details: error.details[0].message });
        return;
    }

    try {
      // Body validation is done by Joi schema
      const validatedBody = req.body;
      const { items } = validatedBody; // Destructure from validated body

      if (!Array.isArray(items)) { // Basic check for type, though Joi should ensure this
        res.status(400).json({ message: 'Items must be an array' });
        return;
      }

      await this.invoiceService.addLineItems(req.params.id, items);
      
      // Fetch updated invoice with line items
      const updatedInvoice = await this.invoiceService.findById(req.params.id);
      
      res.status(200).json({
        message: 'Line items added successfully',
        invoice: updatedInvoice,
      });
    } catch (err: any) {
      logger.error('Add line items error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  /**
   * Replaces all line items for an invoice (deletes existing, adds new).
   * Used when editing an invoice and updating its line items.
   *
   * @async
   * @param {Request} req - Express request with params.id and body.items array
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 with updated invoice including new items
   *
   * @example
   * PUT /api/invoices/123e4567-e89b-12d3-a456-426614174000/items
   * Body: { items: [{ description: "Development", quantity: 10, unit_price: 100 }] }
   * Response: 200 { message: "Line items replaced successfully", invoice: { ..., items: [...] } }
   */
  async replaceLineItems(req: Request, res: Response) {
    const { error } = invoiceIdSchema.validate(req.params.id);
    if (error) {
      res.status(400).json({ message: 'Invalid Invoice ID.', details: error.details[0].message });
      return;
    }

    try {
      const validatedBody = req.body;
      const { items } = validatedBody;

      if (!Array.isArray(items)) {
        res.status(400).json({ message: 'Items must be an array' });
        return;
      }

      await this.invoiceService.replaceLineItems(req.params.id, items);

      // Fetch updated invoice with line items
      const updatedInvoice = await this.invoiceService.findById(req.params.id);

      res.status(200).json({
        message: 'Line items replaced successfully',
        invoice: updatedInvoice,
      });
    } catch (err: any) {
      logger.error('Replace line items error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  /**
   * Generates an invoice from billable time entries within a date range.
   * Automatically creates invoice, fetches time entries matching criteria, and adds them as line items.
   * If only project_id is provided, derives client_id from the project.
   * 
   * @async
   * @param {Request} req - Express request with body containing project_id, client_id, start_date, end_date
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 201 with generated invoice or 404 if no time entries found
   * 
   * @example
   * POST /api/invoices/generate
   * Body: { project_id: "uuid", start_date: "2024-01-01", end_date: "2024-01-31" }
   * Response: 201 { message: "Invoice generated from time entries successfully", invoice: { ..., items: [...] } }
   * Response: 404 { message: "No time entries found for the selected criteria.", invoice: {...} }
   */
  // Generate an invoice from time entries
  async generateFromTimeEntries(req: Request, res: Response) {
    // Validate request body using Joi schema before proceeding
    const { error, value } = generateFromTimeEntriesSchema.validate(req.body); 
    if (error) {
        res.status(400).json({ message: 'Invalid request data.', details: error.details[0].message });
        return;
    }
    
    // Body validation is done by Joi schema
    const validatedBody = value;
    const { 
      project_id, 
      client_id, 
      start_date, 
      end_date,
      invoice_headline,
      header_template_id,
      footer_template_id,
      terms_template_id
    } = validatedBody; // Destructure from validated body

    try {
      // Determine client_id for the invoice
      let finalClientId = client_id; // Use destructured value
      const projectIdForQuery = project_id; // Use destructured value

      // Resolve project currency: project → user settings → 'EUR'
      let resolvedCurrency = 'EUR';

      if (project_id) {
        const projectQuery = `SELECT client_id, currency FROM projects WHERE id = $1 AND user_id = $2`;
        const projectResult = await this.db.query(projectQuery, [project_id, (req as any).user?.id]);

        if (projectResult.rows.length === 0) {
          res.status(404).json({ message: 'Project not found or you do not have access.' });
          return;
        }

        if (!client_id) {
          finalClientId = projectResult.rows[0].client_id;
        }

        if (projectResult.rows[0].currency) {
          resolvedCurrency = projectResult.rows[0].currency;
        }
      }

      // Fall back to user settings currency when no project currency was found
      if (resolvedCurrency === 'EUR' && !project_id) {
        const settingsResult = await this.db.query(
          `SELECT default_currency FROM settings WHERE user_id = $1`,
          [(req as any).user?.id]
        );
        if (settingsResult.rows[0]?.default_currency) {
          resolvedCurrency = settingsResult.rows[0].default_currency;
        }
      }

      // Create a new invoice with customization fields
      const invoiceData = {
        user_id: (req as any).user?.id,
        client_id: finalClientId,
        project_id: projectIdForQuery, // Store the specific project if provided, null otherwise
        issue_date: new Date(), // Invoice is issued today
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        status: 'draft' as const,
        currency: resolvedCurrency,
        invoice_headline: invoice_headline || null,
        header_template_id: header_template_id || null,
        footer_template_id: footer_template_id || null,
        terms_template_id: terms_template_id || null,
      };

      const invoice = await this.invoiceService.create(invoiceData);

      if (!invoice.id) {
          throw new Error("Failed to create invoice - no ID returned.");
      }

      // Fetch relevant time entries for the client/project within date range
      let timeEntriesQuery = `
        SELECT 
          te.id, 
          te.description, 
          te.duration_hours,
          te.entry_date,
          te.entry_time,
          te.entry_end_time,
          te.project_id, 
          te.hourly_rate as time_entry_rate,
          te.task_name,
          p.name as project_name,
          p.hourly_rate as project_rate,
          COALESCE(te.hourly_rate, p.hourly_rate, 0) as effective_rate
        FROM time_entries te
        INNER JOIN projects p ON te.project_id = p.id
        WHERE te.user_id = $1 AND te.is_billable = true
      `;
      const queryValues: (string | Date | number | null)[] = [(req as any).user?.id];
      
      // Filter by client_id through the projects table
      if (finalClientId) {
          timeEntriesQuery += ` AND p.client_id = $${queryValues.length + 1}`;
          queryValues.push(finalClientId);
      }

      if (projectIdForQuery) {
          timeEntriesQuery += ` AND te.project_id = $${queryValues.length + 1}`;
          queryValues.push(projectIdForQuery);
      }

      if (start_date) {
        timeEntriesQuery += ` AND te.entry_date >= $${queryValues.length + 1}`;
        queryValues.push(new Date(start_date));
      }
      if (end_date) {
        timeEntriesQuery += ` AND te.entry_date <= $${queryValues.length + 1}`;
        queryValues.push(new Date(end_date));
      }
      
      timeEntriesQuery += ` ORDER BY te.entry_date ASC, te.entry_time ASC`;

      const timeEntriesResult = await this.db.query(timeEntriesQuery, queryValues);

      if (timeEntriesResult.rows.length === 0) {
          res.status(404).json({ 
              message: 'No time entries found for the selected criteria.',
              invoice // Still return the draft invoice
          });
          return;
      }

      // Calculate delivery_date from time entries (MM/YYYY format from earliest entry month)
      const timeEntriesDates = timeEntriesResult.rows.map((entry: any) => new Date(entry.entry_date));
      const earliestDate = timeEntriesDates.length > 0 
        ? new Date(Math.min(...timeEntriesDates.map(d => d.getTime())))
        : new Date();
      const deliveryDate = earliestDate.toLocaleDateString('de-DE', { month: '2-digit', year: 'numeric' });
      
      // Update the invoice with the calculated delivery_date
      await this.db.query(
        'UPDATE invoices SET delivery_date = $1 WHERE id = $2',
        [deliveryDate, invoice.id]
      );

      // Group time entries by project and sum hours
      const projectSummaryMap = new Map<string, {
        project_id: string;
        project_name: string;
        total_hours: number;
        hourly_rate: number;
        time_entry_ids: string[];
      }>();

      timeEntriesResult.rows.forEach((entry: TimeEntryForInvoice) => {
        const projectId = entry.project_id || 'no-project';
        const hourlyRate = Number(entry.effective_rate) || 0;
        const hours = Number(entry.duration_hours) || 0;

        // Group by project AND rate. Rates change over time and entries are
        // stamped with the rate agreed when the work happened, so one project
        // can legitimately contribute several rates to the same invoice.
        // Keying by project alone priced every hour at whichever rate the query
        // happened to return first (ORDER BY entry_date, so the oldest) and
        // silently mis-billed every hour logged after a rate change.
        // A running timer has duration 0 and would otherwise open its own group
        // (its rate can differ from the billed ones), producing a 0.00 line item
        // that only exists because a timer happened to be running.
        if (hours <= 0) return;

        // toFixed pins the key to the economic rate: 100 and 100.00 arrive from
        // pg as different strings but must not become two line items.
        const groupKey = `${projectId}::${hourlyRate.toFixed(2)}`;

        if (!projectSummaryMap.has(groupKey)) {
          projectSummaryMap.set(groupKey, {
            project_id: projectId,
            project_name: entry.project_name || 'Ohne Projekt',
            total_hours: 0,
            hourly_rate: hourlyRate,
            time_entry_ids: []
          });
        }

        const summary = projectSummaryMap.get(groupKey)!;
        summary.total_hours += hours;
        summary.time_entry_ids.push(entry.id);
      });

      // Create one line item per project
      const summaries = Array.from(projectSummaryMap.values());
      // A project split across several rates needs the rate in the description,
      // otherwise the invoice shows the same project name twice with no
      // explanation of why the unit prices differ.
      const splitProjects = new Set(
        summaries
          .map(s => s.project_id)
          .filter((id, idx, all) => all.indexOf(id) !== idx)
      );

      // Keep a project's rate-split lines next to each other; the map is keyed
      // by project+rate, so insertion order alone would interleave projects.
      summaries.sort((a, b) =>
        a.project_name === b.project_name
          ? a.hourly_rate - b.hourly_rate
          : a.project_name.localeCompare(b.project_name)
      );

      const rateLabel = (rate: number) =>
        new Intl.NumberFormat('de-DE', {
          style: 'currency',
          currency: invoice.currency || 'EUR',
        }).format(rate);

      const lineItems = summaries.map(summary => {
        const totalPrice = summary.hourly_rate * summary.total_hours;

        return {
          id: crypto.randomUUID(),
          invoice_id: invoice.id,
          created_at: new Date(),
          description: splitProjects.has(summary.project_id)
            ? `${summary.project_name} (${rateLabel(summary.hourly_rate)}/h)`
            : summary.project_name,
          quantity: summary.total_hours,
          unit_price: summary.hourly_rate,
          total_price: totalPrice,
          time_entry_id: null // Multiple entries, so we don't link to a single one
        };
      });

      // Add these line items to the created invoice
      await this.invoiceService.addLineItems(invoice.id, lineItems);
      
      const updatedInvoice = await this.invoiceService.findById(invoice.id); // Fetch with calculated totals
      
      res.status(201).json({
        message: 'Invoice generated from time entries successfully',
        invoice: updatedInvoice,
      });

    } catch (err: any) {
      logger.error('Generate invoice from time entries error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  /**
   * Retrieves billing history for a specific client.
   * Returns all invoices for the client with payment information, including:
   * - Invoice details (number, dates, status, total)
   * - Amount paid (sum of non-cancelled payments)
   * - Outstanding balance (total - amount paid)
   * 
   * @async
   * @param {Request} req - Express request with params.client_id
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 with billing history array or 404 if client not found
   * 
   * @example
   * GET /api/invoices/billing-history/123e4567-e89b-12d3-a456-426614174000
   * Response: 200 [{ 
   *   id: "uuid", 
   *   invoice_number: "INV-20240115-001", 
   *   total_amount: 1000, 
   *   amount_paid: 500,
   *   outstanding_balance: 500,
   *   status: "sent"
   * }]
   */
  // Get billing history for a client
  async getBillingHistory(req: Request, res: Response) {
    // Params validation is done by Joi schema
    const { client_id } = req.params; // Destructure from validated params
    
    // Ensure user has access to this client
    const validateClient = await this.db.query(
      `SELECT c.id FROM clients c WHERE c.id = $1 AND c.user_id = $2`,
      [client_id, (req as any).user?.id]
    );
    if (validateClient.rows.length === 0) {
        res.status(404).json({ message: 'Client not found or no access.' });
        return;
    }

    try {
      // Calculate amount_paid using both direct invoice_id (legacy) and the
      // payment_invoices junction table (new system), so all payment records
      // are included regardless of which linking method was used.
      const queryText = `
        SELECT
          i.id,
          i.invoice_number,
          TO_CHAR(i.issue_date, 'YYYY-MM-DD') as issue_date,
          TO_CHAR(i.due_date, 'YYYY-MM-DD') as due_date,
          i.sub_total,
          i.total_amount,
          i.status,
          i.currency,
          COALESCE((
            SELECT SUM(
              CASE
                WHEN p.payment_type = 'payment' THEN COALESCE(pi.amount, p.amount)
                ELSE -COALESCE(pi.amount, p.amount)
              END
            )
            FROM payments p
            LEFT JOIN payment_invoices pi ON p.id = pi.payment_id AND pi.invoice_id = i.id
            WHERE
              pi.invoice_id = i.id
              OR (p.invoice_id = i.id AND NOT EXISTS (
                SELECT 1 FROM payment_invoices WHERE payment_id = p.id
              ))
          ), 0) AS amount_paid,
          (i.sub_total - COALESCE((
            SELECT SUM(
              CASE
                WHEN p.payment_type = 'payment' THEN COALESCE(pi.amount, p.amount)
                ELSE -COALESCE(pi.amount, p.amount)
              END
            )
            FROM payments p
            LEFT JOIN payment_invoices pi ON p.id = pi.payment_id AND pi.invoice_id = i.id
            WHERE
              pi.invoice_id = i.id
              OR (p.invoice_id = i.id AND NOT EXISTS (
                SELECT 1 FROM payment_invoices WHERE payment_id = p.id
              ))
          ), 0)) AS outstanding_balance
        FROM invoices i
        WHERE i.client_id = $1 AND i.status != 'draft'
        ORDER BY i.issue_date DESC, i.created_at DESC
      `;

      const result = await this.db.query(queryText, [client_id]);
      res.status(200).json(result.rows);
    } catch (err: any) {
      logger.error('Get billing history error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  /**
   * Retrieves an invoice by its unique invoice number.
   * Alternative to looking up by UUID, useful for user-friendly invoice references.
   * 
   * @async
   * @param {Request} req - Express request with params.invoice_number
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 with invoice or 404 if not found
   * 
   * @example
   * GET /api/invoices/by-number/INV-20240115-001
   * Response: 200 { id: "uuid", invoice_number: "INV-20240115-001", status: "sent", ... }
   * Response: 404 { message: "Invoice not found" }
   */
  // Get invoice by number (alternative to ID)
  async findByNumber(req: Request, res: Response) {
    // Params validation is done by Joi schema
    const { invoice_number } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    try {
      const queryText = `
        SELECT i.id, i.user_id, i.client_id, i.project_id,
               i.invoice_number, i.status, i.issue_date, i.due_date,
               i.sub_total, i.tax_rate, i.tax_amount, i.total_amount,
               i.currency, i.notes, i.created_at, i.updated_at,
               c.name as client_name,
               p.name as project_name
        FROM invoices i
        LEFT JOIN clients c ON i.client_id = c.id
        LEFT JOIN projects p ON i.project_id = p.id
        WHERE i.invoice_number = $1 AND i.user_id = $2
      `;

      const result = await this.db.query(queryText, [invoice_number, userId]);

      if (result.rows.length === 0) {
        res.status(404).json({ message: 'Invoice not found' });
        return;
      }

      res.status(200).json(result.rows[0]);
    } catch (err: any) {
      logger.error('Find invoice by number error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  // ── PDF rendering delegated to InvoicePdfController (extracted for size) ──

  async generatePDF(req: Request, res: Response) {
    return this.invoicePdf.generatePDF(req, res);
  }

  async generatePDFBuffer(invoiceId: string, userId: string, enableZugferd: boolean = false): Promise<Buffer | null> {
    return this.invoicePdf.generatePDFBuffer(invoiceId, userId, enableZugferd);
  }

  async generateStornoPDF(req: Request, res: Response) {
    return this.invoicePdf.generateStornoPDF(req, res);
  }

  async generateCorrectionPDF(req: Request, res: Response) {
    return this.invoicePdf.generateCorrectionPDF(req, res);
  }



  /**
   * Gets the billing validation status for an invoice.
   * Checks for overbilling, underbilling, and potential duplicate payments.
   * 
   * @async
   * @param {Request} req - Express request object with invoice ID in params
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 with validation result or error response
   * 
   * @example
   * GET /api/invoices/:id/billing-status?threshold=2.0
   * Response: 200 {
   *   invoice_id: "uuid",
   *   invoice_total: 600.00,
   *   total_paid: 1200.00,
   *   balance: -600.00,
   *   status: "overbilled",
   *   warnings: ["Invoice is overbilled by 600.00 USD..."],
   *   threshold: 2.0,
   *   currency: "USD"
   * }
   */
  async getBillingStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const threshold = req.query.threshold ? parseFloat(req.query.threshold as string) : undefined;

      const validationResult = await this.billingValidationService.validateInvoice(id, { threshold });

      res.status(200).json(validationResult);
    } catch (err: any) {
      logger.error('Get billing status error:', err);
      if (err.message.includes('not found')) {
        res.status(404).json({ message: err.message });
      } else {
        res.status(500).json({ message: err.message || 'Failed to validate invoice billing' });
      }
    }
  }

  /**
   * Validates a proposed payment before recording.
   * Checks if the payment would cause overbilling beyond threshold.
   * 
   * @async
   * @param {Request} req - Express request object with invoice ID and payment amount
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 with validation result
   * 
   * @example
   * POST /api/invoices/:id/validate-payment
   * Body: { amount: 500.00, strict: true }
   * Response: 200 {
   *   isValid: false,
   *   warnings: ["This payment would cause overbilling..."],
   *   projectedBalance: -100.00,
   *   projectedStatus: "overbilled"
   * }
   */
  async validateProposedPayment(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { amount, threshold, strict } = req.body;

      if (!amount || isNaN(parseFloat(amount))) {
        res.status(400).json({ message: 'Valid payment amount is required' });
        return;
      }

      const validationResult = await this.billingValidationService.validateProposedPayment(
        id,
        parseFloat(amount),
        { threshold, strict }
      );

      res.status(200).json(validationResult);
    } catch (err: any) {
      logger.error('Validate proposed payment error:', err);
      res.status(500).json({ message: err.message || 'Failed to validate proposed payment' });
    }
  }

  /**
   * Gets a list of available placeholders for invoice templates.
   * Returns placeholders with descriptions and examples based on user's language.
   * 
   * @async
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 with placeholders array
   * 
   * @example
   * GET /api/invoices/placeholders
   * Response: 200 [
   *   { placeholder: "{{date}}", description: "Current date", example: "30.10.2025" },
   *   { placeholder: "{{month-1}}", description: "Previous month name", example: "September" },
   *   ...
   * ]
   */
  async getPlaceholders(req: Request, res: Response) {
    try {
      // Get user's preferred language from request or default to 'en'
      const userLanguage = (req as any).user?.language || req.query.language || 'en';
      
      const placeholders = getAvailablePlaceholders(userLanguage as string);
      
      res.status(200).json(placeholders);
    } catch (err: any) {
      logger.error('Get placeholders error:', err);
      res.status(500).json({ message: err.message || 'Failed to get placeholders' });
    }
  }


}

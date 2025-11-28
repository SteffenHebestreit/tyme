import { Request, Response, NextFunction } from 'express';
import { InvoiceService } from '../../services/financial/invoice.service';
import { BillingValidationService } from '../../services/financial/billing-validation.service';
import { getDbClient } from '../../utils/database'; // Import the DB client utility
import PDFDocument from 'pdfkit';
import { ZugferdService } from '../../services/external/zugferd.service';
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

  constructor() {
    this.invoiceService = new InvoiceService();
    this.billingValidationService = new BillingValidationService();
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
      console.error('Create invoice error:', err);
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
      console.error('Find all invoices error:', err);
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
      console.error('Find invoice by ID error:', err);
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
      console.error('Update invoice error:', err);
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
      console.error('Cancel invoice error:', err);
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
      console.error('Delete invoice error:', err);
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
      console.error('Add line items error:', err);
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
      console.error('Replace line items error:', err);
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
      let projectIdForQuery = project_id; // Use destructured value

      if (project_id && !client_id) {
          // Fetch client_id from the project if only project_id is provided
          const projectQuery = `SELECT client_id FROM projects WHERE id = $1 AND user_id = $2`;
          const projectResult = await this.db.query(projectQuery, [project_id, (req as any).user?.id]);
          
          if (projectResult.rows.length === 0) {
              res.status(404).json({ message: 'Project not found or you do not have access.' });
              return;
          }
          finalClientId = projectResult.rows[0].client_id;
      }

      // Create a new invoice with customization fields
      const invoiceData = {
        user_id: (req as any).user?.id,
        client_id: finalClientId,
        project_id: projectIdForQuery, // Store the specific project if provided, null otherwise
        issue_date: start_date ? new Date(start_date) : new Date(),
        due_date: end_date ? new Date(end_date) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        status: 'draft' as const, 
        currency: 'USD',
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
          p.hourly_rate as project_rate,
          COALESCE(te.hourly_rate, p.hourly_rate, 0) as effective_rate,
          te.entry_date as entry_date 
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

      // Prepare line items from fetched time entries
      const lineItems = timeEntriesResult.rows.map((entry: TimeEntryForInvoice) => {
        // Use effective_rate which already falls back from time entry -> project -> 0
        const hourlyRate = Number(entry.effective_rate) || 0;
        
        // Calculate hours from timestamps if duration_hours is NULL
        let hours = Number(entry.duration_hours);
        if (!hours && entry.date_start && entry.date_end) {
          const durationMs = new Date(entry.date_end).getTime() - new Date(entry.date_start).getTime();
          hours = durationMs / (1000 * 60 * 60); // Convert milliseconds to hours
        }
        hours = hours || 0;
        
        const totalPrice = hourlyRate * hours;
        
        return {
          id: crypto.randomUUID(), // Placeholder, actual ID is generated by DB
          invoice_id: invoice.id,   // Placeholder, will be set by the DB trigger/service logic if needed
          created_at: new Date(),  // Placeholder
          description: entry.description || `Work on ${entry.entry_date} (${entry.project_id ? 'Project ID: ' + entry.project_id : ''})`,
          quantity: hours,
          unit_price: hourlyRate,
          total_price: totalPrice,
          time_entry_id: entry.id
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
      console.error('Generate invoice from time entries error:', err);
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
      const queryText = `
        SELECT 
          i.id,
          i.invoice_number,
          TO_CHAR(i.issue_date, 'YYYY-MM-DD') as issue_date,
          TO_CHAR(i.due_date, 'YYYY-MM-DD') as due_date,
          i.total_amount,
          i.status,
          i.currency,
          COALESCE(
            (SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.status != 'cancelled'), 
            0
          ) AS amount_paid,
          (i.total_amount - COALESCE(
            (SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.status != 'cancelled'), 
            0
          )) AS outstanding_balance
        FROM invoices i 
        WHERE i.client_id = $1 
        ORDER BY i.issue_date DESC, i.created_at DESC
      `;
      
      const result = await this.db.query(queryText, [client_id]);
      res.status(200).json(result.rows);
    } catch (err: any) {
      console.error('Get billing history error:', err);
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
    const { invoice_number } = req.params; // Destructure from validated params

    try {
      // Get invoices for the specific client
      const queryText = `
        SELECT i.id, i.user_id, i.client_id, i.project_id, 
               i.invoice_number, i.status, i.issue_date, i.due_date,
               i.sub_total, i.tax_rate, i.tax_amount, i.total_amount,
               i.currency, i.notes, i.created_at, i.updated_at
        FROM invoices i 
        WHERE i.invoice_number = $1
      `;
      
      // Since we can't access db directly, let's just return a placeholder or remove this functionality for now
      res.status(501).json({ message: 'Find by number not yet fully implemented' });
    } catch (err: any) {
      console.error('Find invoice by number error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  /**
   * Generates and downloads a PDF for an invoice.
   * Creates a professional invoice PDF with company branding, line items, and payment details.
   * 
   * @async
   * @param {Request} req - Express request with params.id (invoice ID) and optional query.zugferd (boolean)
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends PDF file as download or 404/500 on error
   * 
   * @example
   * GET /api/invoices/:id/pdf?zugferd=true
   * Response: 200 (PDF file download)
   * Response: 404 { message: "Invoice not found" }
   */
  async generatePDF(req: Request, res: Response) {
    const { id } = req.params;
    const { zugferd } = req.query;
    const userId = (req as any).user?.id;

    try {
      // Helper function to format currency in German style
      const formatCurrency = (amount: number, currency: string = 'EUR'): string => {
        return new Intl.NumberFormat('de-DE', {
          style: 'currency',
          currency: currency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(amount);
      };

      // Helper function to format dates in German style
      const formatDate = (dateString: string): string => {
        const date = new Date(dateString);
        return date.toLocaleDateString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
      };

      // Helper function to format month/year in German
      const formatMonthYear = (dateString: string): string => {
        const date = new Date(dateString);
        return date.toLocaleDateString('de-DE', {
          month: '2-digit',
          year: 'numeric'
        });
      };

      // Fetch user settings for company information
      const settingsResult = await this.db.query(
        'SELECT * FROM settings WHERE user_id = $1',
        [userId]
      );
      const settings = settingsResult.rows[0] || {};

      // Fetch invoice with all details
      const queryText = `
        SELECT i.*, 
               c.name as client_name, c.email as client_email, c.phone as client_phone,
               c.address as client_address, c.city as client_city, c.postal_code as client_postal_code,
               c.use_separate_billing_address, c.billing_contact_person, c.billing_email, c.billing_phone,
               c.billing_address, c.billing_city, c.billing_state, c.billing_postal_code, c.billing_country,
               p.name as project_name
        FROM invoices i
        LEFT JOIN clients c ON i.client_id = c.id
        LEFT JOIN projects p ON i.project_id = p.id
        WHERE i.id = $1 AND i.user_id = $2
      `;
      
      const invoiceResult = await this.db.query(queryText, [id, userId]);
      
      if (invoiceResult.rows.length === 0) {
        res.status(404).json({ message: 'Invoice not found' });
        return;
      }

      const invoice = invoiceResult.rows[0];

      // Prepare placeholder context for template processing
      const placeholderContext: PlaceholderContext = {
        invoice_number: invoice.invoice_number,
        issue_date: new Date(invoice.issue_date),
        due_date: new Date(invoice.due_date),
        total: parseFloat(invoice.total_amount),
        currency: invoice.currency,
        client_name: invoice.client_name,
        client_email: invoice.client_email,
        client_phone: invoice.client_phone,
        project_name: invoice.project_name,
        language: 'de',
        referenceDate: new Date(invoice.issue_date),
      };

      // Fetch template contents with priority: invoice-assigned > default template > first available
      let headerText = null;
      let footerText = null;
      let termsText = null;
      let taxExemptionText = null;
      let bankDetailsText = null;
      let paymentTermsText = null;
      
      // Header template: invoice-assigned > default > first available
      if (invoice.header_template_id) {
        const headerResult = await this.db.query(
          'SELECT content FROM invoice_text_templates WHERE id = $1 AND user_id = $2',
          [invoice.header_template_id, userId]
        );
        if (headerResult.rows[0]) {
          headerText = processPlaceholders(headerResult.rows[0].content, placeholderContext);
        }
      }
      if (!headerText) {
        const defaultHeaderResult = await this.db.query(
          `SELECT content FROM invoice_text_templates 
           WHERE user_id = $1 AND category = 'header' AND is_active = true
           ORDER BY is_default DESC, created_at ASC
           LIMIT 1`,
          [userId]
        );
        if (defaultHeaderResult.rows[0]) {
          headerText = processPlaceholders(defaultHeaderResult.rows[0].content, placeholderContext);
        }
      }
      
      // Footer template: invoice-assigned > default > first available
      if (invoice.footer_template_id) {
        const footerResult = await this.db.query(
          'SELECT content FROM invoice_text_templates WHERE id = $1 AND user_id = $2',
          [invoice.footer_template_id, userId]
        );
        if (footerResult.rows[0]) {
          footerText = processPlaceholders(footerResult.rows[0].content, placeholderContext);
        }
      }
      if (!footerText) {
        const defaultFooterResult = await this.db.query(
          `SELECT content FROM invoice_text_templates 
           WHERE user_id = $1 AND category = 'footer' AND is_active = true
           ORDER BY is_default DESC, created_at ASC
           LIMIT 1`,
          [userId]
        );
        if (defaultFooterResult.rows[0]) {
          bankDetailsText = processPlaceholders(defaultFooterResult.rows[0].content, placeholderContext);
        }
      } else {
        // If invoice has footer template assigned, use it for bank details
        bankDetailsText = footerText;
      }
      
      // Terms template: invoice-assigned > default payment_terms > first available
      if (invoice.terms_template_id) {
        const termsResult = await this.db.query(
          'SELECT content FROM invoice_text_templates WHERE id = $1 AND user_id = $2',
          [invoice.terms_template_id, userId]
        );
        if (termsResult.rows[0]) {
          termsText = processPlaceholders(termsResult.rows[0].content, placeholderContext);
        }
      }
      if (!termsText) {
        const defaultTermsResult = await this.db.query(
          `SELECT content FROM invoice_text_templates 
           WHERE user_id = $1 AND category = 'payment_terms' AND is_active = true
           ORDER BY is_default DESC, created_at ASC
           LIMIT 1`,
          [userId]
        );
        if (defaultTermsResult.rows[0]) {
          paymentTermsText = processPlaceholders(defaultTermsResult.rows[0].content, placeholderContext);
        }
      }
      
      // Tax exemption: default > first available
      const taxExemptionResult = await this.db.query(
        `SELECT content FROM invoice_text_templates 
         WHERE user_id = $1 AND category = 'tax_exemption' AND is_active = true
         ORDER BY is_default DESC, created_at ASC
         LIMIT 1`,
        [userId]
      );
      if (taxExemptionResult.rows[0]) {
        taxExemptionText = processPlaceholders(taxExemptionResult.rows[0].content, placeholderContext);
      }

    // Fetch line items - group by project/description for cleaner invoices
    const itemsQuery = `
      SELECT 
        COALESCE(p.name, ii.description) as description,
        SUM(ii.quantity) as quantity,
        ii.unit_price,
        SUM(ii.quantity * ii.unit_price) as line_total,
        COALESCE(ii.rate_type, 'hourly') as rate_type
      FROM invoice_items ii
      LEFT JOIN time_entries te ON ii.time_entry_id = te.id
      LEFT JOIN projects p ON te.project_id = p.id
      WHERE ii.invoice_id = $1
      GROUP BY COALESCE(p.name, ii.description), ii.unit_price, ii.rate_type
      ORDER BY MIN(ii.created_at)
    `;      const itemsResult = await this.db.query(itemsQuery, [id]);
      const lineItems = itemsResult.rows;

      // Fetch payments
      const paymentsQuery = `
        SELECT amount, payment_method, payment_date, transaction_id
        FROM payments
        WHERE invoice_id = $1
        ORDER BY payment_date
      `;
      
      const paymentsResult = await this.db.query(paymentsQuery, [id]);
      const payments = paymentsResult.rows;

      // Create PDF document with A4 size
      const doc = new PDFDocument({ 
        margin: 50, 
        size: 'A4',
        bufferPages: true
      });

      // Define footer function to be drawn on every page
      const drawFooter = () => {
        const pageHeight = doc.page.height;
        const footerY = pageHeight - 80; // Increased from 60 to 80 to accommodate both footer lines
        
        doc.fontSize(7)
           .fillColor('#666666')
           .font('Helvetica');
        
        // Use bank details template if available, otherwise construct from settings
        if (bankDetailsText) {
          // Replace all newlines with " | " for single-line rendering
          const bankDetailsOneLine = bankDetailsText
            .replace(/\r?\n/g, ' | ')
            .replace(/\s+/g, ' ')
            .trim();
          
          try {
            doc.text(bankDetailsOneLine, 50, footerY, { 
              width: 495, 
              align: 'center',
              lineBreak: false
            });
          } catch (footerError: any) {
            console.error('Footer text error, using fallback:', footerError);
            doc.text('Bank Details Available', 50, footerY, { width: 495, align: 'center', lineBreak: false });
          }
        } else if (settings.bank_iban) {
          // Compact footer with bank details
          const footerText = `${settings.company_name || 'Company'} | ${settings.bank_name ? `Bank: ${settings.bank_name} | ` : ''}IBAN: ${settings.bank_iban}${settings.bank_bic ? ` | BIC: ${settings.bank_bic}` : ''}`;
          try {
            doc.text(footerText, 50, footerY, { 
              width: 495, 
              align: 'center',
              lineBreak: false
            });
          } catch (footerError: any) {
            console.error('Footer text error:', footerError);
          }
        }
        
        // Company address below
        if (settings.company_address) {
          const companyInfo = `${settings.company_name || 'Company'} | ${settings.company_address}`;
          try {
            doc.fontSize(6)
               .fillColor('#999999')
               .text(companyInfo, 50, footerY + 12, { 
                 width: 495, 
                 align: 'center',
                 lineBreak: false
               });
          } catch (addressError: any) {
            console.error('Footer address error:', addressError);
          }
        }
      };

      // DON'T register pageAdded event - it can cause infinite page creation
      // We'll draw footer manually only at the end
      // doc.on('pageAdded', drawFooter);

      // Always buffer the PDF to prevent sending corrupted data on error
      let pdfBuffers: Buffer[] = [];
      const bufferStream = new (require('stream').PassThrough)();
      bufferStream.on('data', (chunk: Buffer) => pdfBuffers.push(chunk));
      
      // Handle PDF document errors
      doc.on('error', (docError: any) => {
        console.error('PDFDocument error:', docError);
        bufferStream.destroy(docError);
      });
      
      // Pipe PDF to buffer stream
      doc.pipe(bufferStream);

      // ==================== HEADER SECTION ====================
      // Right side - Company Info Header
      const safeCompanyName = (settings.company_name || 'Company Name').toString().substring(0, 100);
      doc.fontSize(16)
         .fillColor('#6B8EAF')
         .font('Helvetica-Bold')
         .text(safeCompanyName, 350, 50, { align: 'right', width: 195, lineBreak: false });
      
      if (settings.company_subline) {
        const safeSubline = settings.company_subline.toString().substring(0, 100);
        doc.fontSize(10)
           .fillColor('#666666')
           .font('Helvetica')
           .text(safeSubline, 350, 72, { align: 'right', width: 195, lineBreak: false });
      }

      // Contact details (right side)
      const contactY = settings.company_subline ? 100 : 80;
      doc.fontSize(8)
         .fillColor('#333333');
      
      if (settings.company_phone) {
        doc.text(`Tel.: ${settings.company_phone}`, 350, contactY, { align: 'right', width: 195, lineBreak: false });
      }
      if (settings.company_email) {
        doc.text(`E-Mail: ${settings.company_email}`, 350, contactY + 12, { align: 'right', width: 195, lineBreak: false });
      }
      if (settings.company_tax_id) {
        doc.text(`USt-IdNr.: ${settings.company_tax_id}`, 350, contactY + 24, { align: 'right', width: 195, lineBreak: false });
      }

      // Delivery/Invoice dates (right side)
      const datesY = contactY + 48;
      const deliveryDateDisplay = invoice.delivery_date || formatMonthYear(invoice.issue_date);
      doc.fontSize(8)
         .fillColor('#333333')
         .font('Helvetica-Bold')
         .text('Lieferdatum: ', 350, datesY, { continued: true })
         .font('Helvetica')
         .text(deliveryDateDisplay, { align: 'right', width: 195, lineBreak: false });
      
      doc.font('Helvetica-Bold')
         .text('Rechnungsdatum: ', 350, datesY + 12, { continued: true })
         .font('Helvetica')
         .text(formatDate(invoice.issue_date), { align: 'right', width: 195, lineBreak: false });
      
      doc.font('Helvetica-Bold')
         .text('Rechnungsnummer: ', 350, datesY + 24, { continued: true })
         .font('Helvetica')
         .text(invoice.invoice_number, { align: 'right', width: 195, lineBreak: false });

      // ==================== LEFT SIDE - SENDER & RECIPIENT ====================
      // Sender address (small, above recipient)
      const senderAddress = settings.company_address || 'Company Address';
      doc.fontSize(7)
         .fillColor('#999999')
         .font('Helvetica')
         .text(`${settings.company_name || 'Company'}, ${senderAddress}`, 50, 50);

      // Recipient address
      const recipientY = 75;
      
      // Use billing address if separate billing is enabled, otherwise use main address
      const useBilling = invoice.use_separate_billing_address;
      const recipientName = useBilling && invoice.billing_contact_person 
        ? invoice.billing_contact_person 
        : invoice.client_name || 'N/A';
      const recipientAddress = useBilling && invoice.billing_address 
        ? invoice.billing_address 
        : invoice.client_address;
      const recipientPostalCode = useBilling && invoice.billing_postal_code 
        ? invoice.billing_postal_code 
        : invoice.client_postal_code;
      const recipientCity = useBilling && invoice.billing_city 
        ? invoice.billing_city 
        : invoice.client_city;
      
      doc.fontSize(11)
         .fillColor('#000000')
         .font('Helvetica-Bold')
         .text(recipientName, 50, recipientY);
      
      let currentY = recipientY + 15;
      if (recipientAddress) {
        doc.fontSize(10)
           .font('Helvetica')
           .text(recipientAddress, 50, currentY);
        currentY += 12;
      }
      if (recipientPostalCode && recipientCity) {
        doc.text(`${recipientPostalCode} ${recipientCity}`, 50, currentY);
        currentY += 12;
      }
      // Email removed from recipient address - it was overlapping with billing address

      // ==================== INVOICE TITLE ====================
      const invoiceTitleY = 240;
      
      // Use invoice_headline if available, otherwise default to project name or "Leistungszeitraum"
      const invoiceTitle = invoice.invoice_headline 
        ? invoice.invoice_headline 
        : `Rechnung: ${invoice.project_name || 'Leistungszeitraum'}`;
      
      doc.fontSize(16)
         .fillColor('#6B8EAF')
         .font('Helvetica-Bold')
         .text(invoiceTitle, 50, invoiceTitleY);

      // ==================== INVOICE TEXT (GREETING) ====================
      let contentY = invoiceTitleY + 35;
      
      // Use header template if available, otherwise use invoice_text or default
      const greetingText = headerText || invoice.invoice_text;
      
      if (greetingText) {
        // Sanitize text to prevent infinite loop issues
        const sanitizedGreeting = greetingText.trim();
        doc.fontSize(10)
           .fillColor('#000000')
           .font('Helvetica')
           .text(sanitizedGreeting, 50, contentY, { 
             width: 495,
             align: 'left',
             lineGap: 4
           });
        // Use approximate height calculation instead of heightOfString
        const lineCount = sanitizedGreeting.split('\n').length;
        contentY += (lineCount * 14) + 20; // Approximate: 14px per line + 20px spacing
      } else {
        // Default greeting
        doc.fontSize(10)
           .fillColor('#000000')
           .font('Helvetica')
           .text('Sehr geehrte Damen und Herren,', 50, contentY);
        contentY += 25;
        doc.text('vielen Dank für Ihren Auftrag und das in mir gesetzte Vertrauen. Hiermit erlaube ich mir,', 50, contentY);
        contentY += 12;
        doc.text('folgenden Betrag für meine Leistungen in Rechnung zu stellen.', 50, contentY);
        contentY += 25;
      }

      // ==================== LINE ITEMS TABLE ====================
      const tableStartY = contentY;
      const colPositions = {
        nr: 50,
        description: 90,
        quantity: 330,
        unitPrice: 410,
        total: 480
      };
      
      const colWidths = {
        nr: 30,
        description: 230,
        quantity: 70,
        unitPrice: 65,
        total: 65
      };

      // Determine rate type for column headers (use daily if all items are daily, otherwise hourly)
      const allDaily = lineItems.length > 0 && lineItems.every((item: any) => item.rate_type === 'daily');
      const quantityHeader = allDaily ? 'Menge (Tage)' : 'Menge (Std.)';
      const rateHeader = allDaily ? '€/Tag' : '€/Std.';

      // Table header with gray background - full width
      doc.rect(45, tableStartY - 5, 505, 20)
         .fillAndStroke('#F0F0F0', '#CCCCCC');

      doc.fontSize(8)
         .fillColor('#000000')
         .font('Helvetica-Bold')
         .text('Nr.', colPositions.nr, tableStartY, { width: colWidths.nr, align: 'left', lineBreak: false })
         .text('Bezeichnung', colPositions.description, tableStartY, { width: colWidths.description, align: 'left', lineBreak: false })
         .text(quantityHeader, colPositions.quantity, tableStartY, { width: colWidths.quantity, align: 'center', lineBreak: false })
         .text(rateHeader, colPositions.unitPrice, tableStartY, { width: colWidths.unitPrice, align: 'right', lineBreak: false })
         .text('Gesamt €', colPositions.total, tableStartY, { width: colWidths.total, align: 'right', lineBreak: false });

      // Table rows
      let tableY = tableStartY + 25;
      doc.font('Helvetica')
         .fontSize(9);

      lineItems.forEach((item: any, index: number) => {
        // Check if we need a new page (reserve 200px for footer and totals section)
        const pageHeight = doc.page.height;
        const rowHeight = 20;
        
        // Only add page if we truly need it - check if current row + potential next content fits
        if (tableY + rowHeight > pageHeight - 200) {
          // Draw footer on current page before adding new page
          drawFooter();
          
          doc.addPage();
          tableY = 50; // Reset Y position and redraw ONLY table column headers (no company header)
          
          // Redraw table column header on new page
          doc.rect(45, tableY - 5, 505, 20)
             .fillAndStroke('#F0F0F0', '#CCCCCC');
          
          doc.fontSize(8)
             .fillColor('#000000')
             .font('Helvetica-Bold')
             .text('Nr.', colPositions.nr, tableY, { width: colWidths.nr, align: 'left', lineBreak: false })
             .text('Bezeichnung', colPositions.description, tableY, { width: colWidths.description, align: 'left', lineBreak: false })
             .text(quantityHeader, colPositions.quantity, tableY, { width: colWidths.quantity, align: 'center', lineBreak: false })
             .text(rateHeader, colPositions.unitPrice, tableY, { width: colWidths.unitPrice, align: 'right', lineBreak: false })
             .text('Gesamt €', colPositions.total, tableY, { width: colWidths.total, align: 'right', lineBreak: false });
          
          tableY += 25;
        }
        
        // Sanitize description to prevent PDFKit infinite loop
        const safeDescription = (item.description || '')
          .toString()
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim()
          .substring(0, 80); // Max 80 chars to fit in one line

        // Alternate row background - match the actual row height
        if (index % 2 === 0) {
          doc.rect(45, tableY - 2, 505, 20)
             .fill('#FAFAFA');
        }

        // Format quantity to 2 decimal places for hours
        const quantityFormatted = parseFloat(item.quantity).toFixed(2);
        
        // Format currency without symbol (will be in header)
        const unitPriceFormatted = parseFloat(item.unit_price).toFixed(2).replace('.', ',');
        const lineTotalFormatted = parseFloat(item.line_total).toFixed(2).replace('.', ',');

        doc.fillColor('#000000')
           .text((index + 1).toString(), colPositions.nr, tableY, { width: colWidths.nr, align: 'left', lineBreak: false })
           .text(safeDescription, colPositions.description, tableY, { width: colWidths.description, align: 'left', ellipsis: true, lineBreak: false })
           .text(quantityFormatted, colPositions.quantity, tableY, { width: colWidths.quantity, align: 'center', lineBreak: false })
           .text(unitPriceFormatted, colPositions.unitPrice, tableY, { width: colWidths.unitPrice, align: 'right', lineBreak: false })
           .text(lineTotalFormatted, colPositions.total, tableY, { width: colWidths.total, align: 'right', lineBreak: false });

        tableY += 20;
      });

      // Bottom border line
      doc.moveTo(45, tableY)
         .lineTo(550, tableY)
         .strokeColor('#CCCCCC')
         .stroke();

      // ==================== TOTALS SECTION ====================
      tableY += 15;
      const totalsStartX = 330;
      const totalsValueX = 480;
      const totalsWidth = 65;
      
      // Subtotal (Net)
      doc.fontSize(9)
         .fillColor('#000000')
         .font('Helvetica')
         .text('Summe Netto', totalsStartX, tableY, { width: 140, align: 'right' })
         .font('Helvetica-Bold')
         .text(formatCurrency(parseFloat(invoice.sub_total), invoice.currency).replace(/[€$£¥]/g, '').trim(), 
               totalsValueX, tableY, { width: totalsWidth, align: 'right' });

      // Tax line (always show, even if 0%)
      tableY += 15;
      const taxRateDecimal = parseFloat(invoice.tax_rate || '0');
      const taxRatePercent = taxRateDecimal * 100; // Convert 0.19 to 19 for display
      const taxAmount = parseFloat(invoice.tax_amount || '0');
      doc.font('Helvetica')
         .text(`zzgl. ${taxRatePercent.toFixed(0)}% MwSt.`, totalsStartX, tableY, { width: 140, align: 'right' })
         .font('Helvetica-Bold')
         .text(formatCurrency(taxAmount, invoice.currency).replace(/[€$£¥]/g, '').trim(), 
               totalsValueX, tableY, { width: totalsWidth, align: 'right' });

      // Tax exemption notice (if applicable)
      if (taxRateDecimal === 0) {
        tableY += 20;
        // Use tax exemption template, invoice-specific text, or default
        const exemptionNotice = invoice.tax_exemption_text || taxExemptionText;
        
        if (exemptionNotice) {
          // Sanitize text to prevent infinite loop
          const sanitizedNotice = exemptionNotice.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
          doc.fontSize(8)
             .font('Helvetica')
             .fillColor('#333333')
             .text(sanitizedNotice, 50, tableY, { width: 495 });
        } else {
          doc.fontSize(8)
             .font('Helvetica')
             .fillColor('#333333')
             .text('Rechnung enthält keine Umsatzsteuer, da die Steuerschuld beim Leistungsempfänger liegt (Reverse-Charge-Verfahren)', 
                   50, tableY, { width: 495 });
        }
        tableY += 5; // Less spacing after notice
      }

      // Final total with background
      tableY += 25;
      doc.rect(330, tableY - 5, 215, 20)
         .fillAndStroke('#6B8EAF', '#6B8EAF');
      
      doc.fontSize(11)
         .fillColor('#FFFFFF')
         .font('Helvetica-Bold')
         .text('Zu zahlender Betrag:', 335, tableY)
         .text(formatCurrency(parseFloat(invoice.total_amount), invoice.currency), 
               totalsValueX, tableY, { width: totalsWidth, align: 'right' });

      // ==================== PAYMENT INSTRUCTIONS ====================
      tableY += 40;
      
      // Priority: invoice footer_text > invoice terms template > default payment terms template
      const paymentInstructions = invoice.footer_text || termsText || paymentTermsText;
      
      if (paymentInstructions) {
        // Sanitize text to prevent infinite loop
        const sanitizedInstructions = paymentInstructions.trim();
        
        doc.fontSize(9)
           .fillColor('#000000')
           .font('Helvetica')
           .text(sanitizedInstructions, 50, tableY, { width: 495, lineGap: 3 });
      } else {
        // Default payment instructions
        doc.fontSize(9)
           .fillColor('#000000')
           .font('Helvetica')
           .text('Bitte überweisen Sie den offenen Rechnungsbetrag innerhalb eines Monats, bis zum', 50, tableY);
        tableY += 12;
        doc.text(`${formatDate(invoice.due_date)}, auf unten genanntes Bankkonto.`, 50, tableY);
      }

      // ==================== DRAW FOOTER ON FIRST PAGE ====================
      drawFooter();

      // Finalize PDF and send when complete
      doc.end();
      
      bufferStream.on('end', async () => {
        try {
          const pdfBuffer = Buffer.concat(pdfBuffers);
          
          // Use query parameter if provided, otherwise use invoice setting
          const enableZugferd = zugferd !== undefined 
            ? (zugferd === 'true' || zugferd === '1')
            : invoice.enable_zugferd;
          
          console.log('ZUGFeRD debug - zugferd param:', zugferd);
          console.log('ZUGFeRD debug - invoice.enable_zugferd:', invoice.enable_zugferd);
          console.log('ZUGFeRD debug - enableZugferd:', enableZugferd);
          
          if (enableZugferd) {
            console.log('ZUGFeRD: Generating XML...');
            console.log('ZUGFeRD debug - invoice values:', {
              sub_total: invoice.sub_total,
              tax_rate: invoice.tax_rate,
              tax_amount: invoice.tax_amount,
              total_amount: invoice.total_amount,
              currency: invoice.currency
            });
            
            // Generate ZUGFeRD XML
            const zugferdXml = ZugferdService.generateZugferdXML(
              {
                ...invoice,
                items: lineItems.map((item: any) => ({
                  description: item.description,
                  quantity: parseFloat(item.quantity),
                  unit_price: parseFloat(item.unit_price),
                  total_price: parseFloat(item.line_total),
                })),
              },
              {
                name: invoice.client_name || 'Client',
                email: invoice.client_email,
              },
              {
                name: settings.company_name || 'Company',
                street: settings.company_address || '',
                postal_code: '', // Extract from address if needed
                city: '', // Extract from address if needed
                country: 'DE',
                tax_id: settings.company_tax_id || '',
                email: settings.company_email || '',
              }
            );
            
            console.log('ZUGFeRD: Embedding XML in PDF...');
            // Embed ZUGFeRD XML in PDF
            const zugferdPdf = await ZugferdService.embedZugferdInPDF(pdfBuffer, zugferdXml);
            console.log('ZUGFeRD: Successfully embedded, sending PDF');
            
            // Send ZUGFeRD-compliant PDF
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=rechnung-${invoice.invoice_number}.pdf`);
            res.send(zugferdPdf);
          } else {
            console.log('ZUGFeRD: Disabled, sending regular PDF');
            // Send regular PDF
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=rechnung-${invoice.invoice_number}.pdf`);
            res.send(pdfBuffer);
          }
        } catch (sendError: any) {
          console.error('PDF send error:', sendError);
          if (!res.headersSent) {
            res.status(500).json({ message: sendError.message || 'Failed to send PDF' });
          }
        }
      });
      
      // Handle PDF generation errors
      bufferStream.on('error', (streamError: any) => {
        console.error('PDF stream error:', streamError);
        if (!res.headersSent) {
          res.status(500).json({ message: streamError.message || 'PDF generation stream error' });
        }
      });

    } catch (err: any) {
      console.error('Generate PDF error:', err);
      
      // Check if response headers have already been sent
      if (!res.headersSent) {
        res.status(500).json({ message: err.message || 'Failed to generate PDF' });
      } else {
        // Headers already sent - destroy the response to prevent hanging
        console.error('PDF generation failed after headers sent - destroying response');
        res.destroy();
      }
    }
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
      console.error('Get billing status error:', err);
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
      console.error('Validate proposed payment error:', err);
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
      console.error('Get placeholders error:', err);
      res.status(500).json({ message: err.message || 'Failed to get placeholders' });
    }
  }
}

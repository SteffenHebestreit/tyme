/**
 * Invoice Validation Schemas
 * Provides Joi validation schemas for invoice-related operations.
 * Validates request data for invoice creation, updates, line items, and generation from time entries.
 * Enforces data integrity, UUID formats, date constraints, and business rules.
 */

import * as Joi from 'joi';

/**
 * Schema for validating invoice ID (UUID v4).
 * Used in route parameters for identifying specific invoices.
 * 
 * @constant
 * @example
 * // Validate invoice ID from params
 * const { error } = invoiceIdSchema.validate(req.params.id);
 */
// Base schema shared by multiple operations
export const invoiceIdSchema = Joi.string().guid({ version: ['uuidv4'] }).required();

/**
 * Schema for creating a new invoice.
 * Validates invoice creation data with business rules:
 * - client_id is required
 * - project_id is optional (can be null)
 * - due_date must be greater than issue_date
 * - status defaults to 'draft'
 * - currency defaults to 'USD' (ISO 4217 format)
 * - user_id is optional (set by auth middleware)
 * 
 * @constant
 * @example
 * // Validate create invoice request
 * const { error, value } = createInvoiceSchema.validate(req.body);
 */
// Schema for creating an invoice (req.body)
export const createInvoiceSchema = Joi.object({
  user_id: Joi.string().guid({ version: ['uuidv4'] }).optional(), // Will be set by middleware
  client_id: Joi.string().guid({ version: ['uuidv4'] }).required(),
  project_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
  invoice_number: Joi.string().max(50).optional(),
  issue_date: Joi.date().iso().optional(),
  due_date: Joi.date().iso().greater(Joi.ref('issue_date')).when('issue_date', {
    is: Joi.exist(),
    then: Joi.required(), // If issue_date is present, due_date must also be present and greater
    otherwise: Joi.optional()
  }).optional(),
  status: Joi.string().valid('draft', 'sent', 'paid', 'overdue', 'cancelled').default('draft'),
  sub_total: Joi.number().precision(2).min(0).optional(), // Net amount before tax
  currency: Joi.string().length(3).uppercase().default('USD'), // ISO 4217 currency codes
  notes: Joi.string().max(500).allow('').optional(),
  tax_rate_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
  invoice_headline: Joi.string().max(255).allow('', null).optional(),
  header_template_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
  footer_template_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
  terms_template_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
  invoice_text: Joi.string().max(2000).allow('').optional(),
  footer_text: Joi.string().max(1000).allow('').optional(),
  tax_exemption_text: Joi.string().max(500).allow('').optional(),
  enable_zugferd: Joi.boolean().default(false).optional(),
  exclude_from_tax: Joi.boolean().default(false).optional(),
});

/**
 * Schema for updating an existing invoice.
 * Validates partial invoice updates with business rules:
 * - status is required in updates
 * - due_date must be greater than issue_date if both provided
 * - client_id typically shouldn't change but schema allows it
 * 
 * @constant
 * @example
 * // Validate update invoice request
 * const { error, value } = updateInvoiceSchema.validate(req.body);
 */
// Schema for updating an invoice (req.body)
export const updateInvoiceSchema = Joi.object({
  client_id: Joi.string().guid({ version: ['uuidv4'] }).required(), // Typically shouldn't change, but schema allows
  project_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
  invoice_number: Joi.string().max(50).optional(),
  issue_date: Joi.date().iso().optional(),
  due_date: Joi.date().iso().greater(Joi.ref('issue_date', { adjust: (value) => value ? new Date(value) : null })).when('issue_date', {
    is: Joi.exist(),
    then: Joi.required(),
    otherwise: Joi.optional()
  }).optional(),
  status: Joi.string().valid('draft', 'sent', 'paid', 'overdue', 'cancelled').required(), // Status must be provided
  sub_total: Joi.number().precision(2).min(0).optional(), // Net amount before tax
  currency: Joi.string().length(3).uppercase().default('USD'),
  notes: Joi.string().max(500).allow('').optional(),
  tax_rate_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
  invoice_headline: Joi.string().max(255).allow('', null).optional(),
  header_template_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
  footer_template_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
  terms_template_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
  invoice_text: Joi.string().max(2000).allow('').optional(),
  footer_text: Joi.string().max(1000).allow('').optional(),
  tax_exemption_text: Joi.string().max(500).allow('').optional(),
  enable_zugferd: Joi.boolean().optional(),
  exclude_from_tax: Joi.boolean().optional(),
});

/**
 * Schema for adding line items to an invoice.
 * Validates line item data with business rules:
 * - At least one item required
 * - quantity must be positive number (supports decimal for hours/days)
 * - unit_price and total_price have 2 decimal precision
 * - time_entry_id optional for linking to time tracking
 * 
 * @constant
 * @example
 * // Validate add line items request
 * const { error, value } = addLineItemsSchema.validate(req.body);
 */
// Schema for adding line items to an invoice (req.body)
export const addLineItemsSchema = Joi.object({
  items: Joi.array().items(
    Joi.object({
      id: Joi.string().guid({ version: ['uuidv4'] }).optional(), // Optional as DB might generate
      description: Joi.string().max(255).required(),
      quantity: Joi.number().positive().required(), // Supports decimal hours/days
      unit_price: Joi.number().precision(2).min(0).required(), // e.g., 100.50
      total_price: Joi.number().precision(2).min(0).optional(), // Can be calculated by service or provided
      time_entry_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
      rate_type: Joi.string().valid('hourly', 'daily').default('hourly').optional(), // Rate type for display in PDF
    })
  ).min(1).required() // At least one item must be provided
});

/**
 * Schema for generating invoice from time entries.
 * Validates generation parameters with business rules:
 * - Requires at least one of project_id or client_id
 * - end_date must be greater than start_date
 * - Custom validation ensures non-null values
 * 
 * @constant
 * @example
 * // Validate generate from time entries request
 * const { error, value } = generateFromTimeEntriesSchema.validate(req.body);
 */
// Schema for generating invoice from time entries (req.body)
export const generateFromTimeEntriesSchema = Joi.object({
  project_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
  client_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(), // Required if project_id is not provided
  start_date: Joi.date().iso().optional(),
  end_date: Joi.date().iso().greater(Joi.ref('start_date')).when('start_date', {
    is: Joi.exist(),
    then: Joi.required(),
    otherwise: Joi.optional()
  }).optional(),
  // New customization fields
  invoice_headline: Joi.string().max(255).allow('', null).optional(),
  header_template_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
  footer_template_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
  terms_template_id: Joi.string().guid({ version: ['uuidv4'] }).allow(null).optional(),
})
.or('project_id', 'client_id') // Require at least one of these fields to be present
.custom((obj, helpers) => {
  // Custom validation: ensure at least one of project_id or client_id has a non-null value
  if ((!obj.project_id && !obj.client_id) || (obj.project_id === null && obj.client_id === null)) {
    return helpers.error('object.missing', { missing: ['project_id or client_id'] });
  }
  return obj;
});

/**
 * Schema for billing history route parameters.
 * Validates client_id UUID for retrieving billing history.
 * 
 * @constant
 * @example
 * // Validate billing history params
 * const { error } = billingHistoryParamsSchema.validate(req.params);
 */
// Schema for getting billing history (req.params)
export const billingHistoryParamsSchema = Joi.object({
  client_id: invoiceIdSchema.required(),
});

/**
 * Schema for finding invoice by number.
 * Validates invoice_number format (alphanumeric, 10 characters).
 * Pattern should match auto-generated invoice numbers (e.g., INV-20240115-001).
 * 
 * @constant
 * @example
 * // Validate find by number params
 * const { error } = findInvoiceByNumberParamsSchema.validate(req.params);
 */
// Schema for finding invoice by number (req.params)
export const findInvoiceByNumberParamsSchema = Joi.object({
  invoice_number: Joi.string().pattern(/^[A-Z0-9]+$/).length(10).required(), // Example pattern, adjust as needed
});


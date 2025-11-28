// Invoice-related models

/**
 * Valid status values for an invoice.
 * Tracks the invoice lifecycle from draft to payment.
 * 
 * @typedef {'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled'} InvoiceStatus
 */
export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';

/**
 * Data transfer object for creating a new invoice.
 * Financial totals (sub_total, tax, total) are calculated automatically from invoice items.
 * Invoice number is auto-generated if not provided.
 * 
 * @interface CreateInvoiceDto
 * @property {string} user_id - The UUID of the user who owns this invoice (required, multi-tenant)
 * @property {string} client_id - The UUID of the client being invoiced (required, foreign key)
 * @property {string} [project_id] - The UUID of the associated project (optional, foreign key)
 * @property {string} [invoice_number] - Custom invoice number (optional, auto-generated if omitted)
 * @property {InvoiceStatus} [status] - Invoice status (defaults to 'draft')
 * @property {Date} issue_date - Date the invoice was issued (required)
 * @property {Date} due_date - Payment due date (required)
 * @property {string} [tax_rate_id] - Reference to predefined tax rate template (optional)
 * @property {string} [invoice_text] - Main invoice text/payment terms (optional)
 * @property {string} [footer_text] - Footer text (bank details, company info) (optional)
 * @property {string} [tax_exemption_text] - Tax exemption explanation text (optional)
 * @property {string} [notes] - Additional notes or payment terms (optional)
 * @property {string} [currency] - Currency code (defaults to 'USD')
 * 
 * @example
 * const newInvoice: CreateInvoiceDto = {
 *   user_id: 'user-uuid',
 *   client_id: 'client-uuid',
 *   project_id: 'project-uuid',
 *   status: 'draft',
 *   issue_date: new Date('2024-01-15'),
 *   due_date: new Date('2024-02-15'),
 *   tax_rate_id: 'tax-rate-uuid',
 *   currency: 'EUR',
 *   notes: 'Payment due within 30 days'
 * };
 */
export interface CreateInvoiceDto {
  user_id: string; // Multi-tenant: the authenticated user who owns this invoice
  client_id: string;
  project_id?: string | null;
  invoice_number?: string;
  status?: InvoiceStatus;
  issue_date: Date;
  due_date: Date;
  sub_total?: number; // Net amount before tax
  tax_rate_id?: string | null;
  invoice_headline?: string | null;
  header_template_id?: string | null;
  footer_template_id?: string | null;
  terms_template_id?: string | null;
  invoice_text?: string | null;
  footer_text?: string | null;
  tax_exemption_text?: string | null;
  notes?: string | null;
  currency?: string;
  enable_zugferd?: boolean;
  exclude_from_tax?: boolean;
}

/**
 * Data transfer object for updating an existing invoice.
 * All fields are optional to support partial updates.
 * 
 * @interface UpdateInvoiceDto
 * @extends {Partial<CreateInvoiceDto>}
 * 
 * @example
 * const updateData: UpdateInvoiceDto = {
 *   status: 'sent',
 *   notes: 'Invoice sent to client via email'
 * };
 */
export interface UpdateInvoiceDto extends Partial<CreateInvoiceDto> {}

/**
 * Base invoice structure representing an invoice entity from the database.
 * Contains all fields returned by the database including financial calculations.
 * 
 * @interface BaseInvoice
 * @property {string} id - The unique identifier (UUID) for the invoice
 * @property {string} user_id - The UUID of the user who owns this invoice
 * @property {string} client_id - The UUID of the client being invoiced
 * @property {string | null} project_id - The UUID of the associated project (if any)
 * @property {string} invoice_number - Unique invoice number (e.g., 'INV-20240115-001')
 * @property {InvoiceStatus} status - Current invoice status
 * @property {Date} issue_date - Date the invoice was issued
 * @property {Date} due_date - Payment due date
 * @property {number} sub_total - Subtotal before tax (calculated from items)
 * @property {number} tax_rate - Tax rate as decimal (e.g., 0.10 for 10%)
 * @property {number} tax_amount - Tax amount in currency (calculated: sub_total * tax_rate)
 * @property {number} total_amount - Total amount including tax (sub_total + tax_amount)
 * @property {string} currency - Currency code (e.g., 'USD', 'EUR')
 * @property {string | null} tax_rate_id - Reference to predefined tax rate template
 * @property {string | null} invoice_text - Main invoice text/payment terms
 * @property {string | null} footer_text - Footer text (bank details, company info)
 * @property {string | null} tax_exemption_text - Tax exemption explanation text
 * @property {string | null} notes - Additional notes or payment terms
 * @property {Date} created_at - Timestamp when the invoice was created
 * @property {Date} updated_at - Timestamp when the invoice was last updated
 * @property {boolean} enable_zugferd - Whether to generate ZUGFeRD (e-invoice) XML attachment
 * @property {string | null} delivery_date - Service delivery period in MM/YYYY format (e.g., "10/2025")
 * @property {boolean} exclude_from_tax - Whether to exclude this invoice from tax declarations and reports
 */
export interface BaseInvoice {
  id: string;
  user_id: string;
  client_id: string;
  project_id: string | null;
  invoice_number: string;
  status: InvoiceStatus;
  issue_date: Date;
  due_date: Date;
  sub_total: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  tax_rate_id: string | null;
  invoice_headline: string | null;
  header_template_id: string | null;
  footer_template_id: string | null;
  terms_template_id: string | null;
  invoice_text: string | null;
  footer_text: string | null;
  tax_exemption_text: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  enable_zugferd: boolean;
  delivery_date: string | null;
  exclude_from_tax: boolean;
}

/**
 * Full invoice structure returned by API endpoints.
 * Extends BaseInvoice with associated client name and project name.
 * 
 * @interface Invoice
 * @extends {BaseInvoice}
 * @property {string} [client_name] - Name of the client (populated from relationship)
 * @property {string} [project_name] - Name of the project (populated from relationship)
 * 
 * @example
 * const invoice: Invoice = {
 *   id: 'invoice-uuid',
 *   invoice_number: 'INV-20240115-001',
 *   status: 'sent',
 *   total_amount: 1500.00,
 *   client_name: 'Acme Corporation',
 *   project_name: 'Website Redesign',
 *   // ... other fields
 * };
 */
export interface Invoice extends BaseInvoice {
  client_name?: string; // Will be populated from client relationship
  project_name?: string; // Will be populated from project relationship
}

/**
 * Extended invoice structure with line items.
 * Used when fetching invoices with full details including all invoice items.
 * 
 * @interface InvoiceWithItems
 * @extends {Invoice}
 * @property {InvoiceItem[]} [items] - Array of invoice line items
 * 
 * @example
 * const invoice: InvoiceWithItems = {
 *   id: 'invoice-uuid',
 *   invoice_number: 'INV-20240115-001',
 *   total_amount: 1500.00,
 *   items: [
 *     { description: 'Web Development', quantity: 10, unit_price: 150, total_price: 1500 }
 *   ],
 *   // ... other fields
 * };
 */
export interface InvoiceWithItems extends Invoice {
  items?: InvoiceItem[];
}

/**
 * Invoice line item representing a single billable item on an invoice.
 * Can be linked to a time entry or created manually.
 * 
 * @interface InvoiceItem
 * @property {string} id - The unique identifier (UUID) for the invoice item
 * @property {string} invoice_id - The UUID of the parent invoice (foreign key)
 * @property {string} [time_entry_id] - The UUID of the associated time entry (optional, foreign key)
 * @property {string} description - Description of the billable item
 * @property {number} quantity - Quantity of units (e.g., hours, items)
 * @property {number} unit_price - Price per unit
 * @property {number} total_price - Total price (quantity * unit_price)
 * @property {Date} created_at - Timestamp when the item was created
 * 
 * @example
 * const item: InvoiceItem = {
 *   id: 'item-uuid',
 *   invoice_id: 'invoice-uuid',
 *   time_entry_id: 'entry-uuid',
 *   description: 'Web Development - Homepage Redesign',
 *   quantity: 8.5,
 *   unit_price: 150,
 *   total_price: 1275.00,
 *   created_at: new Date()
 * };
 */
export interface InvoiceItem {
  id: string;
  invoice_id: string;
  time_entry_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  rate_type?: 'hourly' | 'daily';
  created_at: Date;
}

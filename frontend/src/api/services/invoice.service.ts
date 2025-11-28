/**
 * Invoice Service
 * Handles all HTTP requests related to invoice management.
 * Provides functions for CRUD operations, line item management, 
 * invoice generation from time entries, and billing history.
 */

import apiClient from './client';
import {
  BillingHistoryEntry,
  GenerateInvoiceFromTimeEntriesPayload,
  Invoice,
  InvoiceLineItemPayload,
  InvoicePayload,
  InvoiceResponse,
  InvoiceWithItems,
} from '../types';

/**
 * Fetches all invoices for the authenticated user.
 * Returns invoices ordered by creation date (newest first).
 * 
 * @async
 * @returns {Promise<Invoice[]>} Array of invoices
 * @throws {Error} If the API request fails
 * 
 * @example
 * const invoices = await fetchInvoices();
 * invoices.forEach(inv => console.log(inv.invoice_number, inv.status));
 */
export async function fetchInvoices(): Promise<Invoice[]> {
  const { data } = await apiClient.get<Invoice[]>('/invoices');
  return data;
}

/**
 * Fetches a single invoice by ID with all line items.
 * 
 * @async
 * @param {string} id - UUID of the invoice
 * @returns {Promise<InvoiceWithItems>} Invoice with line items array
 * @throws {Error} If invoice not found or request fails
 * 
 * @example
 * const invoice = await fetchInvoice('123e4567-e89b-12d3-a456-426614174000');
 * console.log(invoice.invoice_number, invoice.items.length);
 */
export async function fetchInvoice(id: string): Promise<InvoiceWithItems> {
  const { data } = await apiClient.get<InvoiceWithItems>(`/invoices/${id}`);
  return data;
}

/**
 * Creates a new invoice.
 * Invoice number is auto-generated if not provided (format: INV-YYYYMMDD-###).
 * Status defaults to 'draft'.
 * 
 * @async
 * @param {InvoicePayload} payload - Invoice data (client_id, project_id, dates, etc.)
 * @returns {Promise<Invoice>} The newly created invoice
 * @throws {Error} If validation fails or client/project doesn't exist
 * 
 * @example
 * const newInvoice = await createInvoice({
 *   client_id: 'uuid',
 *   project_id: 'uuid',
 *   issue_date: new Date(),
 *   due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
 *   status: 'draft',
 *   currency: 'USD'
 * });
 */
export async function createInvoice(payload: InvoicePayload): Promise<Invoice> {
  const { data } = await apiClient.post<{ message: string; invoice: Invoice }>(
    '/invoices',
    payload
  );
  return data.invoice;
}

/**
 * Updates an existing invoice with partial data.
 * Only provided fields will be updated.
 * 
 * @async
 * @param {string} id - UUID of the invoice to update
 * @param {Partial<InvoicePayload>} payload - Partial invoice data to update
 * @returns {Promise<Invoice>} The updated invoice
 * @throws {Error} If invoice not found or validation fails
 * 
 * @example
 * const updated = await updateInvoice('uuid', { 
 *   status: 'sent',
 *   notes: 'Invoice sent to client' 
 * });
 */
export async function updateInvoice(id: string, payload: Partial<InvoicePayload>): Promise<Invoice> {
  const { data } = await apiClient.put<{ message: string; invoice: Invoice }>(
    `/invoices/${id}`,
    payload
  );
  return data.invoice;
}

/**
 * Cancels an invoice by setting its status to 'cancelled'.
 * Cannot cancel invoices that are already cancelled.
 * 
 * @async
 * @param {string} id - UUID of the invoice to cancel
 * @returns {Promise<Invoice>} The cancelled invoice
 * @throws {Error} If invoice not found, already cancelled, or request fails
 * 
 * @example
 * const cancelled = await cancelInvoice('123e4567-e89b-12d3-a456-426614174000');
 * console.log('Invoice cancelled:', cancelled.status); // 'cancelled'
 */
export async function cancelInvoice(id: string): Promise<Invoice> {
  const { data } = await apiClient.patch<{ message: string; invoice: Invoice }>(
    `/invoices/${id}/cancel`
  );
  return data.invoice;
}

/**
 * Deletes an invoice.
 * May fail if invoice has line items (foreign key constraint).
 * This action cannot be undone.
 * 
 * @async
 * @param {string} id - UUID of the invoice to delete
 * @returns {Promise<void>}
 * @throws {Error} If invoice not found, has line items, or deletion fails
 * 
 * @example
 * await deleteInvoice('123e4567-e89b-12d3-a456-426614174000');
 * console.log('Invoice deleted successfully');
 */
export async function deleteInvoice(id: string): Promise<void> {
  await apiClient.delete(`/invoices/${id}`);
}

/**
 * Adds line items to an existing invoice.
 * Each line item can optionally reference a time entry for tracking billable hours.
 * Automatically recalculates invoice totals after adding items.
 * 
 * @async
 * @param {string} id - UUID of the invoice
 * @param {InvoiceLineItemPayload[]} items - Array of line items to add
 * @returns {Promise<InvoiceWithItems>} Updated invoice with all line items
 * @throws {Error} If invoice not found or validation fails
 * 
 * @example
 * const updatedInvoice = await addInvoiceLineItems('invoice-uuid', [
 *   {
 *     description: 'Development work',
 *     quantity: 10,
 *     unit_price: 100,
 *     time_entry_id: 'time-entry-uuid'
 *   },
 *   {
 *     description: 'Consulting',
 *     quantity: 5,
 *     unit_price: 150
 *   }
 * ]);
 * console.log('Total:', updatedInvoice.total_amount);
 */
export async function addInvoiceLineItems(
  id: string,
  items: InvoiceLineItemPayload[]
): Promise<InvoiceWithItems> {
  const { data } = await apiClient.post<InvoiceResponse>(`/invoices/${id}/items`, { items });
  return data.invoice;
}

/**
 * Replaces all line items for an invoice (deletes existing, adds new).
 * Used when editing an invoice and updating its line items.
 * 
 * @async
 * @param {string} id - UUID of the invoice
 * @param {InvoiceLineItemPayload[]} items - Array of new line items to replace existing ones
 * @returns {Promise<InvoiceWithItems>} Updated invoice with new line items
 * @throws {Error} If invoice not found or operation fails
 * 
 * @example
 * const updatedInvoice = await replaceInvoiceLineItems('invoice-uuid', [
 *   { description: 'Development', quantity: 10, unit_price: 100, total_price: 1000 }
 * ]);
 */
export async function replaceInvoiceLineItems(
  id: string,
  items: InvoiceLineItemPayload[]
): Promise<InvoiceWithItems> {
  const { data } = await apiClient.put<InvoiceResponse>(`/invoices/${id}/items`, { items });
  return data.invoice;
}

/**
 * Generates a new invoice from billable time entries within a date range.
 * Automatically creates invoice, fetches matching time entries, and adds them as line items.
 * If only project_id is provided, derives client_id from the project.
 * 
 * @async
 * @param {GenerateInvoiceFromTimeEntriesPayload} payload - Generation parameters (project_id, client_id, date range)
 * @returns {Promise<InvoiceWithItems>} Generated invoice with time entry line items
 * @throws {Error} If no time entries found or generation fails
 * 
 * @example
 * const generatedInvoice = await generateInvoiceFromTimeEntries({
 *   project_id: 'uuid',
 *   start_date: '2024-01-01',
 *   end_date: '2024-01-31'
 * });
 * console.log('Generated invoice:', generatedInvoice.invoice_number);
 * console.log('Total hours billed:', generatedInvoice.items.length);
 */
export async function generateInvoiceFromTimeEntries(
  payload: GenerateInvoiceFromTimeEntriesPayload
): Promise<InvoiceWithItems> {
  const { data } = await apiClient.post<InvoiceResponse>(
    '/invoices/generate-from-time-entries',
    payload
  );
  return data.invoice;
}

/**
 * Retrieves billing history for a specific client.
 * Returns all invoices for the client with payment information:
 * - Invoice details (number, dates, status, total)
 * - Amount paid (sum of non-cancelled payments)
 * - Outstanding balance (total - amount paid)
 * 
 * @async
 * @param {string} clientId - UUID of the client
 * @returns {Promise<BillingHistoryEntry[]>} Array of billing history entries
 * @throws {Error} If client not found or request fails
 * 
 * @example
 * const history = await fetchBillingHistory('client-uuid');
 * history.forEach(entry => {
 *   console.log(
 *     entry.invoice_number, 
 *     'Total:', entry.total_amount, 
 *     'Paid:', entry.amount_paid, 
 *     'Outstanding:', entry.outstanding_balance
 *   );
 * });
 */
export async function fetchBillingHistory(clientId: string): Promise<BillingHistoryEntry[]> {
  const { data } = await apiClient.get<BillingHistoryEntry[]>(
    `/invoices/client/${clientId}/history`
  );
  return data;
}

/**
 * Fetches the billing validation status for an invoice.
 * Checks for overbilling, underbilling, and duplicate payments.
 * 
 * @async
 * @param {string} id - UUID of the invoice
 * @param {number} [threshold] - Optional threshold for validation (default: 1.50)
 * @returns {Promise<import('../types').BillingValidationResult>} Validation result with status and warnings
 * @throws {Error} If the API request fails
 * 
 * @example
 * const validation = await fetchInvoiceBillingStatus('invoice-uuid');
 * if (validation.status === 'overbilled') {
 *   console.warn('Invoice overbilled by', Math.abs(validation.balance));
 * }
 */
export async function fetchInvoiceBillingStatus(
  id: string,
  threshold?: number
): Promise<import('../types').BillingValidationResult> {
  const params = threshold ? { threshold: threshold.toString() } : {};
  const { data } = await apiClient.get<import('../types').BillingValidationResult>(
    `/invoices/${id}/billing-status`,
    { params }
  );
  return data;
}

/**
 * Validates a proposed payment before recording it.
 * Checks if the payment would cause overbilling beyond threshold.
 * 
 * @async
 * @param {string} id - UUID of the invoice
 * @param {number} amount - Proposed payment amount
 * @param {Object} [options] - Validation options
 * @param {number} [options.threshold] - Acceptable variance threshold (default: 1.50)
 * @param {boolean} [options.strict] - If true, reject payments causing overbilling (default: false)
 * @returns {Promise<import('../types').PaymentValidationResult>} Validation result
 * @throws {Error} If the API request fails
 * 
 * @example
 * const validation = await validateProposedPayment('invoice-uuid', 500.00, { strict: true });
 * if (!validation.isValid) {
 *   console.error('Payment rejected:', validation.warnings);
 * }
 */
export async function validateProposedPayment(
  id: string,
  amount: number,
  options?: { threshold?: number; strict?: boolean }
): Promise<import('../types').PaymentValidationResult> {
  const { data } = await apiClient.post<import('../types').PaymentValidationResult>(
    `/invoices/${id}/validate-payment`,
    {
      amount,
      threshold: options?.threshold,
      strict: options?.strict,
    }
  );
  return data;
}

/**
 * Placeholder structure returned from the API.
 * 
 * @interface Placeholder
 * @property {string} placeholder - The placeholder syntax (e.g., "{{month-1}}")
 * @property {string} description - Human-readable description
 * @property {string} example - Example output value
 */
export interface Placeholder {
  placeholder: string;
  description: string;
  example: string;
}

/**
 * Fetches available placeholders for invoice templates.
 * Returns placeholder syntax, descriptions, and examples based on language.
 * 
 * @async
 * @param {string} [language='en'] - Language code for localization (e.g., 'en', 'de')
 * @returns {Promise<Placeholder[]>} Array of available placeholders
 * @throws {Error} If the API request fails
 * 
 * @example
 * const placeholders = await fetchPlaceholders('de');
 * placeholders.forEach(ph => console.log(ph.placeholder, ph.example));
 * // Output: {{month-1}} März, {{year}} 2025, {{client}} Acme Corp, ...
 */
export async function fetchPlaceholders(language: string = 'en'): Promise<Placeholder[]> {
  const { data } = await apiClient.get<Placeholder[]>('/invoices/placeholders', {
    params: { language }
  });
  return data;
}

/**
 * Opens invoice PDF in a new browser tab.
 * Generates PDF on the server and opens it in a new tab for viewing.
 * 
 * @async
 * @param {string} id - UUID of the invoice
 * @param {boolean} [enableZugferd] - Optional flag to enable/disable ZUGFeRD (overrides invoice setting)
 * @returns {Promise<void>} Resolves when PDF is opened
 * @throws {Error} If the PDF generation fails or invoice not found
 * 
 * @example
 * await downloadInvoicePDF('123e4567-e89b-12d3-a456-426614174000', true);
 */
export async function downloadInvoicePDF(id: string, enableZugferd?: boolean): Promise<void> {
  const params = enableZugferd !== undefined ? { zugferd: enableZugferd ? 'true' : 'false' } : {};
  
  const response = await apiClient.get(`/invoices/${id}/pdf`, {
    responseType: 'blob', // Important: tells axios to expect binary data
    params,
  });

  // Create a blob from the PDF data
  const blob = new Blob([response.data], { type: 'application/pdf' });
  
  // Create URL and open in new tab
  const url = window.URL.createObjectURL(blob);
  window.open(url, '_blank');
  
  // Clean up the URL after a delay to allow the browser to load it
  setTimeout(() => window.URL.revokeObjectURL(url), 100);
}

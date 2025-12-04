/**
 * Invoice React Query Hooks
 * Provides hooks for managing invoices using React Query.
 * Handles data fetching, caching, mutations, automatic cache invalidation,
 * line item management, and invoice generation from time entries.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addInvoiceLineItems,
  cancelInvoice,
  createInvoice,
  createInvoiceCorrection,
  deleteInvoice,
  fetchBillingHistory,
  fetchInvoice,
  fetchInvoices,
  fetchInvoiceBillingStatus,
  generateInvoiceFromTimeEntries,
  replaceInvoiceLineItems,
  updateInvoice,
  validateProposedPayment,
} from '../../api/services/invoice.service';
import {
  BillingHistoryEntry,
  BillingValidationResult,
  GenerateInvoiceFromTimeEntriesPayload,
  Invoice,
  InvoiceLineItemPayload,
  InvoicePayload,
  InvoiceWithItems,
  PaymentValidationResult,
} from '../../api/types';
import { queryKeys } from './queryKeys';

/**
 * Hook for fetching all invoices for the authenticated user.
 * Results are ordered by creation date (newest first).
 * Results are cached by React Query.
 * 
 * @returns {UseQueryResult<Invoice[]>} React Query result containing invoices array
 * 
 * @example
 * const { data: invoices, isLoading, error } = useInvoices();
 * if (invoices) {
 *   invoices.forEach(inv => console.log(inv.invoice_number, inv.status));
 * }
 */
export function useInvoices() {
  return useQuery<Invoice[]>({
    queryKey: queryKeys.invoices.all,
    queryFn: fetchInvoices,
  });
}

/**
 * Hook for fetching a single invoice by ID with all line items.
 * Query is automatically disabled if ID is undefined.
 * 
 * @param {string | undefined} id - UUID of the invoice
 * @returns {UseQueryResult<InvoiceWithItems>} React Query result containing the invoice with items
 * 
 * @example
 * const { data: invoice, isLoading } = useInvoice(invoiceId);
 * if (invoice) {
 *   console.log(invoice.invoice_number, invoice.items.length);
 *   console.log('Total:', invoice.total_amount);
 * }
 */
export function useInvoice(id: string | undefined) {
  return useQuery<InvoiceWithItems>({
    queryKey: queryKeys.invoices.detail(id ?? 'pending'),
    queryFn: () => fetchInvoice(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Hook for creating a new invoice.
 * Invoice number is auto-generated (format: INV-YYYYMMDD-###).
 * Automatically invalidates the invoices list cache on success.
 * 
 * @returns {UseMutationResult} React Query mutation result
 * 
 * @example
 * const createMutation = useCreateInvoice();
 * 
 * const handleCreate = () => {
 *   createMutation.mutate({
 *     client_id: 'uuid',
 *     project_id: 'uuid',
 *     issue_date: new Date(),
 *     due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
 *     status: 'draft',
 *     currency: 'USD'
 *   });
 * };
 */
export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: InvoicePayload) => createInvoice(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
    },
  });
}

/**
 * Hook for updating an existing invoice.
 * Supports partial updates (only provided fields are updated).
 * Automatically invalidates the invoices list and detail caches on success.
 * 
 * @returns {UseMutationResult} React Query mutation result
 * 
 * @example
 * const updateMutation = useUpdateInvoice();
 * 
 * const handleUpdate = (id: string) => {
 *   updateMutation.mutate({ 
 *     id, 
 *     payload: { 
 *       status: 'sent',
 *       notes: 'Invoice sent to client' 
 *     } 
 *   });
 * };
 */
export function useUpdateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<InvoicePayload> }) =>
      updateInvoice(id, payload),
    onSuccess: (_invoice: Invoice, variables: { id: string; payload: Partial<InvoicePayload> }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(variables.id) });
    },
  });
}

/**
 * Hook for canceling an invoice.
 * Sets the invoice status to 'cancelled'.
 * Cannot cancel invoices that are already cancelled.
 * Automatically invalidates the invoices list and detail caches on success.
 * 
 * @returns {UseMutationResult} React Query mutation result
 * 
 * @example
 * const cancelMutation = useCancelInvoice();
 * 
 * const handleCancel = (id: string) => {
 *   if (confirm('Cancel this invoice? This cannot be undone.')) {
 *     cancelMutation.mutate(id);
 *   }
 * };
 */
export function useCancelInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelInvoice(id),
    onSuccess: (_invoice: Invoice, id: string) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(id) });
    },
  });
}

/**
 * Hook for creating a correction for an existing invoice.
 * Stores original invoice data and applies corrections.
 * Only works for non-draft, non-cancelled invoices.
 * Automatically invalidates the invoices list and detail caches on success.
 * 
 * @returns {UseMutationResult} React Query mutation result
 * 
 * @example
 * const correctionMutation = useCreateInvoiceCorrection();
 * 
 * const handleCorrection = (id: string, data: { correction_reason: string, items: [] }) => {
 *   correctionMutation.mutate({ id, ...data });
 * };
 */
export function useCreateInvoiceCorrection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { 
      id: string; 
      correction_reason?: string; 
      items?: Array<{ description: string; quantity: number; unit_price: number }>;
      due_date?: string;
      issue_date?: string;
      delivery_date?: string;
      notes?: string;
      invoice_headline?: string;
      invoice_text?: string;
      footer_text?: string;
    }) => createInvoiceCorrection(id, data),
    onSuccess: (_invoice: Invoice, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(variables.id) });
    },
  });
}

/**
 * Hook for deleting an invoice.
 * May fail if invoice has line items (foreign key constraint).
 * Automatically invalidates the invoices list cache on success.
 * 
 * @returns {UseMutationResult} React Query mutation result
 * 
 * @example
 * const deleteMutation = useDeleteInvoice();
 * 
 * const handleDelete = (id: string) => {
 *   if (confirm('Delete this invoice? This cannot be undone.')) {
 *     deleteMutation.mutate(id);
 *   }
 * };
 */
export function useDeleteInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteInvoice(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
    },
  });
}

/**
 * Hook for adding line items to an existing invoice.
 * Each line item can optionally reference a time entry for tracking billable hours.
 * Automatically recalculates invoice totals after adding items.
 * Automatically invalidates the invoices list and detail caches on success.
 * 
 * @returns {UseMutationResult} React Query mutation result
 * 
 * @example
 * const addItemsMutation = useAddInvoiceLineItems();
 * 
 * const handleAddItems = (invoiceId: string) => {
 *   addItemsMutation.mutate({ 
 *     id: invoiceId, 
 *     items: [
 *       {
 *         description: 'Development work',
 *         quantity: 10,
 *         unit_price: 100,
 *         time_entry_id: 'time-entry-uuid'
 *       },
 *       {
 *         description: 'Consulting',
 *         quantity: 5,
 *         unit_price: 150
 *       }
 *     ]
 *   });
 * };
 */
export function useAddInvoiceLineItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items: InvoiceLineItemPayload[] }) =>
      addInvoiceLineItems(id, items),
    onSuccess: (_invoice: InvoiceWithItems, variables: { id: string; items: InvoiceLineItemPayload[] }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(variables.id) });
    },
  });
}

/**
 * Hook for replacing all line items of an invoice.
 * Deletes existing line items and adds new ones.
 * Used when editing an invoice and updating its line items.
 * Automatically invalidates the invoice caches on success.
 * 
 * @returns {UseMutationResult} React Query mutation result
 * 
 * @example
 * const replaceMutation = useReplaceInvoiceLineItems();
 * 
 * const handleReplace = () => {
 *   replaceMutation.mutate({
 *     id: 'invoice-uuid',
 *     items: [{ description: 'Development', quantity: 10, unit_price: 100, total_price: 1000 }]
 *   });
 * };
 */
export function useReplaceInvoiceLineItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items: InvoiceLineItemPayload[] }) =>
      replaceInvoiceLineItems(id, items),
    onSuccess: (_invoice: InvoiceWithItems, variables: { id: string; items: InvoiceLineItemPayload[] }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(variables.id) });
    },
  });
}

/**
 * Hook for generating a new invoice from billable time entries.
 * Automatically creates invoice, fetches matching time entries within date range,
 * and adds them as line items with calculated totals.
 * If only project_id is provided, derives client_id from the project.
 * Automatically invalidates the invoices list cache on success.
 * 
 * @returns {UseMutationResult} React Query mutation result
 * 
 * @example
 * const generateMutation = useGenerateInvoiceFromTimeEntries();
 * 
 * const handleGenerate = () => {
 *   generateMutation.mutate({
 *     project_id: 'uuid',
 *     start_date: '2024-01-01',
 *     end_date: '2024-01-31'
 *   });
 * };
 * 
 * @example
 * // Generate for specific client
 * generateMutation.mutate({
 *   client_id: 'uuid',
 *   start_date: '2024-01-01',
 *   end_date: '2024-01-31'
 * });
 */
export function useGenerateInvoiceFromTimeEntries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: GenerateInvoiceFromTimeEntriesPayload) =>
      generateInvoiceFromTimeEntries(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });
    },
  });
}

/**
 * Hook for fetching billing history for a specific client.
 * Returns all invoices for the client with payment information:
 * - Invoice details (number, dates, status, total)
 * - Amount paid (sum of non-cancelled payments)
 * - Outstanding balance (total - amount paid)
 * Query is automatically disabled if clientId is undefined.
 * 
 * @param {string | undefined} clientId - UUID of the client
 * @returns {UseQueryResult<BillingHistoryEntry[]>} React Query result containing billing history
 * 
 * @example
 * const { data: history, isLoading } = useBillingHistory(clientId);
 * if (history) {
 *   history.forEach(entry => {
 *     console.log(
 *       entry.invoice_number, 
 *       'Total:', entry.total_amount, 
 *       'Paid:', entry.amount_paid, 
 *       'Outstanding:', entry.outstanding_balance
 *     );
 *   });
 * }
 */
export function useBillingHistory(clientId: string | undefined) {
  return useQuery<BillingHistoryEntry[]>({
    queryKey: queryKeys.invoices.billingHistory(clientId ?? 'pending'),
    queryFn: () => fetchBillingHistory(clientId as string),
    enabled: Boolean(clientId),
  });
}

/**
 * Hook for fetching billing validation status for an invoice.
 * Checks for overbilling, underbilling, and duplicate payments.
 * Query is automatically disabled if ID is undefined.
 * 
 * @param {string | undefined} id - UUID of the invoice
 * @param {number} [threshold] - Optional validation threshold (default: 1.50)
 * @returns {UseQueryResult<BillingValidationResult>} React Query result with validation status
 * 
 * @example
 * const { data: validation } = useInvoiceBillingStatus(invoiceId);
 * if (validation?.status === 'overbilled') {
 *   console.warn('Overbilled by:', Math.abs(validation.balance));
 * }
 */
export function useInvoiceBillingStatus(id: string | undefined, threshold?: number) {
  return useQuery<BillingValidationResult>({
    queryKey: [...queryKeys.invoices.detail(id ?? 'pending'), 'billing-status', threshold],
    queryFn: () => fetchInvoiceBillingStatus(id as string, threshold),
    enabled: Boolean(id),
  });
}

/**
 * Hook for validating a proposed payment before recording.
 * Returns a mutation function that checks if payment would cause overbilling.
 * 
 * @returns {UseMutationResult} React Query mutation result
 * 
 * @example
 * const validatePayment = useValidateProposedPayment();
 * 
 * const handleCheck = async () => {
 *   const result = await validatePayment.mutateAsync({
 *     invoiceId: 'uuid',
 *     amount: 500.00,
 *     strict: true
 *   });
 *   if (!result.isValid) {
 *     alert('Payment would cause overbilling!');
 *   }
 * };
 */
export function useValidateProposedPayment() {
  return useMutation<
    PaymentValidationResult,
    Error,
    { invoiceId: string; amount: number; threshold?: number; strict?: boolean }
  >({
    mutationFn: ({ invoiceId, amount, threshold, strict }) =>
      validateProposedPayment(invoiceId, amount, { threshold, strict }),
  });
}

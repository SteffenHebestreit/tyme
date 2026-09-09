/**
 * @fileoverview Expense API service
 * 
 * Provides functions to interact with the expense API endpoints.
 * Handles CRUD operations, receipt uploads, and expense analytics.
 * 
 * @module api/services/expense
 */

import api from './client';
import { Expense, ExpenseFilters, ExpenseSummary, CreateExpenseData, UpdateExpenseData } from '../types';

/**
 * Fetch all expenses with optional filters
 * 
 * @param {ExpenseFilters} filters - Optional filters for querying expenses
 * @returns {Promise<Expense[]>} List of expenses
 */
export const fetchExpenses = async (filters?: ExpenseFilters): Promise<Expense[]> => {
  const params = new URLSearchParams();
  
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    });
  }

  const url = `/expenses${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await api.get<{ expenses: Expense[]; total: number; limit: number; offset: number }>(url);
  return response.data.expenses; // Extract expenses array from response
};

/**
 * Fetch a single expense by ID
 * 
 * @param {string} expenseId - Expense UUID
 * @returns {Promise<Expense>} Expense details
 */
export const fetchExpenseById = async (expenseId: string): Promise<Expense> => {
  const response = await api.get<Expense>(`/expenses/${expenseId}`);
  return response.data;
};

/**
 * Create a new expense
 * 
 * @param {CreateExpenseData} data - Expense creation data
 * @returns {Promise<Expense>} Created expense
 */
export const createExpense = async (data: CreateExpenseData): Promise<Expense> => {
  const response = await api.post<Expense>('/expenses', data);
  return response.data;
};

/**
 * Update an existing expense
 * 
 * @param {string} expenseId - Expense UUID
 * @param {UpdateExpenseData} data - Expense update data
 * @returns {Promise<Expense>} Updated expense
 */
export const updateExpense = async (expenseId: string, data: UpdateExpenseData): Promise<Expense> => {
  const response = await api.put<Expense>(`/expenses/${expenseId}`, data);
  return response.data;
};

/**
 * Delete an expense
 * 
 * @param {string} expenseId - Expense UUID
 * @returns {Promise<void>}
 */
export const deleteExpense = async (expenseId: string): Promise<void> => {
  await api.delete(`/expenses/${expenseId}`);
};

/**
 * Upload a receipt file for an expense
 * 
 * @param {string} expenseId - Expense UUID
 * @param {File} file - Receipt file to upload
 * @returns {Promise<{ url: string, filename: string }>} Receipt information
 */
export const uploadReceipt = async (
  expenseId: string,
  file: File
): Promise<{ url: string; filename: string }> => {
  const formData = new FormData();
  formData.append('receipt', file);

  const response = await api.post<{ url: string; filename: string }>(
    `/expenses/${expenseId}/receipt`,
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );
  return response.data;
};

/**
 * Analyze a receipt PDF using AI to extract expense data
 * 
 * @param {File} file - Receipt PDF file to analyze
 * @returns {Promise<AnalyzedReceiptData>} Extracted expense data
 */
/**
 * A single position of an analysed invoice.
 *
 * Populated with 2+ entries only when the invoice bundles distinct articles;
 * the modal then offers to book one expense per position, because the GWG
 * threshold and the AfA useful life both apply per article, not per invoice.
 */
export interface AnalyzedLineItem {
  description: string;
  quantity?: number;
  /** Gross price of a single unit. */
  unit_amount?: number;
  /** Gross total for this position. */
  amount: number;
  category?: string;
  /** Decimal, e.g. 0.19 for 19%. */
  tax_rate?: number;
}

export interface AnalyzedReceiptData {
  success: boolean;
  data?: {
    amount?: number;
    currency?: string;
    date?: string;
    vendor?: string;
    /** Third-party seller on marketplace invoices ("Verkauft von" / "Sold by"). */
    seller?: string;
    invoice_number?: string;
    category?: string;
    /** What was bought — the line shown in the expense overview, never a company name. */
    description?: string;
    tax_amount?: number;
    tax_rate?: number;
    line_items?: AnalyzedLineItem[];
    confidence?: number;
    raw_text?: string;
  };
  message?: string;
  error?: string;
}

export const analyzeReceipt = async (file: File): Promise<AnalyzedReceiptData> => {
  const formData = new FormData();
  formData.append('receipt', file);

  const response = await api.post<AnalyzedReceiptData>(
    `/expenses/analyze-receipt`,
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );
  return response.data;
};

/**
 * Delete a receipt file from an expense
 * 
 * @param {string} expenseId - Expense UUID
 * @returns {Promise<void>}
 */
export const deleteReceipt = async (expenseId: string): Promise<void> => {
  await api.delete(`/expenses/${expenseId}/receipt`);
};

/**
 * Get receipt file URL for an expense
 * 
 * @param {string} expenseId - Expense UUID
 * @returns {Promise<{ url: string, filename: string }>} Receipt information
 */
export const getReceipt = async (expenseId: string): Promise<{ url: string; filename: string }> => {
  const response = await api.get<{ url: string; filename: string }>(`/expenses/${expenseId}/receipt`);
  return response.data;
};

/**
 * Approve an expense (admin only)
 * 
 * @param {string} expenseId - Expense UUID
 * @param {string} status - New status ('approved' or 'rejected')
 * @param {string} notes - Optional approval/rejection notes
 * @returns {Promise<Expense>} Updated expense
 */
export const approveExpense = async (
  expenseId: string,
  status: 'approved' | 'rejected',
  notes?: string
): Promise<Expense> => {
  const response = await api.patch<Expense>(`/expenses/${expenseId}/approve`, {
    status,
    notes,
  });
  return response.data;
};

/**
 * Get expense summary statistics
 * 
 * @param {ExpenseFilters} filters - Optional filters for summary
 * @returns {Promise<ExpenseSummary>} Expense summary data
 */
export const fetchExpenseSummary = async (filters?: ExpenseFilters): Promise<ExpenseSummary> => {
  const params = new URLSearchParams();
  
  // Only pass supported parameters to the summary endpoint
  const supportedParams = ['date_from', 'date_to', 'project_id', 'group_by', 'search'];
  
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (supportedParams.includes(key) && value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    });
  }

  const url = `/expenses/summary${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await api.get<ExpenseSummary>(url);
  return response.data;
};

/**
 * Trigger recurring expense processing manually
 * Useful for catching up on missed recurring expense generations
 * 
 * @returns {Promise<{success: boolean, message: string}>} Result of trigger
 */
export const triggerRecurringExpenses = async (): Promise<{ success: boolean; message: string }> => {
  const response = await api.post<{ success: boolean; message: string }>('/expenses/recurring/trigger');
  return response.data;
};

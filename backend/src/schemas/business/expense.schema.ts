/**
 * @fileoverview Joi validation schemas for expense endpoints.
 * 
 * Provides validation schemas for:
 * - Creating expenses
 * - Updating expenses
 * - Filtering/querying expenses
 * - Expense approval
 * 
 * @module schemas/business/expense
 */

import Joi from 'joi';
import { ExpenseCategory, ExpenseStatus } from '../../models/business/expense.model';

/**
 * Schema for creating a new expense
 * Includes tax tracking fields for tax declaration purposes
 */
export const createExpenseSchema = Joi.object({
  project_id: Joi.string().uuid().optional().allow(null),
  category: Joi.string().valid(...Object.values(ExpenseCategory), Joi.any()).required(),
  description: Joi.string().min(1).max(1000).required(),
  amount: Joi.number().positive().max(999999.99).required(),
  net_amount: Joi.number().min(0).max(999999.99).required(),
  tax_rate: Joi.number().min(0).max(100).default(0),
  tax_amount: Joi.number().min(0).max(999999.99).default(0),
  currency: Joi.string().length(3).uppercase().default('EUR'),
  expense_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required().messages({
    'string.pattern.base': 'Date must be in YYYY-MM-DD format',
  }),
  is_billable: Joi.boolean().default(false),
  is_reimbursable: Joi.boolean().default(false),
  tags: Joi.array().items(Joi.string().max(50)).max(10).default([]),
  notes: Joi.string().max(2000).optional().allow(null, ''),
  is_recurring: Joi.boolean().default(false),
  recurrence_frequency: Joi.string().valid('monthly', 'quarterly', 'yearly').optional().allow(null),
  recurrence_start_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional().allow(null).messages({
    'string.pattern.base': 'Start date must be in YYYY-MM-DD format',
  }),
  recurrence_end_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional().allow(null).messages({
    'string.pattern.base': 'End date must be in YYYY-MM-DD format',
  }),
}).custom((value, helpers) => {
  // Validate that amount = net_amount + tax_amount (within 0.01 tolerance)
  const { amount, net_amount, tax_amount } = value;
  const calculatedTotal = net_amount + tax_amount;
  
  if (Math.abs(amount - calculatedTotal) >= 0.01) {
    return helpers.error('custom.amountMismatch', {
      amount,
      calculatedTotal,
      difference: Math.abs(amount - calculatedTotal).toFixed(2)
    });
  }
  
  return value;
}, 'Tax amount validation').messages({
  'custom.amountMismatch': 'Amount ({{#amount}}) must equal net_amount + tax_amount ({{#calculatedTotal}}). Difference: {{#difference}}'
});

/**
 * Schema for updating an existing expense
 * Tax fields are optional to allow partial updates
 */
export const updateExpenseSchema = Joi.object({
  project_id: Joi.string().uuid().optional().allow(null),
  category: Joi.string().valid(...Object.values(ExpenseCategory), Joi.any()).optional(),
  description: Joi.string().min(1).max(1000).optional(),
  amount: Joi.number().positive().max(999999.99).optional(),
  net_amount: Joi.number().min(0).max(999999.99).optional(),
  tax_rate: Joi.number().min(0).max(100).optional(),
  tax_amount: Joi.number().min(0).max(999999.99).optional(),
  currency: Joi.string().length(3).uppercase().optional(),
  expense_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional().messages({
    'string.pattern.base': 'Date must be in YYYY-MM-DD format',
  }),
  is_billable: Joi.boolean().optional(),
  is_reimbursable: Joi.boolean().optional(),
  status: Joi.string().valid(...Object.values(ExpenseStatus)).optional(),
  tags: Joi.array().items(Joi.string().max(50)).max(10).optional(),
  notes: Joi.string().max(2000).optional().allow(null, ''),
  is_recurring: Joi.boolean().optional(),
  recurrence_frequency: Joi.string().valid('monthly', 'quarterly', 'yearly').optional().allow(null),
  recurrence_start_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional().allow(null).messages({
    'string.pattern.base': 'Start date must be in YYYY-MM-DD format',
  }),
  recurrence_end_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional().allow(null).messages({
    'string.pattern.base': 'End date must be in YYYY-MM-DD format',
  }),
  // Depreciation fields
  depreciation_type: Joi.string().valid('none', 'immediate', 'partial').optional().allow(null),
  depreciation_years: Joi.number().integer().min(1).max(50).optional().allow(null),
  depreciation_start_date: Joi.date().iso().optional().allow(null),
  depreciation_method: Joi.string().valid('linear', 'degressive').optional().allow(null),
  useful_life_category: Joi.string().max(100).optional().allow(null),
  tax_deductible_amount: Joi.number().min(0).max(999999.99).optional().allow(null),
  tax_deductible_percentage: Joi.number().min(0).max(100).optional().allow(null),
  tax_deductibility_reasoning: Joi.string().max(1000).optional().allow(null, ''),
}).min(1).messages({
  'object.min': 'At least one field must be provided for update',
}).custom((value, helpers) => {
  // Only validate tax calculation if all three fields are present in the update
  const { amount, net_amount, tax_amount } = value;
  
  // If all tax-related fields are present, validate the calculation
  if (amount !== undefined && net_amount !== undefined && tax_amount !== undefined) {
    const calculatedTotal = net_amount + tax_amount;
    
    if (Math.abs(amount - calculatedTotal) >= 0.01) {
      return helpers.error('custom.amountMismatch', {
        amount,
        calculatedTotal,
        difference: Math.abs(amount - calculatedTotal).toFixed(2)
      });
    }
  }
  
  return value;
}, 'Tax amount validation').messages({
  'custom.amountMismatch': 'Amount ({{#amount}}) must equal net_amount + tax_amount ({{#calculatedTotal}}). Difference: {{#difference}}'
});

/**
 * Schema for expense ID parameter
 */
export const expenseIdSchema = Joi.object({
  id: Joi.string().uuid().required().messages({
    'string.guid': 'Invalid expense ID format',
  }),
});

/**
 * Schema for filtering/querying expenses
 */
export const expenseFilterSchema = Joi.object({
  user_id: Joi.string().uuid().optional(),
  project_id: Joi.string().uuid().optional(),
  category: Joi.string().valid(...Object.values(ExpenseCategory), Joi.any()).optional(),
  status: Joi.string().valid(...Object.values(ExpenseStatus)).optional(),
  is_billable: Joi.string().valid('true', 'false').optional(),
  is_reimbursable: Joi.string().valid('true', 'false').optional(),
  date_from: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: Joi.string().max(100).optional(),
  limit: Joi.number().integer().min(0).max(10000).default(50), // 0 = unlimited
  offset: Joi.number().integer().min(0).default(0),
  sort_by: Joi.string().valid('expense_date', 'amount', 'created_at', 'category').default('expense_date'),
  sort_order: Joi.string().valid('asc', 'desc').default('desc'),
});

/**
 * Schema for approving/rejecting an expense
 */
export const approveExpenseSchema = Joi.object({
  status: Joi.string().valid(ExpenseStatus.APPROVED, ExpenseStatus.REJECTED).required().messages({
    'any.only': 'Status must be either approved or rejected',
  }),
  notes: Joi.string().max(500).optional().allow(''),
});

/**
 * Schema for marking expense as reimbursed
 */
export const reimburseExpenseSchema = Joi.object({
  status: Joi.string().valid(ExpenseStatus.REIMBURSED).required(),
  notes: Joi.string().max(500).optional().allow(''),
});

/**
 * Schema for bulk operations
 */
export const bulkExpenseSchema = Joi.object({
  expense_ids: Joi.array().items(Joi.string().uuid()).min(1).max(100).required().messages({
    'array.min': 'At least one expense ID required',
  }),
  action: Joi.string().valid('delete', 'approve', 'reject').required(),
});

/**
 * Schema for expense summary query
 */
export const expenseSummarySchema = Joi.object({
  user_id: Joi.string().uuid().optional(),
  project_id: Joi.string().uuid().optional(),
  date_from: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  group_by: Joi.string().valid('category', 'project', 'month').default('category'),
  search: Joi.string().max(255).optional(),
});

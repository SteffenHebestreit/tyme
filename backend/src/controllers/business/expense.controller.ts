/**
 * @fileoverview Expense controller — facade.
 *
 * The implementation is split by domain under ./expenses/:
 *  - expense-crud.controller          (create / list / get / update / delete)
 *  - expense-receipt.controller       (AI receipt analysis, file upload/download)
 *  - expense-workflow.controller      (approval, reimbursement, summaries, recurring)
 *  - expense-depreciation.controller  (AfA: AI analysis, settings, schedule)
 *
 * This class keeps the original public surface so route registrations are
 * unchanged. The sub-controllers use arrow-function properties, so the
 * re-exported references below stay correctly bound.
 *
 * @module controllers/business/expense
 */

import { ExpenseCrudController } from './expenses/expense-crud.controller';
import { ExpenseReceiptController } from './expenses/expense-receipt.controller';
import { ExpenseWorkflowController } from './expenses/expense-workflow.controller';
import { ExpenseDepreciationController } from './expenses/expense-depreciation.controller';

export class ExpenseController {
  private crud = new ExpenseCrudController();
  private receipts = new ExpenseReceiptController();
  private workflow = new ExpenseWorkflowController();
  private depreciation = new ExpenseDepreciationController();

  // CRUD
  createExpense = this.crud.createExpense;
  getExpenses = this.crud.getExpenses;
  getExpenseById = this.crud.getExpenseById;
  updateExpense = this.crud.updateExpense;
  deleteExpense = this.crud.deleteExpense;

  // Receipts
  analyzeReceipt = this.receipts.analyzeReceipt;
  uploadReceipt = this.receipts.uploadReceipt;
  deleteReceipt = this.receipts.deleteReceipt;
  downloadReceipt = this.receipts.downloadReceipt;

  // Workflow & reporting
  approveExpense = this.workflow.approveExpense;
  reimburseExpense = this.workflow.reimburseExpense;
  getExpenseSummary = this.workflow.getExpenseSummary;
  getBillableExpenses = this.workflow.getBillableExpenses;
  getRecurringGeneratedExpenses = this.workflow.getRecurringGeneratedExpenses;
  triggerRecurringExpenses = this.workflow.triggerRecurringExpenses;

  // Depreciation (AfA)
  analyzeDepreciation = this.depreciation.analyzeDepreciation;
  analyzeDepreciationDraft = this.depreciation.analyzeDepreciationDraft;
  updateDepreciation = this.depreciation.updateDepreciation;
  getDepreciationSchedule = this.depreciation.getDepreciationSchedule;
}

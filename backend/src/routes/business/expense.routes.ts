/**
 * @fileoverview Expense routes for expense management.
 * 
 * Provides REST API endpoints for:
 * - CRUD operations on expenses
 * - Receipt upload and deletion
 * - Expense approval workflow
 * - Expense analytics and summaries
 * 
 * All routes require authentication via Keycloak middleware.
 * 
 * @module routes/business/expense
 */

import { Router } from 'express';
import { ExpenseController } from '../../controllers/business/expense.controller';
import { authenticateKeycloak, extractKeycloakUser } from '../../middleware/auth/keycloak.middleware';
import multer from 'multer';

// Configure multer for receipt uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for PDF analysis
  },
  fileFilter: (req, file, cb) => {
    // Allow images and PDFs
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and PDFs are allowed.'));
    }
  },
});

const router = Router();
const expenseController = new ExpenseController();

// Apply authentication to all routes
router.use(authenticateKeycloak);
router.use(extractKeycloakUser);

/**
 * Expense CRUD routes
 */

// Get expense summary/analytics (must be before /:id to avoid conflicts)
router.get('/summary', expenseController.getExpenseSummary);

// Get all expenses with filtering
router.get('/', expenseController.getExpenses);

// Get single expense by ID
router.get('/:id', expenseController.getExpenseById);

// Get generated expenses from recurring template
router.get('/:id/generated', expenseController.getRecurringGeneratedExpenses);

// Create new expense
router.post('/', expenseController.createExpense);

// Update expense
router.put('/:id', expenseController.updateExpense);

// Delete expense
router.delete('/:id', expenseController.deleteExpense);

/**
 * Receipt management routes
 */

// Analyze receipt with AI (before creating expense)
router.post('/analyze-receipt', upload.single('receipt'), expenseController.analyzeReceipt);

// Upload receipt for expense
router.post('/:id/receipt', upload.single('receipt'), expenseController.uploadReceipt);

// Download receipt file
router.get('/:id/receipt/download', expenseController.downloadReceipt);

// Delete receipt from expense
router.delete('/:id/receipt', expenseController.deleteReceipt);

/**
 * Approval workflow routes
 */

// Approve or reject expense
router.patch('/:id/approve', expenseController.approveExpense);

// Mark expense as reimbursed
router.patch('/:id/reimburse', expenseController.reimburseExpense);

/**
 * Project-specific routes
 */

// Get billable expenses for a project
router.get('/project/:projectId/billable', expenseController.getBillableExpenses);

/**
 * Recurring expense routes
 */

// Manually trigger recurring expense processing (to catch up on missed occurrences)
router.post('/recurring/trigger', expenseController.triggerRecurringExpenses);

/**
 * Depreciation routes
 */

// Analyze an unsaved expense (values straight from the Add Expense form).
// Registered before the /:id routes so the literal path always wins.
router.post('/analyze-depreciation/draft', expenseController.analyzeDepreciationDraft);

// Analyze expense for depreciation using AI
router.post('/:id/analyze-depreciation', expenseController.analyzeDepreciation);

// Update depreciation settings for an expense
router.put('/:id/depreciation', expenseController.updateDepreciation);

// Get depreciation schedule for an expense
router.get('/:id/depreciation-schedule', expenseController.getDepreciationSchedule);

export default router;

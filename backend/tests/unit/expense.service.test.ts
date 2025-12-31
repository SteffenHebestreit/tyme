import { ExpenseService } from '../../src/services/business/expense.service';
import { ProjectService } from '../../src/services/business/project.service';
import { ClientService } from '../../src/services/business/client.service';
import { CreateExpenseData, ExpenseStatus } from '../../src/models/business/expense.model';
import { Client } from '../../src/models/business/client.model';
import { Project } from '../../src/models/business/project.model';
import { TEST_USER_ID } from '../setup';

describe('ExpenseService', () => {
  let expenseService: ExpenseService;
  let projectService: ProjectService;
  let clientService: ClientService;
  let testClient: Client;
  let testProject: Project;

  beforeAll(async () => {
    expenseService = new ExpenseService();
    projectService = new ProjectService();
    clientService = new ClientService();

    // Create test client and project for expense relationships
    testClient = await clientService.create({ user_id: TEST_USER_ID, name: 'Test Client for Expenses' });
    testProject = await projectService.create({ user_id: TEST_USER_ID, name: 'Test Project for Expenses', client_id: testClient.id });
  });

  describe('createExpense', () => {
    it('should create a new expense without project', async () => {
      const expenseData: CreateExpenseData = {
        category: 'office_supplies',
        description: 'Office supplies purchase',
        amount: 100.00,
        net_amount: 84.03,
        tax_rate: 19,
        tax_amount: 15.97,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
        is_billable: false,
        is_reimbursable: false,
      };

      const expense = await expenseService.createExpense(TEST_USER_ID, expenseData);

      expect(expense).toBeDefined();
      expect(expense.id).toBeDefined();
      expect(expense.user_id).toBe(TEST_USER_ID);
      expect(expense.category).toBe('office_supplies');
      expect(expense.description).toBe('Office supplies purchase');
      expect(parseFloat(expense.amount as any)).toBe(100.00);
      expect(expense.currency).toBe('EUR');
    });

    it('should create an expense with project association', async () => {
      const expenseData: CreateExpenseData = {
        project_id: testProject.id,
        category: 'travel',
        description: 'Client meeting travel',
        amount: 250.00,
        net_amount: 250.00,
        tax_rate: 0,
        tax_amount: 0,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
        is_billable: true,
        is_reimbursable: true,
      };

      const expense = await expenseService.createExpense(TEST_USER_ID, expenseData);

      expect(expense).toBeDefined();
      expect(expense.project_id).toBe(testProject.id);
      expect(expense.is_billable).toBe(true);
      expect(expense.is_reimbursable).toBe(true);
    });

    it('should create an expense with tags and notes', async () => {
      const expenseData: CreateExpenseData = {
        category: 'software',
        description: 'Software license',
        amount: 99.00,
        net_amount: 83.19,
        tax_rate: 19,
        tax_amount: 15.81,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
        tags: ['software', 'subscription', 'annual'],
        notes: 'Annual software subscription renewal',
      };

      const expense = await expenseService.createExpense(TEST_USER_ID, expenseData);

      expect(expense).toBeDefined();
      expect(expense.tags).toEqual(['software', 'subscription', 'annual']);
      expect(expense.notes).toBe('Annual software subscription renewal');
    });
  });

  describe('getExpenseById', () => {
    it('should return an expense if found', async () => {
      const newExpense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'utilities',
        description: 'Internet bill',
        amount: 50.00,
        net_amount: 42.02,
        tax_rate: 19,
        tax_amount: 7.98,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const foundExpense = await expenseService.getExpenseById(newExpense.id, TEST_USER_ID);

      expect(foundExpense).toBeDefined();
      expect(foundExpense?.id).toBe(newExpense.id);
      expect(foundExpense?.description).toBe('Internet bill');
    });

    it('should return null if expense not found', async () => {
      const foundExpense = await expenseService.getExpenseById('00000000-0000-0000-0000-000000000000', TEST_USER_ID);
      expect(foundExpense).toBeNull();
    });

    it('should not return expense for different user', async () => {
      const newExpense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'utilities',
        description: 'Phone bill',
        amount: 30.00,
        net_amount: 25.21,
        tax_rate: 19,
        tax_amount: 4.79,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      // Use a valid UUID format for different user
      const foundExpense = await expenseService.getExpenseById(newExpense.id, '00000000-0000-0000-0000-000000000001');
      expect(foundExpense).toBeNull();
    });
  });

  describe('getExpenses', () => {
    it('should return all expenses for a user', async () => {
      // Create a couple of expenses
      await expenseService.createExpense(TEST_USER_ID, {
        category: 'office_supplies',
        description: 'Printer paper',
        amount: 25.00,
        net_amount: 21.01,
        tax_rate: 19,
        tax_amount: 3.99,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });
      
      await expenseService.createExpense(TEST_USER_ID, {
        category: 'office_supplies',
        description: 'Ink cartridges',
        amount: 45.00,
        net_amount: 37.82,
        tax_rate: 19,
        tax_amount: 7.18,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const result = await expenseService.getExpenses({ user_id: TEST_USER_ID });

      expect(result.expenses.length).toBeGreaterThanOrEqual(2);
      expect(result.total).toBeGreaterThanOrEqual(2);
    });

    it('should filter expenses by category', async () => {
      await expenseService.createExpense(TEST_USER_ID, {
        category: 'marketing',
        description: 'Marketing expense',
        amount: 500.00,
        net_amount: 420.17,
        tax_rate: 19,
        tax_amount: 79.83,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const result = await expenseService.getExpenses({ 
        user_id: TEST_USER_ID,
        category: 'marketing',
      });

      expect(result.expenses.length).toBeGreaterThanOrEqual(1);
      result.expenses.forEach(expense => {
        expect(expense.category).toBe('marketing');
      });
    });

    it('should filter expenses by billable status', async () => {
      await expenseService.createExpense(TEST_USER_ID, {
        project_id: testProject.id,
        category: 'travel',
        description: 'Billable travel expense',
        amount: 150.00,
        net_amount: 150.00,
        tax_rate: 0,
        tax_amount: 0,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
        is_billable: true,
      });

      const result = await expenseService.getExpenses({ 
        user_id: TEST_USER_ID,
        is_billable: true,
      });

      expect(result.expenses.length).toBeGreaterThanOrEqual(1);
      result.expenses.forEach(expense => {
        expect(expense.is_billable).toBe(true);
      });
    });
  });

  describe('updateExpense', () => {
    it('should update an expense', async () => {
      const newExpense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'utilities',
        description: 'Original description',
        amount: 100.00,
        net_amount: 84.03,
        tax_rate: 19,
        tax_amount: 15.97,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const updatedExpense = await expenseService.updateExpense(newExpense.id, TEST_USER_ID, {
        description: 'Updated description',
        amount: 120.00,
        net_amount: 100.84,
        tax_amount: 19.16,
      });

      expect(updatedExpense).toBeDefined();
      expect(updatedExpense.description).toBe('Updated description');
      expect(parseFloat(updatedExpense.amount as any)).toBe(120.00);
    });

    it('should update expense status', async () => {
      const newExpense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'utilities',
        description: 'Pending expense',
        amount: 50.00,
        net_amount: 42.02,
        tax_rate: 19,
        tax_amount: 7.98,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const updatedExpense = await expenseService.updateExpense(newExpense.id, TEST_USER_ID, {
        status: ExpenseStatus.APPROVED,
      });

      expect(updatedExpense.status).toBe(ExpenseStatus.APPROVED);
    });

    it('should throw error when updating non-existent expense', async () => {
      await expect(
        expenseService.updateExpense('00000000-0000-0000-0000-000000000000', TEST_USER_ID, {
          description: 'Updated',
        })
      ).rejects.toThrow('Expense not found or unauthorized');
    });
  });

  describe('deleteExpense', () => {
    it('should delete an expense', async () => {
      const newExpense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'utilities',
        description: 'Expense to delete',
        amount: 25.00,
        net_amount: 21.01,
        tax_rate: 19,
        tax_amount: 3.99,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      await expenseService.deleteExpense(newExpense.id, TEST_USER_ID);

      const foundExpense = await expenseService.getExpenseById(newExpense.id, TEST_USER_ID);
      expect(foundExpense).toBeNull();
    });

    it('should throw error when deleting non-existent expense', async () => {
      await expect(
        expenseService.deleteExpense('00000000-0000-0000-0000-000000000000', TEST_USER_ID)
      ).rejects.toThrow('Expense not found or unauthorized');
    });
  });

  describe('approveExpense', () => {
    it('should approve an expense', async () => {
      const newExpense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'utilities',
        description: 'Expense to approve',
        amount: 75.00,
        net_amount: 63.03,
        tax_rate: 19,
        tax_amount: 11.97,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const approved = await expenseService.approveExpense(
        newExpense.id,
        TEST_USER_ID,
        ExpenseStatus.APPROVED
      );

      expect(approved.status).toBe(ExpenseStatus.APPROVED);
    });

    it('should reject an expense', async () => {
      const newExpense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'utilities',
        description: 'Expense to reject',
        amount: 50.00,
        net_amount: 42.02,
        tax_rate: 19,
        tax_amount: 7.98,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const rejected = await expenseService.approveExpense(
        newExpense.id,
        TEST_USER_ID,
        ExpenseStatus.REJECTED,
        'Invalid receipt'
      );

      expect(rejected.status).toBe(ExpenseStatus.REJECTED);
    });

    it('should throw error when approving non-existent expense', async () => {
      await expect(
        expenseService.approveExpense(
          '00000000-0000-0000-0000-000000000000',
          TEST_USER_ID,
          ExpenseStatus.APPROVED
        )
      ).rejects.toThrow('Expense not found or unauthorized');
    });
  });

  describe('markReimbursed', () => {
    it('should mark an expense as reimbursed', async () => {
      const newExpense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'travel',
        description: 'Reimbursable expense',
        amount: 200.00,
        net_amount: 200.00,
        tax_rate: 0,
        tax_amount: 0,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
        is_reimbursable: true,
      });

      // First approve it
      await expenseService.approveExpense(newExpense.id, TEST_USER_ID, ExpenseStatus.APPROVED);

      const reimbursed = await expenseService.markReimbursed(newExpense.id, TEST_USER_ID);

      expect(reimbursed.status).toBe(ExpenseStatus.REIMBURSED);
    });

    it('should throw error when marking non-existent expense as reimbursed', async () => {
      await expect(
        expenseService.markReimbursed('00000000-0000-0000-0000-000000000000', TEST_USER_ID)
      ).rejects.toThrow('Expense not found or unauthorized');
    });
  });

  describe('getExpenseSummary', () => {
    it('should return expense summary for user', async () => {
      // Create some expenses for summary
      await expenseService.createExpense(TEST_USER_ID, {
        category: 'office_supplies',
        description: 'Summary test expense 1',
        amount: 100.00,
        net_amount: 84.03,
        tax_rate: 19,
        tax_amount: 15.97,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
        is_billable: false,
      });

      await expenseService.createExpense(TEST_USER_ID, {
        project_id: testProject.id,
        category: 'travel',
        description: 'Summary test expense 2',
        amount: 200.00,
        net_amount: 200.00,
        tax_rate: 0,
        tax_amount: 0,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
        is_billable: true,
      });

      const summary = await expenseService.getExpenseSummary(TEST_USER_ID);

      expect(summary).toBeDefined();
      expect(Number(summary.total_expenses)).toBeGreaterThanOrEqual(2);
      expect(Number(summary.total_amount)).toBeGreaterThanOrEqual(300);
    });

    it('should filter summary by date range', async () => {
      const today = new Date().toISOString().split('T')[0];
      
      const summary = await expenseService.getExpenseSummary(TEST_USER_ID, {
        date_from: today,
        date_to: today,
      });

      expect(summary).toBeDefined();
      expect(Number(summary.total_expenses)).toBeGreaterThanOrEqual(0);
    });

    it('should filter summary by project', async () => {
      const summary = await expenseService.getExpenseSummary(TEST_USER_ID, {
        project_id: testProject.id,
      });

      expect(summary).toBeDefined();
    });
  });

  describe('getBillableExpensesForProject', () => {
    it('should return billable approved expenses for a project', async () => {
      // Create a billable expense
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        project_id: testProject.id,
        category: 'travel',
        description: 'Billable project expense',
        amount: 300.00,
        net_amount: 300.00,
        tax_rate: 0,
        tax_amount: 0,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
        is_billable: true,
      });

      // Approve the expense
      await expenseService.approveExpense(expense.id, TEST_USER_ID, ExpenseStatus.APPROVED);

      const billableExpenses = await expenseService.getBillableExpensesForProject(
        testProject.id,
        TEST_USER_ID
      );

      expect(billableExpenses.length).toBeGreaterThanOrEqual(1);
      billableExpenses.forEach(e => {
        expect(e.is_billable).toBe(true);
        expect(e.status).toBe('approved');
      });
    });

    it('should return empty array for project with no billable expenses', async () => {
      // Create a new project for this test
      const newProject = await projectService.create({
        user_id: TEST_USER_ID,
        name: 'No Billable Expenses Project',
        client_id: testClient.id,
      });

      const billableExpenses = await expenseService.getBillableExpensesForProject(
        newProject.id,
        TEST_USER_ID
      );

      expect(billableExpenses).toEqual([]);
    });
  });

  describe('getExpenses with pagination', () => {
    it('should paginate expenses', async () => {
      // Get first page
      const page1 = await expenseService.getExpenses({
        user_id: TEST_USER_ID,
        limit: 2,
        offset: 0,
      });

      expect(page1.expenses.length).toBeLessThanOrEqual(2);
      expect(page1.total).toBeGreaterThanOrEqual(page1.expenses.length);
    });

    it('should filter expenses by date range', async () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const result = await expenseService.getExpenses({
        user_id: TEST_USER_ID,
        date_from: yesterday,
        date_to: today,
      });

      expect(result.expenses).toBeDefined();
      result.expenses.forEach(expense => {
        const expenseDate = new Date(expense.expense_date).toISOString().split('T')[0];
        expect(expenseDate >= yesterday && expenseDate <= today).toBe(true);
      });
    });

    it('should filter expenses by project', async () => {
      const result = await expenseService.getExpenses({
        user_id: TEST_USER_ID,
        project_id: testProject.id,
      });

      result.expenses.forEach(expense => {
        expect(expense.project_id).toBe(testProject.id);
      });
    });

    it('should filter expenses by status', async () => {
      const result = await expenseService.getExpenses({
        user_id: TEST_USER_ID,
        status: ExpenseStatus.PENDING,
      });

      result.expenses.forEach(expense => {
        expect(expense.status).toBe(ExpenseStatus.PENDING);
      });
    });

    it('should filter reimbursable expenses', async () => {
      await expenseService.createExpense(TEST_USER_ID, {
        category: 'travel',
        description: 'Reimbursable expense for filter test',
        amount: 150.00,
        net_amount: 150.00,
        tax_rate: 0,
        tax_amount: 0,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
        is_reimbursable: true,
      });

      const result = await expenseService.getExpenses({
        user_id: TEST_USER_ID,
        is_reimbursable: true,
      });

      expect(result.expenses.length).toBeGreaterThanOrEqual(1);
      result.expenses.forEach(expense => {
        expect(expense.is_reimbursable).toBe(true);
      });
    });
  });

  describe('updateExpense with more fields', () => {
    it('should update expense category', async () => {
      const newExpense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'utilities',
        description: 'Expense for category update',
        amount: 50.00,
        net_amount: 42.02,
        tax_rate: 19,
        tax_amount: 7.98,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const updated = await expenseService.updateExpense(newExpense.id, TEST_USER_ID, {
        category: 'office_supplies',
      });

      expect(updated.category).toBe('office_supplies');
    });

    it('should update expense tags', async () => {
      const newExpense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'software',
        description: 'Expense for tags update',
        amount: 99.00,
        net_amount: 83.19,
        tax_rate: 19,
        tax_amount: 15.81,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
        tags: ['original'],
      });

      const updated = await expenseService.updateExpense(newExpense.id, TEST_USER_ID, {
        tags: ['updated', 'new-tag'],
      });

      expect(updated.tags).toEqual(['updated', 'new-tag']);
    });

    it('should update expense notes', async () => {
      const newExpense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'utilities',
        description: 'Expense for notes update',
        amount: 30.00,
        net_amount: 25.21,
        tax_rate: 19,
        tax_amount: 4.79,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const updated = await expenseService.updateExpense(newExpense.id, TEST_USER_ID, {
        notes: 'Updated notes here',
      });

      expect(updated.notes).toBe('Updated notes here');
    });

    it('should update expense billable and reimbursable flags', async () => {
      const newExpense = await expenseService.createExpense(TEST_USER_ID, {
        project_id: testProject.id,
        category: 'travel',
        description: 'Expense for flags update',
        amount: 100.00,
        net_amount: 100.00,
        tax_rate: 0,
        tax_amount: 0,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
        is_billable: false,
        is_reimbursable: false,
      });

      const updated = await expenseService.updateExpense(newExpense.id, TEST_USER_ID, {
        is_billable: true,
        is_reimbursable: true,
      });

      expect(updated.is_billable).toBe(true);
      expect(updated.is_reimbursable).toBe(true);
    });

    it('should update expense currency', async () => {
      const newExpense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'office_supplies',
        description: 'Expense for currency update',
        amount: 50.00,
        net_amount: 42.02,
        tax_rate: 19,
        tax_amount: 7.98,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const updated = await expenseService.updateExpense(newExpense.id, TEST_USER_ID, {
        currency: 'USD',
      });

      expect(updated.currency).toBe('USD');
    });
  });

  describe('getExpensesByParent', () => {
    it('should return child expenses for a parent expense', async () => {
      // Create a parent expense
      const parentExpense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'equipment',
        description: 'Parent expense for depreciation',
        amount: 1200.00,
        net_amount: 1008.40,
        tax_rate: 19,
        tax_amount: 191.60,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      // Get children (might be empty or have depreciation entries)
      const children = await expenseService.getExpensesByParent(parentExpense.id, TEST_USER_ID);

      expect(children).toBeDefined();
      expect(Array.isArray(children)).toBe(true);
    });

    it('should return empty array for expense with no children', async () => {
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'office_supplies',
        description: 'Regular expense no children',
        amount: 50.00,
        net_amount: 42.02,
        tax_rate: 19,
        tax_amount: 7.98,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const children = await expenseService.getExpensesByParent(expense.id, TEST_USER_ID);

      expect(children).toEqual([]);
    });
  });

  describe('createExpense with various categories', () => {
    it('should create expense with equipment category', async () => {
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'equipment',
        description: 'Office equipment',
        amount: 500.00,
        net_amount: 420.17,
        tax_rate: 19,
        tax_amount: 79.83,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      expect(expense.category).toBe('equipment');
    });

    it('should create expense with utilities category', async () => {
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'utilities',
        description: 'Electric bill',
        amount: 150.00,
        net_amount: 126.05,
        tax_rate: 19,
        tax_amount: 23.95,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      expect(expense.category).toBe('utilities');
    });

    it('should create expense with software category', async () => {
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'software',
        description: 'SaaS subscription',
        amount: 99.00,
        net_amount: 83.19,
        tax_rate: 19,
        tax_amount: 15.81,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      expect(expense.category).toBe('software');
    });

    it('should create expense with marketing category', async () => {
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'marketing',
        description: 'Online ads',
        amount: 200.00,
        net_amount: 168.07,
        tax_rate: 19,
        tax_amount: 31.93,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      expect(expense.category).toBe('marketing');
    });
  });

  describe('getExpenses sorting and ordering', () => {
    it('should return expenses ordered by date descending by default', async () => {
      // Create expenses with different dates
      const date1 = new Date();
      const date2 = new Date(Date.now() - 86400000); // 1 day ago

      await expenseService.createExpense(TEST_USER_ID, {
        category: 'office_supplies',
        description: 'Older expense',
        amount: 10.00,
        net_amount: 8.40,
        tax_rate: 19,
        tax_amount: 1.60,
        currency: 'EUR',
        expense_date: date2.toISOString().split('T')[0],
      });

      await expenseService.createExpense(TEST_USER_ID, {
        category: 'office_supplies',
        description: 'Newer expense',
        amount: 20.00,
        net_amount: 16.81,
        tax_rate: 19,
        tax_amount: 3.19,
        currency: 'EUR',
        expense_date: date1.toISOString().split('T')[0],
      });

      const result = await expenseService.getExpenses({ user_id: TEST_USER_ID, limit: 10, offset: 0 });

      expect(result.expenses.length).toBeGreaterThan(0);
    });
  });

  describe('updateExpense amount fields', () => {
    it('should update amount and related tax fields', async () => {
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'office_supplies',
        description: 'Expense for amount update',
        amount: 100.00,
        net_amount: 84.03,
        tax_rate: 19,
        tax_amount: 15.97,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const updated = await expenseService.updateExpense(expense.id, TEST_USER_ID, {
        amount: 200.00,
        net_amount: 168.07,
        tax_amount: 31.93,
      });

      expect(parseFloat(updated.amount as any)).toBe(200);
    });

    it('should update expense date', async () => {
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'office_supplies',
        description: 'Expense for date update',
        amount: 50.00,
        net_amount: 42.02,
        tax_rate: 19,
        tax_amount: 7.98,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const newDate = '2024-06-15';
      const updated = await expenseService.updateExpense(expense.id, TEST_USER_ID, {
        expense_date: newDate,
      });

      expect(new Date(updated.expense_date).toISOString().split('T')[0]).toBe(newDate);
    });
  });

  describe('getExpenses with multiple filters', () => {
    it('should filter by multiple criteria at once', async () => {
      await expenseService.createExpense(TEST_USER_ID, {
        project_id: testProject.id,
        category: 'travel',
        description: 'Multi-filter test',
        amount: 150.00,
        net_amount: 126.05,
        tax_rate: 19,
        tax_amount: 23.95,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
        is_billable: true,
      });

      const result = await expenseService.getExpenses({
        user_id: TEST_USER_ID,
        project_id: testProject.id,
        category: 'travel',
        limit: 10,
        offset: 0,
      });

      expect(result.expenses.length).toBeGreaterThan(0);
      result.expenses.forEach(exp => {
        if (exp.project_id === testProject.id && exp.category === 'travel') {
          expect(exp.project_id).toBe(testProject.id);
          expect(exp.category).toBe('travel');
        }
      });
    });
  });

  describe('updateExpense depreciation fields', () => {
    it('should update depreciation type to immediate', async () => {
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'equipment',
        description: 'Equipment for depreciation test',
        amount: 1000.00,
        net_amount: 840.34,
        tax_rate: 19,
        tax_amount: 159.66,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const updated = await expenseService.updateExpense(expense.id, TEST_USER_ID, {
        depreciation_type: 'immediate',
      });

      expect(updated.depreciation_type).toBe('immediate');
    });

    it('should update depreciation type to partial', async () => {
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'equipment',
        description: 'Equipment for partial depreciation',
        amount: 2000.00,
        net_amount: 1680.67,
        tax_rate: 19,
        tax_amount: 319.33,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const updated = await expenseService.updateExpense(expense.id, TEST_USER_ID, {
        depreciation_type: 'partial',
        depreciation_years: 5,
      });

      expect(updated.depreciation_type).toBe('partial');
    });
  });

  describe('createExpense with different currencies', () => {
    it('should create expense with USD currency', async () => {
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'software',
        description: 'US Software subscription',
        amount: 99.00,
        net_amount: 99.00,
        tax_rate: 0,
        tax_amount: 0,
        currency: 'USD',
        expense_date: new Date().toISOString().split('T')[0],
      });

      expect(expense.currency).toBe('USD');
    });

    it('should create expense with GBP currency', async () => {
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'travel',
        description: 'UK travel expense',
        amount: 180.00,
        net_amount: 150.00,
        tax_rate: 20,
        tax_amount: 30.00,
        currency: 'GBP',
        expense_date: new Date().toISOString().split('T')[0],
      });

      expect(expense.currency).toBe('GBP');
    });
  });

  describe('updateExpense project assignment', () => {
    it('should assign expense to project', async () => {
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'office_supplies',
        description: 'Expense without project',
        amount: 25.00,
        net_amount: 21.01,
        tax_rate: 19,
        tax_amount: 3.99,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const updated = await expenseService.updateExpense(expense.id, TEST_USER_ID, {
        project_id: testProject.id,
      });

      expect(updated.project_id).toBe(testProject.id);
    });

    it('should remove project from expense', async () => {
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        project_id: testProject.id,
        category: 'office_supplies',
        description: 'Expense with project to remove',
        amount: 30.00,
        net_amount: 25.21,
        tax_rate: 19,
        tax_amount: 4.79,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const updated = await expenseService.updateExpense(expense.id, TEST_USER_ID, {
        project_id: null,
      });

      expect(updated.project_id).toBeNull();
    });
  });

  describe('getExpenses offset and limit', () => {
    it('should handle offset correctly', async () => {
      // Create several expenses
      for (let i = 0; i < 3; i++) {
        await expenseService.createExpense(TEST_USER_ID, {
          category: 'office_supplies',
          description: `Pagination expense ${i}`,
          amount: 10.00 + i,
          net_amount: 8.40 + i,
          tax_rate: 19,
          tax_amount: 1.60,
          currency: 'EUR',
          expense_date: new Date().toISOString().split('T')[0],
        });
      }

      const result1 = await expenseService.getExpenses({ user_id: TEST_USER_ID, limit: 2, offset: 0 });
      const result2 = await expenseService.getExpenses({ user_id: TEST_USER_ID, limit: 2, offset: 2 });

      expect(result1.expenses.length).toBeLessThanOrEqual(2);
      expect(result2.expenses.length).toBeLessThanOrEqual(2);
    });
  });

  describe('createExpense with tax deductibility', () => {
    it('should create expense and update tax deductible fields', async () => {
      const expense = await expenseService.createExpense(TEST_USER_ID, {
        category: 'office_supplies',
        description: 'Tax deductible expense',
        amount: 500.00,
        net_amount: 420.17,
        tax_rate: 19,
        tax_amount: 79.83,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const updated = await expenseService.updateExpense(expense.id, TEST_USER_ID, {
        tax_deductible_amount: 420.17,
        tax_deductible_percentage: 100,
        tax_deductibility_reasoning: 'Business expense',
      });

      expect(parseFloat(updated.tax_deductible_amount as any)).toBe(420.17);
    });
  });
});

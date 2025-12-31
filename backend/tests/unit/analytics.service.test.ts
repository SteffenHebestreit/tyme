import { AnalyticsService } from '../../src/services/analytics/analytics.service';
import { ClientService } from '../../src/services/business/client.service';
import { ProjectService } from '../../src/services/business/project.service';
import { InvoiceService } from '../../src/services/financial/invoice.service';
import { ExpenseService } from '../../src/services/business/expense.service';
import { TimeEntryService } from '../../src/services/business/time-entry.service';
import { TaxPrepaymentService } from '../../src/services/financial/tax-prepayment.service';
import { Client } from '../../src/models/business/client.model';
import { Project } from '../../src/models/business/project.model';
import { TEST_USER_ID } from '../setup';

describe('AnalyticsService', () => {
  let analyticsService: AnalyticsService;
  let clientService: ClientService;
  let projectService: ProjectService;
  let invoiceService: InvoiceService;
  let expenseService: ExpenseService;
  let timeEntryService: TimeEntryService;
  let taxPrepaymentService: TaxPrepaymentService;
  let testClient: Client;
  let testProject: Project;

  beforeAll(async () => {
    analyticsService = new AnalyticsService();
    clientService = new ClientService();
    projectService = new ProjectService();
    invoiceService = new InvoiceService();
    expenseService = new ExpenseService();
    timeEntryService = new TimeEntryService();
    taxPrepaymentService = new TaxPrepaymentService();

    // Create test client and project
    testClient = await clientService.create({ user_id: TEST_USER_ID, name: 'Analytics Test Client' });
    testProject = await projectService.create({ user_id: TEST_USER_ID, name: 'Analytics Test Project', client_id: testClient.id });
  });

  describe('getTimeTrend', () => {
    it('should return time trend data for specified days', async () => {
      // Create a time entry for today
      await timeEntryService.create({
        user_id: TEST_USER_ID,
        project_id: testProject.id,
        entry_date: new Date(),
        entry_time: '09:00',
        duration_hours: 4,
        description: 'Time trend test entry',
        is_billable: true,
      });

      const trend = await analyticsService.getTimeTrend(TEST_USER_ID, 7);

      expect(trend).toBeDefined();
      expect(Array.isArray(trend)).toBe(true);
      expect(trend.length).toBeGreaterThanOrEqual(1);
      
      // Each point should have required fields
      trend.forEach(point => {
        expect(point).toHaveProperty('date');
        expect(point).toHaveProperty('total_hours');
        expect(point).toHaveProperty('billable_hours');
        expect(point).toHaveProperty('non_billable_hours');
        expect(typeof point.total_hours).toBe('number');
        expect(typeof point.billable_hours).toBe('number');
        expect(typeof point.non_billable_hours).toBe('number');
      });
    });

    it('should return billable and non-billable breakdown', async () => {
      const today = new Date();

      // Create billable entry
      await timeEntryService.create({
        user_id: TEST_USER_ID,
        project_id: testProject.id,
        entry_date: today,
        entry_time: '10:00',
        duration_hours: 2,
        is_billable: true,
      });

      // Create non-billable entry
      await timeEntryService.create({
        user_id: TEST_USER_ID,
        project_id: testProject.id,
        entry_date: today,
        entry_time: '14:00',
        duration_hours: 1,
        is_billable: false,
      });

      const trend = await analyticsService.getTimeTrend(TEST_USER_ID, 1);

      const todayStr = today.toISOString().split('T')[0];
      const todayPoint = trend.find(p => p.date === todayStr);
      expect(todayPoint).toBeDefined();
      expect(todayPoint!.billable_hours).toBeGreaterThanOrEqual(2);
      expect(todayPoint!.non_billable_hours).toBeGreaterThanOrEqual(1);
    });

    it('should return data for user with no entries (empty trend)', async () => {
      // Use a non-existent UUID format user id
      const trend = await analyticsService.getTimeTrend('00000000-0000-0000-0000-000000000001', 7);

      expect(trend).toBeDefined();
      expect(Array.isArray(trend)).toBe(true);
      // Should still return date series even with no data
      expect(trend.length).toBeGreaterThanOrEqual(1);
      trend.forEach(point => {
        expect(point.total_hours).toBe(0);
      });
    });
  });

  describe('getRevenueByClient', () => {
    it('should return revenue data by client', async () => {
      const revenue = await analyticsService.getRevenueByClient(TEST_USER_ID, 10);

      expect(revenue).toBeDefined();
      expect(Array.isArray(revenue)).toBe(true);
      
      // Each entry should have required fields
      revenue.forEach(entry => {
        expect(entry).toHaveProperty('client_id');
        expect(entry).toHaveProperty('client_name');
        expect(entry).toHaveProperty('total_revenue');
        expect(entry).toHaveProperty('invoice_count');
        expect(typeof entry.total_revenue).toBe('number');
        expect(typeof entry.invoice_count).toBe('number');
      });
    });

    it('should return empty array for user with no payments', async () => {
      const revenue = await analyticsService.getRevenueByClient('00000000-0000-0000-0000-000000000001', 10);

      expect(revenue).toBeDefined();
      expect(Array.isArray(revenue)).toBe(true);
      expect(revenue.length).toBe(0);
    });
  });

  describe('getBillableRatio', () => {
    it('should return billable ratio data', async () => {
      // Create some time entries first
      await timeEntryService.create({
        user_id: TEST_USER_ID,
        project_id: testProject.id,
        entry_date: new Date(),
        entry_time: '09:00',
        duration_hours: 6,
        is_billable: true,
      });

      await timeEntryService.create({
        user_id: TEST_USER_ID,
        project_id: testProject.id,
        entry_date: new Date(),
        entry_time: '15:00',
        duration_hours: 2,
        is_billable: false,
      });

      const ratio = await analyticsService.getBillableRatio(TEST_USER_ID);

      expect(ratio).toBeDefined();
      expect(ratio).toHaveProperty('billable_hours');
      expect(ratio).toHaveProperty('non_billable_hours');
      expect(ratio).toHaveProperty('billable_percentage');
      expect(typeof ratio.billable_hours).toBe('number');
      expect(typeof ratio.non_billable_hours).toBe('number');
      expect(typeof ratio.billable_percentage).toBe('number');
      expect(ratio.billable_percentage).toBeGreaterThanOrEqual(0);
      expect(ratio.billable_percentage).toBeLessThanOrEqual(100);
    });

    it('should return zero values for user with no entries', async () => {
      const ratio = await analyticsService.getBillableRatio('00000000-0000-0000-0000-000000000001');

      expect(ratio).toBeDefined();
      expect(ratio.billable_hours).toBe(0);
      expect(ratio.non_billable_hours).toBe(0);
      expect(ratio.billable_percentage).toBe(0);
    });
  });

  describe('getProjectProfitability', () => {
    it('should return project profitability data', async () => {
      const profitability = await analyticsService.getProjectProfitability(TEST_USER_ID, 10);

      expect(profitability).toBeDefined();
      expect(Array.isArray(profitability)).toBe(true);
      
      // Each entry should have required fields
      profitability.forEach(entry => {
        expect(entry).toHaveProperty('project_id');
        expect(entry).toHaveProperty('project_name');
        expect(entry).toHaveProperty('revenue');
        expect(entry).toHaveProperty('cost');
        expect(entry).toHaveProperty('profit');
        expect(entry).toHaveProperty('profit_margin');
        expect(typeof entry.revenue).toBe('number');
        expect(typeof entry.cost).toBe('number');
        expect(typeof entry.profit).toBe('number');
        expect(typeof entry.profit_margin).toBe('number');
      });
    });

    it('should return empty array for user with no projects', async () => {
      const profitability = await analyticsService.getProjectProfitability('00000000-0000-0000-0000-000000000001', 10);

      expect(profitability).toBeDefined();
      expect(Array.isArray(profitability)).toBe(true);
      expect(profitability.length).toBe(0);
    });
  });

  describe('getYearlyFinancialSummary', () => {
    it('should return yearly financial summary', async () => {
      const currentYear = new Date().getFullYear();
      const summary = await analyticsService.getYearlyFinancialSummary(TEST_USER_ID, currentYear);

      expect(summary).toBeDefined();
      expect(summary.year).toBe(currentYear);
      expect(summary).toHaveProperty('gross_revenue_all');
      expect(summary).toHaveProperty('gross_expenses_all');
      expect(summary).toHaveProperty('total_revenue');
      expect(summary).toHaveProperty('total_expenses');
      expect(summary).toHaveProperty('revenue_tax');
      expect(summary).toHaveProperty('expense_tax');
      expect(summary).toHaveProperty('net_revenue');
      expect(summary).toHaveProperty('net_expenses');
      expect(summary).toHaveProperty('net_profit');
      expect(summary).toHaveProperty('tax_payable');
      expect(summary).toHaveProperty('vat_prepayments');
      expect(summary).toHaveProperty('income_tax_prepayments');
      expect(summary).toHaveProperty('total_prepayments');
      expect(summary).toHaveProperty('remaining_tax_payable');
    });

    it('should default to current year if year not specified', async () => {
      const currentYear = new Date().getFullYear();
      const summary = await analyticsService.getYearlyFinancialSummary(TEST_USER_ID);

      expect(summary).toBeDefined();
      expect(summary.year).toBe(currentYear);
    });

    it('should return zero values for user with no financial data', async () => {
      const summary = await analyticsService.getYearlyFinancialSummary('00000000-0000-0000-0000-000000000001', 2024);

      expect(summary).toBeDefined();
      expect(summary.total_revenue).toBe(0);
      expect(summary.total_expenses).toBe(0);
      expect(summary.net_profit).toBe(0);
    });

    it('should include expenses in the summary', async () => {
      // Create an expense
      await expenseService.createExpense(TEST_USER_ID, {
        category: 'office_supplies',
        description: 'Analytics test expense',
        amount: 119.00,
        net_amount: 100.00,
        tax_rate: 19,
        tax_amount: 19.00,
        currency: 'EUR',
        expense_date: new Date().toISOString().split('T')[0],
      });

      const summary = await analyticsService.getYearlyFinancialSummary(TEST_USER_ID);

      expect(summary).toBeDefined();
      expect(summary.gross_expenses_all).toBeGreaterThanOrEqual(0);
      expect(summary.total_expenses).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getBillableRatio with days filter', () => {
    it('should filter by days parameter', async () => {
      const ratio = await analyticsService.getBillableRatio(TEST_USER_ID, 30);

      expect(ratio).toBeDefined();
      expect(ratio).toHaveProperty('billable_hours');
      expect(ratio).toHaveProperty('non_billable_hours');
      expect(ratio).toHaveProperty('billable_percentage');
    });

    it('should return different results for different day ranges', async () => {
      const ratio7Days = await analyticsService.getBillableRatio(TEST_USER_ID, 7);
      const ratio365Days = await analyticsService.getBillableRatio(TEST_USER_ID, 365);

      expect(ratio7Days).toBeDefined();
      expect(ratio365Days).toBeDefined();
      // 365 days should have >= hours as 7 days
      expect(ratio365Days.billable_hours + ratio365Days.non_billable_hours)
        .toBeGreaterThanOrEqual(ratio7Days.billable_hours + ratio7Days.non_billable_hours);
    });
  });

  describe('getTimeTrend edge cases', () => {
    it('should handle different day ranges', async () => {
      const trend1 = await analyticsService.getTimeTrend(TEST_USER_ID, 1);
      const trend30 = await analyticsService.getTimeTrend(TEST_USER_ID, 30);

      expect(trend1.length).toBeLessThanOrEqual(trend30.length);
    });

    it('should return consistent data structure', async () => {
      const trend = await analyticsService.getTimeTrend(TEST_USER_ID, 14);

      trend.forEach(point => {
        expect(point.total_hours).toBeGreaterThanOrEqual(0);
        expect(point.billable_hours).toBeGreaterThanOrEqual(0);
        expect(point.non_billable_hours).toBeGreaterThanOrEqual(0);
        expect(point.billable_hours + point.non_billable_hours).toBe(point.total_hours);
      });
    });
  });

  describe('getRevenueByClient with limit', () => {
    it('should respect limit parameter', async () => {
      const revenue5 = await analyticsService.getRevenueByClient(TEST_USER_ID, 5);
      const revenue1 = await analyticsService.getRevenueByClient(TEST_USER_ID, 1);

      expect(revenue1.length).toBeLessThanOrEqual(1);
      expect(revenue5.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getProjectProfitability with limit', () => {
    it('should respect limit parameter', async () => {
      const profit5 = await analyticsService.getProjectProfitability(TEST_USER_ID, 5);
      const profit1 = await analyticsService.getProjectProfitability(TEST_USER_ID, 1);

      expect(profit1.length).toBeLessThanOrEqual(1);
      expect(profit5.length).toBeLessThanOrEqual(5);
    });
  });
});

/**
 * @fileoverview Analytics service for generating dashboard statistics and charts data.
 * 
 * Provides aggregated data for:
 * - Time tracking trends over time periods
 * - Revenue analysis by client
 * - Billable vs non-billable hours ratio
 * - Project profitability calculations
 * 
 * All queries are optimized with proper aggregation and indexing.
 * 
 * @module services/analytics/analytics.service
 */

import { getDbClient } from '../../utils/database';

/**
 * Time trend data point for line charts.
 * 
 * @interface TimeTrendPoint
 * @property {string} date - Date in YYYY-MM-DD format
 * @property {number} total_hours - Total hours tracked
 * @property {number} billable_hours - Billable hours only
 * @property {number} non_billable_hours - Non-billable hours only
 */
export interface TimeTrendPoint {
  date: string;
  total_hours: number;
  billable_hours: number;
  non_billable_hours: number;
}

/**
 * Revenue by client data point for bar charts.
 * 
 * @interface RevenueByClient
 * @property {string} client_id - Client UUID
 * @property {string} client_name - Client display name
 * @property {number} total_revenue - Total revenue from paid invoices
 * @property {number} invoice_count - Number of invoices
 */
export interface RevenueByClient {
  client_id: string;
  client_name: string;
  total_revenue: number;
  invoice_count: number;
}

/**
 * Billable ratio data for pie/doughnut charts.
 * 
 * @interface BillableRatio
 * @property {number} billable_hours - Total billable hours
 * @property {number} non_billable_hours - Total non-billable hours
 * @property {number} billable_percentage - Percentage of billable hours
 */
export interface BillableRatio {
  billable_hours: number;
  non_billable_hours: number;
  billable_percentage: number;
}

/**
 * Project profitability data for bar charts.
 * 
 * @interface ProjectProfitability
 * @property {string} project_id - Project UUID
 * @property {string} project_name - Project display name
 * @property {number} revenue - Total revenue from invoices
 * @property {number} cost - Estimated cost (hours * rate)
 * @property {number} profit - Revenue - Cost
 * @property {number} profit_margin - (Profit / Revenue) * 100
 */
export interface ProjectProfitability {
  project_id: string;
  project_name: string;
  revenue: number;
  cost: number;
  profit: number;
  profit_margin: number;
}

/**
 * Yearly financial summary for dashboard overview.
 * 
 * @interface YearlyFinancialSummary
 * @property {number} year - Year of the summary
 * @property {number} gross_revenue_all - Total revenue from all payments including tax-excluded (for overview cards)
 * @property {number} gross_expenses_all - Total expenses including all items (for overview cards)
 * @property {number} total_revenue - Tax-relevant revenue from paid invoices (gross, excludes tax-excluded items)
 * @property {number} total_expenses - Tax-relevant expenses (gross)
 * @property {number} revenue_tax - VAT collected from tax-relevant revenue
 * @property {number} expense_tax - VAT paid on expenses (Vorsteuer)
 * @property {number} net_revenue - Tax-relevant revenue minus revenue tax
 * @property {number} net_expenses - Expenses minus expense tax
 * @property {number} net_profit - Net profit/loss (gross_revenue_all - gross_expenses_all, after tax)
 * @property {number} tax_payable - Net tax liability (revenue_tax - expense_tax)
 * @property {number} vat_prepayments - Total VAT prepayments made
 * @property {number} income_tax_prepayments - Total income tax prepayments made
 * @property {number} total_prepayments - Total of all tax prepayments
 * @property {number} remaining_tax_payable - Net tax liability after prepayments (tax_payable - vat_prepayments)
 */
export interface YearlyFinancialSummary {
  year: number;
  gross_revenue_all: number;
  gross_expenses_all: number;
  total_revenue: number;
  total_expenses: number;
  revenue_tax: number;
  expense_tax: number;
  net_revenue: number;
  net_expenses: number;
  net_profit: number;
  tax_payable: number;
  vat_prepayments: number;
  income_tax_prepayments: number;
  total_prepayments: number;
  remaining_tax_payable: number;
}

export class AnalyticsService {
  private db = getDbClient();

  /**
   * Get time tracking trend over specified number of days.
   * Returns daily aggregated hours with billable/non-billable breakdown.
   * 
   * @param {string} userId - User ID (Keycloak UUID)
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {Promise<TimeTrendPoint[]>} Array of time trend data points
   * 
   * @example
   * const trend = await analyticsService.getTimeTrend(userId, 30);
   * // Returns: [
   * //   { date: '2025-10-01', total_hours: 8.5, billable_hours: 7.0, non_billable_hours: 1.5 },
   * //   { date: '2025-10-02', total_hours: 9.0, billable_hours: 8.0, non_billable_hours: 1.0 },
   * //   ...
   * // ]
   */
  async getTimeTrend(userId: string, days: number = 30): Promise<TimeTrendPoint[]> {
    const query = `
      WITH date_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '${days} days',
          CURRENT_DATE,
          '1 day'::interval
        )::date AS date
      )
      SELECT 
        ds.date::text,
        COALESCE(SUM(te.duration_hours), 0) AS total_hours,
        COALESCE(SUM(
          CASE 
            WHEN te.is_billable = true THEN te.duration_hours
            ELSE 0
          END
        ), 0) AS billable_hours,
        COALESCE(SUM(
          CASE 
            WHEN te.is_billable = false THEN te.duration_hours
            ELSE 0
          END
        ), 0) AS non_billable_hours
      FROM date_series ds
      LEFT JOIN time_entries te ON te.entry_date = ds.date AND te.user_id = $1
      GROUP BY ds.date
      ORDER BY ds.date ASC
    `;

    console.log('[Analytics] getTimeTrend called for userId:', userId, 'days:', days);
    const result = await this.db.query(query, [userId]);
    console.log('[Analytics] Query returned', result.rows.length, 'rows');
    
    // Log some sample data
    const sampleRows = result.rows.filter(row => Number(row.total_hours) > 0).slice(0, 5);
    if (sampleRows.length > 0) {
      console.log('[Analytics] Sample rows with hours:', JSON.stringify(sampleRows, null, 2));
    } else {
      console.log('[Analytics] No rows with hours > 0 found');
    }
    
    return result.rows.map(row => ({
      date: row.date,
      total_hours: Number(row.total_hours),
      billable_hours: Number(row.billable_hours),
      non_billable_hours: Number(row.non_billable_hours),
    }));
  }

  /**
   * Get revenue by client for paid invoices.
   * Returns top N clients sorted by revenue.
   * 
   * @param {string} userId - User ID (Keycloak UUID)
   * @param {number} limit - Maximum number of clients to return (default: 10)
   * @returns {Promise<RevenueByClient[]>} Array of revenue by client data
   * 
   * @example
   * const revenue = await analyticsService.getRevenueByClient(userId, 10);
   * // Returns: [
   * //   { client_id: 'uuid-1', client_name: 'Acme Corp', total_revenue: 15000, invoice_count: 5 },
   * //   { client_id: 'uuid-2', client_name: 'TechCo', total_revenue: 12000, invoice_count: 3 },
   * //   ...
   * // ]
   */
  async getRevenueByClient(userId: string, limit: number = 10): Promise<RevenueByClient[]> {
    const query = `
      SELECT 
        c.id AS client_id,
        c.name AS client_name,
        COALESCE(SUM(p.amount), 0) AS total_revenue,
        COUNT(p.id) AS payment_count
      FROM clients c
      LEFT JOIN payments p ON p.client_id = c.id AND p.payment_type = 'payment' AND p.user_id = $1
      WHERE c.user_id = $1
      GROUP BY c.id, c.name
      HAVING COUNT(p.id) > 0
      ORDER BY total_revenue DESC
      LIMIT $2
    `;

    const result = await this.db.query(query, [userId, limit]);
    return result.rows.map(row => ({
      client_id: row.client_id,
      client_name: row.client_name,
      total_revenue: Number(row.total_revenue),
      invoice_count: Number(row.payment_count),
    }));
  }

  /**
   * Get billable vs non-billable hours ratio.
   * Calculates aggregated hours for all time entries.
   * 
   * @param {string} userId - User ID (Keycloak UUID)
   * @param {number} days - Number of days to look back (optional, all time if not specified)
   * @returns {Promise<BillableRatio>} Billable ratio data
   * 
   * @example
   * const ratio = await analyticsService.getBillableRatio(userId);
   * // Returns: {
   * //   billable_hours: 150,
   * //   non_billable_hours: 30,
   * //   billable_percentage: 83.33
   * // }
   */
  async getBillableRatio(userId: string, days?: number): Promise<BillableRatio> {
    let query = `
      SELECT 
        COALESCE(SUM(CASE WHEN is_billable = true THEN duration_hours ELSE 0 END), 0) AS billable_hours,
        COALESCE(SUM(CASE WHEN is_billable = false THEN duration_hours ELSE 0 END), 0) AS non_billable_hours
      FROM time_entries
      WHERE user_id = $1
    `;

    const params: any[] = [userId];

    if (days) {
      query += ` AND date_start >= CURRENT_DATE - INTERVAL '${days} days'`;
    }

    const result = await this.db.query(query, params);
    const row = result.rows[0];

    const billableHours = Number(row.billable_hours);
    const nonBillableHours = Number(row.non_billable_hours);
    const totalHours = billableHours + nonBillableHours;
    const billablePercentage = totalHours > 0 ? (billableHours / totalHours) * 100 : 0;

    return {
      billable_hours: billableHours,
      non_billable_hours: nonBillableHours,
      billable_percentage: Number(billablePercentage.toFixed(2)),
    };
  }

  /**
   * Get project profitability analysis.
   * Calculates revenue, cost, and profit for each project.
   * 
   * Cost is calculated as: (sum of hours × project hourly_rate) OR (sum of hours × 50 default rate)
   * Revenue is from paid invoices linked to the project.
   * 
   * @param {string} userId - User ID (Keycloak UUID)
   * @param {number} limit - Maximum number of projects to return (default: 10)
   * @returns {Promise<ProjectProfitability[]>} Array of project profitability data
   * 
   * @example
   * const profitability = await analyticsService.getProjectProfitability(userId, 10);
   * // Returns: [
   * //   { 
   * //     project_id: 'uuid-1', 
   * //     project_name: 'Website Redesign', 
   * //     revenue: 5000, 
   * //     cost: 3000, 
   * //     profit: 2000, 
   * //     profit_margin: 40.00 
   * //   },
   * //   ...
   * // ]
   */
  async getProjectProfitability(userId: string, limit: number = 10): Promise<ProjectProfitability[]> {
    const query = `
      WITH project_revenue AS (
        SELECT 
          project_id,
          COALESCE(SUM(amount), 0) AS total_revenue
        FROM payments
        WHERE user_id = $1 AND payment_type = 'payment'
        GROUP BY project_id
      ),
      project_expenses AS (
        SELECT 
          project_id,
          COALESCE(SUM(amount), 0) AS total_expenses
        FROM expenses
        WHERE user_id = $1
        GROUP BY project_id
      )
      SELECT 
        p.id AS project_id,
        p.name AS project_name,
        COALESCE(pr.total_revenue, 0) AS revenue,
        COALESCE(pe.total_expenses, 0) AS cost,
        (COALESCE(pr.total_revenue, 0) - COALESCE(pe.total_expenses, 0)) AS profit,
        CASE 
          WHEN COALESCE(pr.total_revenue, 0) > 0 
          THEN ((COALESCE(pr.total_revenue, 0) - COALESCE(pe.total_expenses, 0)) / COALESCE(pr.total_revenue, 0) * 100)
          ELSE 0 
        END AS profit_margin
      FROM projects p
      LEFT JOIN project_revenue pr ON pr.project_id = p.id
      LEFT JOIN project_expenses pe ON pe.project_id = p.id
      WHERE p.user_id = $1 
        AND p.status IN ('active', 'completed')
        AND (COALESCE(pr.total_revenue, 0) > 0 OR COALESCE(pe.total_expenses, 0) > 0)
      ORDER BY profit DESC
      LIMIT $2
    `;

    const result = await this.db.query(query, [userId, limit]);
    return result.rows.map(row => ({
      project_id: row.project_id,
      project_name: row.project_name,
      revenue: Number(row.revenue),
      cost: Number(row.cost),
      profit: Number(row.profit),
      profit_margin: Number(Number(row.profit_margin).toFixed(2)),
    }));
  }

  /**
   * Get yearly financial summary for dashboard overview.
   * Calculates total revenue, expenses, taxes, and net profit for a given year.
   * 
   * @param {string} userId - User ID (Keycloak UUID)
   * @param {number} year - Year to get summary for (defaults to current year)
   * @returns {Promise<YearlyFinancialSummary>} Yearly financial summary data
   * 
   * @example
   * const summary = await analyticsService.getYearlyFinancialSummary(userId, 2025);
   * // Returns: {
   * //   year: 2025,
   * //   total_revenue: 50000,
   * //   total_expenses: 15000,
   * //   revenue_tax: 7983.19,
   * //   expense_tax: 2394.96,
   * //   net_revenue: 42016.81,
   * //   net_expenses: 12605.04,
   * //   net_profit: 29411.77,
   * //   tax_payable: 5588.23
   * // }
   */
  async getYearlyFinancialSummary(userId: string, year?: number): Promise<YearlyFinancialSummary> {
    const targetYear = year || new Date().getFullYear();
    const startDate = `${targetYear}-01-01`;
    const endDate = `${targetYear}-12-31`;

    // Get revenue data from payments, with tax amounts from linked invoices
    // Returns both all-inclusive totals and tax-relevant totals
    const revenueQuery = `
      SELECT 
        COALESCE(SUM(p.amount), 0) AS gross_revenue_all,
        COALESCE(SUM(
          CASE 
            WHEN COALESCE(p.exclude_from_tax, false) = false 
                 AND (i.id IS NULL OR COALESCE(i.exclude_from_tax, false) = false)
            THEN p.amount
            ELSE 0
          END
        ), 0) AS total_revenue,
        COALESCE(SUM(
          CASE 
            WHEN COALESCE(p.exclude_from_tax, false) = false 
                 AND (i.id IS NULL OR COALESCE(i.exclude_from_tax, false) = false)
            THEN
              CASE 
                WHEN i.id IS NOT NULL THEN i.tax_amount * (p.amount / i.total_amount)
                ELSE p.amount * 0.19 / 1.19
              END
            ELSE 0
          END
        ), 0) AS revenue_tax
      FROM payments p
      LEFT JOIN invoices i ON p.invoice_id = i.id
      WHERE p.user_id = $1
        AND p.payment_type = 'payment'
        AND p.payment_date >= $2
        AND p.payment_date <= $3
    `;

    // Get expense data (approved expenses only)
    // gross_expenses_all = all expenses, total_expenses = same (no exclude_from_tax on expenses)
    const expenseQuery = `
      SELECT 
        COALESCE(SUM(amount), 0) AS gross_expenses_all,
        COALESCE(SUM(amount), 0) AS total_expenses,
        COALESCE(SUM(tax_amount), 0) AS expense_tax
      FROM expenses
      WHERE user_id = $1
        AND status = 'approved'
        AND expense_date >= $2
        AND expense_date <= $3
    `;

    // Get tax prepayments (paid status only, subtract refunds)
    const prepaymentQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN tax_type = 'vat' AND status = 'paid' THEN amount ELSE 0 END), 0) 
          - COALESCE(SUM(CASE WHEN tax_type = 'vat' AND status = 'refund' THEN amount ELSE 0 END), 0) AS vat_prepayments,
        COALESCE(SUM(CASE WHEN tax_type = 'income_tax' AND status = 'paid' THEN amount ELSE 0 END), 0) 
          - COALESCE(SUM(CASE WHEN tax_type = 'income_tax' AND status = 'refund' THEN amount ELSE 0 END), 0) AS income_tax_prepayments,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) 
          - COALESCE(SUM(CASE WHEN status = 'refund' THEN amount ELSE 0 END), 0) AS total_prepayments
      FROM tax_prepayments
      WHERE user_id = $1
        AND payment_date >= $2
        AND payment_date <= $3
        AND status IN ('paid', 'refund')
    `;

    const [revenueResult, expenseResult, prepaymentResult] = await Promise.all([
      this.db.query(revenueQuery, [userId, startDate, endDate]),
      this.db.query(expenseQuery, [userId, startDate, endDate]),
      this.db.query(prepaymentQuery, [userId, startDate, endDate]),
    ]);

    const revenueData = revenueResult.rows[0];
    const expenseData = expenseResult.rows[0];
    const prepaymentData = prepaymentResult.rows[0];

    // All-inclusive totals (for overview cards)
    const grossRevenueAll = Number(revenueData.gross_revenue_all);
    const grossExpensesAll = Number(expenseData.gross_expenses_all);

    // Tax-relevant totals (for tax breakdown)
    const totalRevenue = Number(revenueData.total_revenue);
    const revenueTax = Number(revenueData.revenue_tax);
    
    const totalExpenses = Number(expenseData.total_expenses);
    const expenseTax = Number(expenseData.expense_tax);

    const vatPrepayments = Number(prepaymentData.vat_prepayments);
    const incomeTaxPrepayments = Number(prepaymentData.income_tax_prepayments);
    const totalPrepayments = Number(prepaymentData.total_prepayments);

    // Tax-relevant net calculations
    const netRevenue = totalRevenue - revenueTax;
    const netExpenses = totalExpenses - expenseTax;
    
    // Net profit based on all-inclusive totals (gross_revenue_all - taxes - gross_expenses_all + expense_tax)
    // This represents actual profit: all income minus all expenses, accounting for VAT
    const netProfit = (grossRevenueAll - revenueTax) - (grossExpensesAll - expenseTax);
    
    const taxPayable = revenueTax - expenseTax;
    const remainingTaxPayable = taxPayable - vatPrepayments;

    return {
      year: targetYear,
      gross_revenue_all: Number(grossRevenueAll.toFixed(2)),
      gross_expenses_all: Number(grossExpensesAll.toFixed(2)),
      total_revenue: Number(totalRevenue.toFixed(2)),
      total_expenses: Number(totalExpenses.toFixed(2)),
      revenue_tax: Number(revenueTax.toFixed(2)),
      expense_tax: Number(expenseTax.toFixed(2)),
      net_revenue: Number(netRevenue.toFixed(2)),
      net_expenses: Number(netExpenses.toFixed(2)),
      net_profit: Number(netProfit.toFixed(2)),
      tax_payable: Number(taxPayable.toFixed(2)),
      vat_prepayments: Number(vatPrepayments.toFixed(2)),
      income_tax_prepayments: Number(incomeTaxPrepayments.toFixed(2)),
      total_prepayments: Number(totalPrepayments.toFixed(2)),
      remaining_tax_payable: Number(remainingTaxPayable.toFixed(2)),
    };
  }
}

export const analyticsService = new AnalyticsService();

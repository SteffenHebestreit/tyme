/**
 * @fileoverview Analytics API service for dashboard charts data.
 * 
 * Provides methods to fetch analytics data from the backend:
 * - Time tracking trends
 * - Revenue by client
 * - Billable hours ratio
 * - Project profitability
 * 
 * @module api/services/analytics.service
 */

import api from './client';

/**
 * Time trend data point interface
 */
export interface TimeTrendPoint {
  date: string;
  total_hours: number;
  billable_hours: number;
  non_billable_hours: number;
}

/**
 * Revenue by client interface
 */
export interface RevenueByClient {
  client_id: string;
  client_name: string;
  total_revenue: number;
  invoice_count: number;
}

/**
 * Billable ratio interface
 */
export interface BillableRatio {
  billable_hours: number;
  non_billable_hours: number;
  billable_percentage: number;
}

/**
 * Project profitability interface
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
 * Yearly financial summary interface
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

/**
 * Get time tracking trend over specified days
 * 
 * @param days - Number of days to look back (30, 60, or 90)
 * @returns Promise with array of time trend data points
 */
export const getTimeTrend = async (days: number = 30): Promise<TimeTrendPoint[]> => {
  const response = await api.get(`/analytics/time-trend?days=${days}`);
  return response.data;
};

/**
 * Get revenue by top clients
 * 
 * @param limit - Maximum number of clients to return (1-20)
 * @returns Promise with array of revenue by client data
 */
export const getRevenueByClient = async (limit: number = 10): Promise<RevenueByClient[]> => {
  const response = await api.get(`/analytics/revenue-by-client?limit=${limit}`);
  return response.data;
};

/**
 * Get billable vs non-billable hours ratio
 * 
 * @param days - Optional number of days to look back
 * @returns Promise with billable ratio data
 */
export const getBillableRatio = async (days?: number): Promise<BillableRatio> => {
  const url = days ? `/analytics/billable-ratio?days=${days}` : '/analytics/billable-ratio';
  const response = await api.get(url);
  return response.data;
};

/**
 * Get project profitability analysis
 * 
 * @param limit - Maximum number of projects to return (1-20)
 * @returns Promise with array of project profitability data
 */
export const getProjectProfitability = async (limit: number = 10): Promise<ProjectProfitability[]> => {
  const response = await api.get(`/analytics/project-profitability?limit=${limit}`);
  return response.data;
};

/**
 * Get yearly financial summary for the dashboard
 * 
 * @param year - Year to get summary for (defaults to current year)
 * @returns Promise with yearly financial summary data
 */
export const getYearlyFinancialSummary = async (year?: number): Promise<YearlyFinancialSummary> => {
  const url = year ? `/analytics/yearly-summary?year=${year}` : '/analytics/yearly-summary';
  const response = await api.get(url);
  return response.data;
};

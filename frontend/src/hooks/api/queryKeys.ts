import { ApiListParams, TimeEntryListParams } from '../../api/types';

export const queryKeys = {
  clients: {
    all: ['clients'] as const,
    list: (params?: ApiListParams) => ['clients', 'list', params] as const,
    detail: (id: string) => ['clients', 'detail', id] as const,
  },
  clientDocuments: {
    all: ['clientDocuments'] as const,
    list: (clientId: string, filters?: unknown) =>
      ['clientDocuments', 'list', clientId, filters] as const,
    detail: (documentId: string) => ['clientDocuments', 'detail', documentId] as const,
  },
  projects: {
    all: ['projects'] as const,
    list: (params?: ApiListParams) => ['projects', 'list', params] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
  },
  projectRates: {
    all: ['projectRates'] as const,
    list: (projectId: string) => ['projectRates', 'list', projectId] as const,
    detail: (rateId: string) => ['projectRates', 'detail', rateId] as const,
    effective: (projectId: string, date?: string) => ['projectRates', 'effective', projectId, date] as const,
  },
  timeEntries: {
    all: ['timeEntries'] as const,
    list: (params?: TimeEntryListParams) => ['timeEntries', 'list', params] as const,
    detail: (id: string) => ['timeEntries', 'detail', id] as const,
  },
  invoices: {
    all: ['invoices'] as const,
    list: (params?: Record<string, unknown>) => ['invoices', 'list', params] as const,
    detail: (id: string) => ['invoices', 'detail', id] as const,
    billingHistory: (clientId: string) => ['invoices', 'billingHistory', clientId] as const,
  },
  payments: {
    all: ['payments'] as const,
    list: (params?: Record<string, unknown>) => ['payments', 'list', params] as const,
    detail: (id: string) => ['payments', 'detail', id] as const,
    invoice: (invoiceId: string) => ['payments', 'invoice', invoiceId] as const,
  },
  dashboard: {
    summary: ['dashboard', 'summary'] as const,
  },
  analytics: {
    timeTrend: (days: number) => ['analytics', 'timeTrend', days] as const,
    revenueByClient: (limit: number) => ['analytics', 'revenueByClient', limit] as const,
    billableRatio: (days?: number) => ['analytics', 'billableRatio', days] as const,
    projectProfitability: (limit: number) => ['analytics', 'projectProfitability', limit] as const,
    yearlyFinancialSummary: ['analytics', 'yearlyFinancialSummary'] as const,
  },
  expenses: {
    all: ['expenses'] as const,
    list: (params?: Record<string, unknown>) => ['expenses', 'list', params] as const,
    detail: (id: string) => ['expenses', 'detail', id] as const,
  },
  depreciation: {
    schedule: (expenseId: string) => ['depreciation', 'schedule', expenseId] as const,
  },
};

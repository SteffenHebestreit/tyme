/**
 * @fileoverview Main finances page with tabbed interface for managing financial data.
 * 
 * Provides centralized access to:
 * - Invoice management
 * - Payment tracking
 * - Expense management
 * 
 * Uses tab navigation for better UX and organization.
 * 
 * @module pages/finances/FinancesPage
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import InvoiceList from '@/components/business/invoices/InvoiceList';
import PaymentsPage from '@/pages/payments/PaymentsPage';
import ExpensesPage from '@/pages/expenses/ExpensesPage';
import TaxPrepaymentsPage from '@/pages/finances/TaxPrepaymentsPage';
import { fetchPayments } from '@/api/services/payment.service';
import { fetchInvoices } from '@/api/services/invoice.service';
import { fetchExpenseSummary } from '@/api/services/expense.service';
import { Payment, Invoice } from '@/api/types';
import { formatCurrency } from '@/utils/currency';

type FinanceTab = 'invoices' | 'payments' | 'expenses' | 'tax-prepayments';

/**
 * Main finances page component with tabbed interface.
 * 
 * Features:
 * - Tab navigation between finance sections
 * - Date range filter with total calculations
 * - Clean, consistent layout
 * - Proper z-index management for modals
 * - Dark mode support
 * 
 * @component
 * @example
 * <Route path="/finances" element={<FinancesPage />} />
 * 
 * @returns {JSX.Element} Finances page with tab navigation
 */
export default function FinancesPage() {
  const { t } = useTranslation('finances');
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<FinanceTab>('invoices');
  const [invoiceSearchTerm, setInvoiceSearchTerm] = useState<string>('');
  
  // Handle URL params for tab switching and invoice search
  useEffect(() => {
    const tab = searchParams.get('tab') as FinanceTab | null;
    const search = searchParams.get('search');
    
    if (tab && ['invoices', 'payments', 'expenses', 'tax-prepayments'].includes(tab)) {
      setActiveTab(tab);
    }
    
    if (search) {
      setInvoiceSearchTerm(search);
      // Clear the search param after capturing it
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('search');
      newParams.delete('tab');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Handler for navigating from payments to invoices
  const handleNavigateToInvoice = (invoiceId: string) => {
    // Find the invoice number for this invoice (we can search by ID or number)
    const invoice = invoices.find(inv => inv.id === invoiceId);
    const searchTerm = invoice?.invoice_number || invoiceId;
    setInvoiceSearchTerm(searchTerm);
    setActiveTab('invoices');
  };
  
  // Initialize date filters: Start from January 1st of current year to today
  // Use local date formatting to avoid timezone shifts (toISOString converts to UTC)
  const formatLocalDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  const today = new Date();
  const currentYear = today.getFullYear();
  const jan1 = new Date(currentYear, 0, 1); // January 1st of current year
  const [startDate, setStartDate] = useState<string>(formatLocalDate(jan1));
  const [endDate, setEndDate] = useState<string>(formatLocalDate(today));

  // Fetch data for calculations
  const { data: payments = [] } = useQuery<Payment[]>({
    queryKey: ['payments'],
    queryFn: fetchPayments,
  });

  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ['invoices'],
    queryFn: fetchInvoices,
  });

  // Fetch expense summary for the date range
  const { data: expenseSummary } = useQuery({
    queryKey: ['expenses', 'summary', { date_from: startDate, date_to: endDate }],
    queryFn: () => fetchExpenseSummary({ date_from: startDate, date_to: endDate }),
  });

  // Calculate totals based on date range
  const totals = useMemo(() => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // Include the entire end date

    // Filter payments by date range
    const filteredPayments = payments.filter(payment => {
      const paymentDate = new Date(payment.payment_date);
      return paymentDate >= start && paymentDate <= end;
    });

    // Filter invoices by date range
    const filteredInvoices = invoices.filter(invoice => {
      const invoiceDate = new Date(invoice.issue_date);
      return invoiceDate >= start && invoiceDate <= end;
    });

    // Calculate payment totals
    const income = filteredPayments
      .filter(p => p.payment_type === 'payment' || p.payment_type === 'vat_refund' || p.payment_type === 'income_tax_refund')
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const refunds = filteredPayments
      .filter(p => p.payment_type === 'refund')
      .reduce((sum, p) => sum + Number(p.amount), 0);

    // Get approved expenses from expense summary (only approved expenses count)
    const expenses = expenseSummary?.approved_amount || 0;
    const expensesNet = expenseSummary?.approved_net_amount || 0;
    const expensesTax = expenseSummary?.approved_tax_amount || 0;

    // Calculate invoice totals with tax breakdown
    const totalInvoiced = filteredInvoices
      .reduce((sum, inv) => sum + Number(inv.total_amount), 0);

    const invoiceNet = filteredInvoices
      .reduce((sum, inv) => sum + Number(inv.sub_total), 0);

    const invoiceTax = filteredInvoices
      .reduce((sum, inv) => sum + Number(inv.tax_amount), 0);

    // Calculate paid invoices breakdown (for income card - shows what was actually paid)
    const paidInvoicesList = filteredInvoices.filter(inv => inv.status === 'paid');
    const paidInvoices = paidInvoicesList
      .reduce((sum, inv) => sum + Number(inv.total_amount), 0);
    const paidInvoicesNet = paidInvoicesList
      .reduce((sum, inv) => sum + Number(inv.sub_total), 0);
    const paidInvoicesTax = paidInvoicesList
      .reduce((sum, inv) => sum + Number(inv.tax_amount), 0);

    // Calculate unpaid invoices (sent, overdue, partially_paid - not draft or cancelled)
    const unpaidInvoices = filteredInvoices
      .filter(inv => inv.status !== 'paid' && inv.status !== 'draft' && inv.status !== 'cancelled')
      .reduce((sum, inv) => sum + Number(inv.total_amount), 0);

    const netAmount = income - refunds - expenses;

    return {
      income,
      refunds,
      expenses,
      expensesNet,
      expensesTax,
      netAmount,
      totalInvoiced,
      invoiceNet,
      invoiceTax,
      paidInvoices,
      paidInvoicesNet,
      paidInvoicesTax,
      unpaidInvoices,
    };
  }, [payments, invoices, expenseSummary, startDate, endDate]);

  const tabs = [
    { id: 'invoices' as FinanceTab, label: t('tabs.invoices'), icon: '📄' },
    { id: 'payments' as FinanceTab, label: t('tabs.payments'), icon: '💳' },
    { id: 'expenses' as FinanceTab, label: t('tabs.expenses'), icon: '💰' },
    { id: 'tax-prepayments' as FinanceTab, label: t('tabs.taxPrepayments'), icon: '📊' },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900 dark:text-white">
          {t('title')}
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {t('subtitle')}
        </p>
      </div>

        {/* Date Range Filters - Inline without card */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('dateRange.startDate')}
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-transparent border-0 border-b-2 border-gray-600 dark:border-gray-400 focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 text-gray-900 dark:text-gray-100 transition-all duration-200 ease-in-out accent-purple-500 px-2 py-2"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('dateRange.endDate')}
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-transparent border-0 border-b-2 border-gray-600 dark:border-gray-400 focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 text-gray-900 dark:text-gray-100 transition-all duration-200 ease-in-out accent-purple-500 px-2 py-2"
            />
          </div>
        </div>

        {/* Summary Cards */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-lg border border-green-200 dark:border-green-900/30 bg-green-50 dark:bg-green-900/20 p-4">
              <div className="text-sm font-medium text-green-600 dark:text-green-400 mb-1">
                {t('summary.totalIncome')}
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatCurrency(totals.income)}
              </div>
              {totals.paidInvoicesNet > 0 && totals.paidInvoicesTax > 0 && (
                <div className="mt-2 text-xs text-green-700 dark:text-green-300">
                  {formatCurrency(totals.paidInvoicesNet)} / {formatCurrency(totals.paidInvoicesTax)}
                  <div className="text-green-600/70 dark:text-green-400/70">
                    {t('summary.netTax')}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-red-200 dark:border-red-900/30 bg-red-50 dark:bg-red-900/20 p-4">
              <div className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">
                {t('summary.totalExpensesRefunds')}
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatCurrency(totals.expenses + totals.refunds)}
              </div>
              {totals.expensesNet > 0 && totals.expensesTax > 0 && (
                <div className="mt-2 text-xs text-red-700 dark:text-red-300">
                  {formatCurrency(totals.expensesNet)} / {formatCurrency(totals.expensesTax)}
                  <div className="text-red-600/70 dark:text-red-400/70">
                    {t('summary.netTax')}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-blue-200 dark:border-blue-900/30 bg-blue-50 dark:bg-blue-900/20 p-4">
              <div className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">
                {t('summary.totalInvoiced')}
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatCurrency(totals.totalInvoiced)}
              </div>
              <div className="mt-2 text-xs text-blue-700 dark:text-blue-300 space-y-0.5">
                <div className="flex justify-between">
                  <span>{t('summary.paid')}:</span>
                  <span className="font-medium">{formatCurrency(totals.paidInvoices)}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('summary.unpaid')}:</span>
                  <span className="font-medium">{formatCurrency(totals.unpaidInvoices)}</span>
                </div>
              </div>
            </div>

            <div className={`rounded-lg border p-4 ${
              totals.netAmount >= 0
                ? 'border-indigo-200 dark:border-indigo-900/30 bg-indigo-50 dark:bg-indigo-900/20'
                : 'border-orange-200 dark:border-orange-900/30 bg-orange-50 dark:bg-orange-900/20'
            }`}>
              <div className={`text-sm font-medium mb-1 ${
                totals.netAmount >= 0
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-orange-600 dark:text-orange-400'
              }`}>
                {t('summary.netAmount')}
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatCurrency(totals.netAmount)}
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
          <nav className="-mb-px flex space-x-8" aria-label="Finance tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center space-x-2 whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium transition-colors
                  ${
                    activeTab === tab.id
                      ? 'border-indigo-500 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-300'
                  }
                `}
                aria-current={activeTab === tab.id ? 'page' : undefined}
              >
                <span className="text-lg">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="relative">
          {activeTab === 'invoices' && (
            <InvoiceList startDate={startDate} endDate={endDate} initialSearchTerm={invoiceSearchTerm} />
          )}
          {activeTab === 'payments' && (
            <PaymentsPage startDate={startDate} endDate={endDate} onNavigateToInvoice={handleNavigateToInvoice} />
          )}
          {activeTab === 'expenses' && (
            <ExpensesPage startDate={startDate} endDate={endDate} />
          )}
          {activeTab === 'tax-prepayments' && (
            <TaxPrepaymentsPage />
          )}
        </div>
      </div>
  );
}

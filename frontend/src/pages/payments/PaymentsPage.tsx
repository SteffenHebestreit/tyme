import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchPayments } from '@/api/services/payment.service';
import { Payment } from '@/api/types';
import { useApp } from '@/store/AppContext';
import { CustomSelect } from '@/components/forms';
import { formatCurrency } from '@/utils/currency';
import { PaymentDetailModal } from '@/components/business/payments/PaymentDetailModal';
import { RecordPaymentModal } from '@/components/business/invoices/RecordPaymentModal';
import { Plus, ArrowDownLeft, ArrowUpRight, Landmark, Wallet } from 'lucide-react';
import { Table, Column } from '@/components/common/Table';

/**
 * Payments page component displaying payment and refund records only.
 * 
 * Features:
 * - Display payments and refunds (expenses moved to separate tab)
 * - Show payment details: invoice, client, amount, date, method
 * - Filter by date range and payment method
 * - Sort by date, amount, or client
 * - Responsive design with dark mode support
 * 
 * @component
 * @returns {JSX.Element} Payments page with table and filters
 */

interface PaymentsPageProps {
  startDate?: string;
  endDate?: string;
  onNavigateToInvoice?: (invoiceId: string) => void;
}

export default function PaymentsPage({ startDate: propStartDate, endDate: propEndDate, onNavigateToInvoice }: PaymentsPageProps = {}) {
  const { t } = useTranslation('payments');
  const { state } = useApp();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('all');
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<string>('all');
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [isAddPaymentModalOpen, setIsAddPaymentModalOpen] = useState(false);

  const { data: payments = [], isLoading, error, refetch } = useQuery<Payment[]>({
    queryKey: ['payments'],
    queryFn: fetchPayments,
  });

  // Filter to show ONLY payments and refunds (exclude expenses)
  const paymentsOnly = payments.filter((payment) => 
    payment.payment_type === 'payment' || 
    payment.payment_type === 'refund' || 
    (payment.payment_type as string) === 'vat_refund' || 
    (payment.payment_type as string) === 'income_tax_refund'
  );

  // Filter payments based on search, filters, and date range
  const filteredPayments = paymentsOnly.filter((payment) => {
    const matchesSearch = 
      payment.transaction_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.notes?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.client_name?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesMethod = 
      paymentMethodFilter === 'all' || 
      payment.payment_method === paymentMethodFilter;

    const matchesType =
      paymentTypeFilter === 'all' ||
      payment.payment_type === paymentTypeFilter;

    // Date range filter (if provided by parent)
    let matchesDateRange = true;
    if (propStartDate || propEndDate) {
      const paymentDate = new Date(payment.payment_date);
      if (propStartDate) {
        const start = new Date(propStartDate);
        matchesDateRange = matchesDateRange && paymentDate >= start;
      }
      if (propEndDate) {
        const end = new Date(propEndDate);
        end.setHours(23, 59, 59, 999); // Include entire end date
        matchesDateRange = matchesDateRange && paymentDate <= end;
      }
    }

    return matchesSearch && matchesMethod && matchesType && matchesDateRange;
  });

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Get unique payment methods
  const paymentMethods = Array.from(
    new Set(paymentsOnly.map((p) => p.payment_method).filter(Boolean))
  );

  // Payment type options
  const paymentTypeOptions = [
    { value: 'all', label: t('filters.allTypes') },
    { value: 'payment', label: t('type.paymentIncome') },
    { value: 'refund', label: t('type.refundOutgoing') },
    { value: 'vat_refund', label: t('type.vat_refund') },
    { value: 'income_tax_refund', label: t('type.income_tax_refund') },
  ];

  // Payment method options
  const paymentMethodOptions = [
    { value: 'all', label: t('filters.allMethods') },
    ...paymentMethods.map(method => ({
      value: method || '',
      label: method || 'Unknown',
    })),
  ];

  const columns: Column<Payment>[] = useMemo(() => [
    {
      key: 'date',
      accessorKey: 'payment_date',
      header: t('table.date'),
      render: (payment) => (
        <span className="text-gray-900 dark:text-gray-100">
          {formatDate(payment.payment_date)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'type',
      accessorKey: 'payment_type',
      header: t('table.type'),
      render: (payment) => (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
          payment.payment_type === 'payment'
            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
            : payment.payment_type === 'refund'
            ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
            : (payment.payment_type as string) === 'vat_refund'
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
            : (payment.payment_type as string) === 'income_tax_refund'
            ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400'
            : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
        }`}>
          {payment.payment_type === 'payment' ? (
            <>
              <ArrowDownLeft className="h-3 w-3" />
              {t('type.payment', { defaultValue: 'Payment' })}
            </>
          ) : payment.payment_type === 'refund' ? (
            <>
              <ArrowUpRight className="h-3 w-3" />
              {t('type.refund', { defaultValue: 'Refund' })}
            </>
          ) : (payment.payment_type as string) === 'vat_refund' ? (
            <>
              <Landmark className="h-3 w-3" />
              {t('type.vat_refund', { defaultValue: 'VAT Refund' })}
            </>
          ) : (payment.payment_type as string) === 'income_tax_refund' ? (
            <>
              <Landmark className="h-3 w-3" />
              {t('type.income_tax_refund', { defaultValue: 'Tax Refund' })}
            </>
          ) : (payment.payment_type as string) === 'vat_payment' ? (
            <>
              <Landmark className="h-3 w-3" />
              {t('type.vat_payment', { defaultValue: 'VAT Payment' })}
            </>
          ) : (payment.payment_type as string) === 'income_tax_payment' ? (
            <>
              <Landmark className="h-3 w-3" />
              {t('type.income_tax_payment', { defaultValue: 'Income Tax' })}
            </>
          ) : (payment.payment_type as string) === 'trade_tax_payment' ? (
            <>
              <Landmark className="h-3 w-3" />
              {t('type.trade_tax_payment', { defaultValue: 'Trade Tax' })}
            </>
          ) : (payment.payment_type as string) === 'surcharge_tax_payment' ? (
            <>
              <Landmark className="h-3 w-3" />
              {t('type.surcharge_tax_payment', { defaultValue: 'Surcharge Tax' })}
            </>
          ) : (
            <>
              <Wallet className="h-3 w-3" />
              {t('type.expense', { defaultValue: 'Expense' })}
            </>
          )}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'client',
      accessorKey: 'client_name',
      header: t('table.client'),
      render: (payment) => (
        <span className="text-gray-900 dark:text-gray-100">
          {payment.client_name || '-'}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'amount',
      accessorKey: 'amount',
      header: t('table.amount'),
      render: (payment) => (
        <span className={`font-semibold ${
          payment.payment_type === 'payment' || (payment.payment_type as string) === 'vat_refund' || (payment.payment_type as string) === 'income_tax_refund'
            ? 'text-green-600 dark:text-green-400'
            : 'text-red-600 dark:text-red-400'
        }`}>
          {formatCurrency(payment.amount)}
        </span>
      ),
      sortable: true,
      sortValue: (payment) => {
        const val = Number(payment.amount);
        const isPositive = payment.payment_type === 'payment' || 
                           (payment.payment_type as string) === 'vat_refund' || 
                           (payment.payment_type as string) === 'income_tax_refund';
        return isPositive ? val : -val;
      },
    },
    {
      key: 'method',
      accessorKey: 'payment_method',
      header: t('table.method'),
      render: (payment) => (
        <span className="text-gray-600 dark:text-gray-400">
          {payment.payment_method || 'N/A'}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'transactionId',
      accessorKey: 'transaction_id',
      header: t('table.transactionId'),
      render: (payment) => (
        <span className="font-mono text-gray-600 dark:text-gray-400">
          {payment.transaction_id || '-'}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'notes',
      header: t('table.notes'),
      render: (payment) => (
        <div className="max-w-xs truncate text-gray-600 dark:text-gray-400">
          {payment.notes || '-'}
        </div>
      ),
    },
    {
      key: 'actions',
      header: t('table.actions'),
      align: 'right',
      render: (payment) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelectedPayment(payment);
          }}
          className="text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 font-medium"
        >
          View
        </button>
      ),
    },
  ], [t]);

  if (isLoading) {
    return (
      <div className="min-h-screen pt-20 pb-8 px-4">
        <div className="container mx-auto max-w-7xl">
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen pt-20 pb-8 px-4">
        <div className="container mx-auto max-w-7xl">
          <div className={`rounded-lg p-4 ${
            state.theme === 'light'
              ? 'bg-red-50 text-red-800'
              : 'bg-red-900/20 text-red-300'
          }`}>
            <p className="font-semibold">Error loading payments</p>
            <p className="text-sm mt-1">
              {error instanceof Error ? error.message : 'An unknown error occurred'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 dark:text-white">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('subtitle')}
          </p>
        </div>
        <button
          onClick={() => setIsAddPaymentModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-5 h-5" />
          {t('addPayment', { defaultValue: 'Add Payment' })}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex w-full flex-1 items-center gap-3">
          <div className="relative w-full xl:max-w-sm">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="search"
              placeholder={t('searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="block w-full bg-transparent border-0 border-b-2 border-gray-600 dark:border-gray-400 focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 transition-all duration-200 ease-in-out accent-purple-500 py-2 pl-10 pr-3 text-sm"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="grid w-full gap-3 md:grid-cols-2 xl:w-auto xl:grid-cols-2">
          <div>
            <CustomSelect
              label={t('filters.paymentType')}
              value={paymentTypeFilter}
              onChange={setPaymentTypeFilter}
              options={paymentTypeOptions}
              size="md"
            />
          </div>
          <div>
            <CustomSelect
              label={t('filters.paymentMethod')}
              value={paymentMethodFilter}
              onChange={setPaymentMethodFilter}
              options={paymentMethodOptions}
              size="md"
            />
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-blue-200 dark:border-blue-900/30 bg-blue-50 dark:bg-blue-900/20 p-4">
              <div className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">
                {t('summary.totalTransactions')}
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {filteredPayments.length}
              </div>
          </div>

          <div className="rounded-lg border border-green-200 dark:border-green-900/30 bg-green-50 dark:bg-green-900/20 p-4">
              <div className="text-sm font-medium text-green-600 dark:text-green-400 mb-1">
                {t('summary.incomePayments')}
              </div>
              <div className="text-2xl font-bold text-green-600">
                {formatCurrency(
                  filteredPayments
                    .filter(p => p.payment_type === 'payment' || (p.payment_type as string) === 'vat_refund' || (p.payment_type as string) === 'income_tax_refund')
                    .reduce((sum, p) => sum + Number(p.amount), 0)
                )}
              </div>
          </div>

          <div className="rounded-lg border border-red-200 dark:border-red-900/30 bg-red-50 dark:bg-red-900/20 p-4">
              <div className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">
                {t('summary.refunds')}
              </div>
              <div className="text-2xl font-bold text-red-600">
                {formatCurrency(
                  filteredPayments
                  .reduce((sum, p) => {
                    if (p.payment_type === 'payment' || (p.payment_type as string) === 'vat_refund' || (p.payment_type as string) === 'income_tax_refund') {
                      return sum;
                    }
                    return sum + Number(p.amount);
                  }, 0)
                )}
              </div>
          </div>

          <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/30 bg-indigo-50 dark:bg-indigo-900/20 p-4">
              <div className="text-sm font-medium text-indigo-600 dark:text-indigo-400 mb-1">
                {t('summary.netAmount')}
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatCurrency(
                  filteredPayments.reduce((sum, p) => {
                    // Add payments and tax refunds, subtract refunds
                    if (p.payment_type === 'payment' || (p.payment_type as string) === 'vat_refund' || (p.payment_type as string) === 'income_tax_refund') {
                      return sum + Number(p.amount);
                    } else {
                      return sum - Number(p.amount);
                    }
                  }, 0)
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Payments Table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <Table
          data={filteredPayments}
          columns={columns}
          pageSize={10}
          onRowClick={(payment) => setSelectedPayment(payment)}
          emptyMessage={
            <div className="p-6 text-center">
              <svg
                className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
                {t('noPayments')}
              </h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {searchTerm || paymentMethodFilter !== 'all'
                  ? t('tryAdjustingFilters')
                  : t('noPaymentsMessage')}
              </p>
            </div>
          }
          className="border-0 shadow-none"
        />
      </div>

      {/* Payment Detail Modal */}
      <PaymentDetailModal
        payment={selectedPayment}
        isOpen={!!selectedPayment}
        onClose={() => setSelectedPayment(null)}
        onNavigateToInvoice={(invoiceId) => {
          if (onNavigateToInvoice) {
            onNavigateToInvoice(invoiceId);
          } else {
            // Fallback: navigate directly to finances with invoice search
            navigate(`/finances?tab=invoices&search=${selectedPayment?.invoice_number || invoiceId}`);
          }
        }}
      />

      {/* Add Payment Modal */}
      <RecordPaymentModal
        isOpen={isAddPaymentModalOpen}
        onClose={() => setIsAddPaymentModalOpen(false)}
        onPaymentRecorded={() => {
          refetch(); // Refresh payments list
          setIsAddPaymentModalOpen(false);
        }}
      />
    </div>
  );
}

import { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, TrendingDown, DollarSign, Receipt, Percent } from 'lucide-react';
import clsx from 'clsx';
import { useYearlyFinancialSummary } from '../../hooks/api';
import { formatCurrency } from '../../utils/currency';

/**
 * Yearly Financial Summary component for dashboard.
 * 
 * Displays prominent cards with the current year's financial overview:
 * - Total Revenue (gross)
 * - Total Expenses (gross)
 * - Tax Payable (net VAT liability)
 * - Net Profit (net revenue - net expenses)
 * 
 * Features:
 * - Large, prominent cards with color-coded indicators
 * - Automatic year selection (current year)
 * - Loading skeleton during data fetch
 * - Error state with retry
 * - Color-coded profit/loss indicator (green for profit, red for loss)
 * - Dark mode support
 * 
 * @component
 * @example
 * <YearlyFinancialSummary />
 * 
 * @returns {JSX.Element} Yearly financial summary cards
 */
export const YearlyFinancialSummary: FC = () => {
  const { t } = useTranslation('dashboard');
  const currentYear = new Date().getFullYear();
  const { data, isLoading, isError, refetch } = useYearlyFinancialSummary(currentYear);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {t('yearlyFinancialSummary.title', { year: currentYear })}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700"></div>
              <div className="mt-3 h-8 w-32 rounded bg-gray-200 dark:bg-gray-700"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {t('yearlyFinancialSummary.title', { year: currentYear })}
        </h2>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-600 dark:text-red-400">
            {t('yearlyFinancialSummary.error')}
          </p>
          <button
            onClick={() => void refetch()}
            className="mt-2 text-sm font-medium text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
          >
            {t('yearlyFinancialSummary.retry')}
          </button>
        </div>
      </div>
    );
  }

  const isProfit = data.net_profit >= 0;
  const isTaxRefund = data.remaining_tax_payable < 0; // Negative means we get money back

  const cards: Array<{
    label: string;
    value: number;
    icon: FC<{ className?: string }>;
    accent: string;
    description?: string;
  }> = [
    {
      label: t('yearlyFinancialSummary.totalRevenue'),
      value: data.gross_revenue_all,
      icon: DollarSign,
      accent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
      description: t('yearlyFinancialSummary.totalRevenueDesc'),
    },
    {
      label: t('yearlyFinancialSummary.totalExpenses'),
      value: data.gross_expenses_all,
      icon: Receipt,
      accent: 'bg-orange-500/10 text-orange-600 dark:text-orange-300',
      description: t('yearlyFinancialSummary.totalExpensesDesc'),
    },
    {
      label: t('yearlyFinancialSummary.taxPayable'),
      value: data.remaining_tax_payable,
      icon: Percent,
      accent: isTaxRefund
        ? 'bg-green-500/10 text-green-600 dark:text-green-300'
        : 'bg-red-500/10 text-red-600 dark:text-red-300',
      description: t('yearlyFinancialSummary.remainingTaxPayableDesc'),
    },
    {
      label: t('yearlyFinancialSummary.netProfit'),
      value: data.net_profit,
      icon: isProfit ? TrendingUp : TrendingDown,
      accent: isProfit
        ? 'bg-green-500/10 text-green-600 dark:text-green-300'
        : 'bg-red-500/10 text-red-600 dark:text-red-300',
      description: t('yearlyFinancialSummary.netProfitDesc'),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {t('yearlyFinancialSummary.title', { year: currentYear })}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('yearlyFinancialSummary.period', { start: `01.01.${currentYear}`, end: `31.12.${currentYear}` })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, accent, description }) => (
          <div
            key={label}
            className="group rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition hover:shadow-lg dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
                <p
                  className={clsx(
                    'mt-2 text-3xl font-bold',
                    label === t('yearlyFinancialSummary.netProfit')
                      ? isProfit
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
                      : label === t('yearlyFinancialSummary.taxPayable')
                        ? isTaxRefund
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'
                        : 'text-gray-900 dark:text-white'
                  )}
                >
                  {formatCurrency(value)}
                </p>
                {description && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{description}</p>
                )}
              </div>
              <span className={clsx('flex h-14 w-14 items-center justify-center rounded-full text-xl', accent)}>
                <Icon className="h-7 w-7" />
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Additional breakdown summary */}
      <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-5 dark:border-gray-800 dark:from-gray-900 dark:to-gray-900">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-4">
          {t('yearlyFinancialSummary.taxBreakdownTitle')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t('yearlyFinancialSummary.netRevenue')}
            </p>
            <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
              {formatCurrency(data.net_revenue)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t('yearlyFinancialSummary.netExpenses')}
            </p>
            <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
              {formatCurrency(data.net_expenses)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t('yearlyFinancialSummary.taxRelevantProfit')}
            </p>
            <p className={clsx(
              'mt-1 text-lg font-semibold',
              data.net_revenue - data.net_expenses >= 0
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            )}>
              {formatCurrency(data.net_revenue - data.net_expenses)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t('yearlyFinancialSummary.revenueTax')}
            </p>
            <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
              {formatCurrency(data.revenue_tax)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t('yearlyFinancialSummary.expenseTax')}
            </p>
            <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
              {formatCurrency(data.expense_tax)}
            </p>
          </div>
        </div>

        {/* Tax prepayments section - only show if there are any prepayments */}
        {data.total_prepayments > 0 && (
          <>
            <div className="my-4 border-t border-gray-200 dark:border-gray-700" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-purple-600 dark:text-purple-400">
                  {t('yearlyFinancialSummary.vatPrepayments')}
                </p>
                <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
                  {formatCurrency(data.vat_prepayments)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-purple-600 dark:text-purple-400">
                  {t('yearlyFinancialSummary.incomeTaxPrepayments')}
                </p>
                <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
                  {formatCurrency(data.income_tax_prepayments)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-purple-600 dark:text-purple-400">
                  {t('yearlyFinancialSummary.totalPrepayments')}
                </p>
                <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
                  {formatCurrency(data.total_prepayments)}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

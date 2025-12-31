import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useExpenses, useExpenseSummary } from '@/hooks/api/useExpenses';
import { useQuery } from '@tanstack/react-query';
import { getDepreciationSummary } from '@/api/services/depreciation.service';
import { ExpenseCategory, ExpenseStatus } from '@/api/types';
import { AddExpenseModal } from '@/components/business/expenses/AddExpenseModal';
import { ExpenseDetailModal } from '@/components/business/expenses/ExpenseDetailModal';
import { CustomSelect } from '@/components/forms';
import { formatCurrency } from '@/utils/currency';
import { Table, Column } from '@/components/common/Table';
import { 
  Chart, 
  ArcElement, 
  Tooltip, 
  Legend, 
  DoughnutController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  ChartOptions
} from 'chart.js';

// Register Chart.js components
Chart.register(
  ArcElement, 
  Tooltip, 
  Legend, 
  DoughnutController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController
);

/**
 * Expenses page component for tracking and managing business expenses.
 * 
 * Features:
 * - Display expenses with full details (category, project, status, receipts)
 * - Filter by category, status, billable, date range
 * - Search by description
 * - Show expense summary statistics
 * - Add/edit/delete expenses
 * - Upload and manage receipts
 * - Responsive design with dark mode support
 * 
 * @component
 * @returns {JSX.Element} Expenses page with table, filters, and summary
 */

interface ExpensesPageProps {
  startDate?: string;
  endDate?: string;
}

export default function ExpensesPage({ startDate: propStartDate, endDate: propEndDate }: ExpensesPageProps = {}) {
  const { t } = useTranslation('expenses');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<Chart | null>(null);
  const trendChartRef = useRef<HTMLCanvasElement>(null);
  const trendChartInstanceRef = useRef<Chart | null>(null);

  // Build filters for API
  const filters = {
    date_from: propStartDate,
    date_to: propEndDate,
    category: categoryFilter !== 'all' ? categoryFilter : undefined,
    status: statusFilter !== 'all' ? (statusFilter as ExpenseStatus) : undefined,
    search: searchTerm || undefined,
    limit: 0, // Request all expenses (no limit) for complete chart data
  };

  const { data: expenses = [], isLoading, error, refetch } = useExpenses(filters);
  const { data: summary } = useExpenseSummary(filters);
  
  // Fetch depreciation summary for current year
  const currentYear = new Date().getFullYear();
  const { data: depreciationSummary } = useQuery({
    queryKey: ['depreciation-summary', currentYear],
    queryFn: () => getDepreciationSummary(currentYear),
  });

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Category options
  const categoryOptions = [
    { value: 'all', label: t('categories.all') },
    { value: 'travel', label: t('categories.travel') },
    { value: 'meals', label: t('categories.meals') },
    { value: 'software', label: t('categories.software') },
    { value: 'hardware', label: t('categories.hardware') },
    { value: 'office_supplies', label: t('categories.office_supplies') },
    { value: 'professional_services', label: t('categories.professional_services') },
    { value: 'marketing', label: t('categories.marketing') },
    { value: 'utilities', label: t('categories.utilities') },
    { value: 'training', label: t('categories.training') },
    { value: 'other', label: t('categories.other') },
  ];

  // Status options
  const statusOptions = [
    { value: 'all', label: t('status.all') },
    { value: 'pending', label: t('status.pending') },
    { value: 'approved', label: t('status.approved') },
    { value: 'rejected', label: t('status.rejected') },
    { value: 'reimbursed', label: t('status.reimbursed') },
  ];

  // Get category label
  const getCategoryLabel = (category: string) => {
    const option = categoryOptions.find(opt => opt.value === category);
    return option?.label || category;
  };

  // Calculate category breakdown
  const categoryBreakdown = expenses.reduce((acc, expense) => {
    const category = expense.category || 'other';
    if (!acc[category]) {
      acc[category] = { total: 0, count: 0 };
    }
    acc[category].total += Number(expense.amount) || 0;
    acc[category].count += 1;
    return acc;
  }, {} as Record<string, { total: number; count: number }>);

  // Calculate total from category breakdown
  const categoryTotal = (Object.values(categoryBreakdown) as Array<{ total: number; count: number }>).reduce(
    (sum, data) => sum + data.total, 
    0
  );
  
  // Color palette: vibrant colors for major categories, muted grays for minor ones
  const categoryColors: Record<string, string> = {
    // Major expense categories - vibrant distinct colors
    vehicle_car: '#3b82f6',        // Blue
    vehicle: '#3b82f6',            // Blue (alias)
    insurance: '#10b981',          // Green
    professional_services: '#06b6d4', // Cyan
    computer: '#8b5cf6',           // Purple
    software: '#a855f7',           // Light Purple
    
    // Medium categories - distinct but less vibrant
    travel: '#f59e0b',             // Orange
    meals: '#ec4899',              // Pink
    marketing: '#84cc16',          // Lime
    hardware: '#f97316',           // Dark Orange
    training: '#14b8a6',           // Teal
    
    // Minor categories - muted grays
    storage: '#9ca3af',            // Gray
    telecommunications: '#9ca3af', // Gray
    peripherals: '#9ca3af',        // Gray
    office_supplies: '#ef4444',    // Red (stands out for office)
    utilities: '#9ca3af',          // Gray
    other: '#6b7280',              // Dark Gray
  };

  // Calculate average per month
  const monthlyAverage = (() => {
    if (!summary || summary.total_amount === 0) return 0;
    
    // Group expenses by month to count unique months
    const months = new Set<string>();
    expenses.forEach((expense: any) => {
      const date = new Date(expense.expense_date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      months.add(monthKey);
    });
    
    const monthCount = months.size || 1;
    return summary.total_amount / monthCount;
  })();

  // Create Chart.js donut chart
  useEffect(() => {
    console.log('[Chart] useEffect triggered', {
      hasChartRef: !!chartRef.current,
      categoryBreakdownKeys: Object.keys(categoryBreakdown).length,
      categoryTotal,
      categoryBreakdown
    });

    if (!chartRef.current || Object.keys(categoryBreakdown).length === 0 || !categoryTotal) {
      console.log('[Chart] Skipping chart creation - missing requirements');
      return;
    }

    // Destroy existing chart
    if (chartInstanceRef.current) {
      console.log('[Chart] Destroying existing chart');
      chartInstanceRef.current.destroy();
    }

    const ctx = chartRef.current.getContext('2d');
    if (!ctx) {
      console.log('[Chart] Failed to get 2d context');
      return;
    }

    const sortedCategories = Object.entries(categoryBreakdown).sort(([, a], [, b]) => b.total - a.total);
    console.log('[Chart] Creating chart with data:', sortedCategories);
    
    chartInstanceRef.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: sortedCategories.map(([category]) => getCategoryLabel(category)),
        datasets: [{
          data: sortedCategories.map(([, data]) => data.total),
          backgroundColor: sortedCategories.map(([category]) => categoryColors[category] || categoryColors.other),
          borderWidth: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed;
                const percentage = ((value / categoryTotal) * 100).toFixed(1);
                return `${formatCurrency(value)} (${percentage}%)`;
              }
            }
          }
        },
        cutout: '60%',
      }
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
      }
    };
  }, [categoryBreakdown, categoryTotal, getCategoryLabel]);

  // Create expense trend line chart (monthly totals over the year)
  useEffect(() => {
    if (!trendChartRef.current || expenses.length === 0) return;

    // Destroy existing chart
    if (trendChartInstanceRef.current) {
      trendChartInstanceRef.current.destroy();
    }

    // Group expenses by month
    const monthlyData: Record<string, number> = {};
    expenses.forEach((expense: any) => {
      // Parse date string as local date to avoid timezone issues
      // expense_date format is "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss..."
      const dateStr = expense.expense_date.split('T')[0]; // Get just the date part
      const [year, month] = dateStr.split('-');
      const monthKey = `${year}-${month}`;
      monthlyData[monthKey] = (monthlyData[monthKey] || 0) + Number(expense.amount);
    });

    // Generate all months in the date range (or current year up to today if no date range)
    const allMonths: string[] = [];
    let startMonth: Date;
    let endMonth: Date;
    
    // Get today's date in local timezone
    const today = new Date();
    const currentYear = today.getFullYear();
    
    if (propStartDate && propEndDate) {
      // Use the provided date range (inclusive)
      // Parse as local date by extracting year/month/day
      const [startYear, startMonthNum, startDay] = propStartDate.split('-').map(Number);
      const [endYear, endMonthNum, endDay] = propEndDate.split('-').map(Number);
      startMonth = new Date(startYear, startMonthNum - 1, startDay);
      endMonth = new Date(endYear, endMonthNum - 1, endDay);
    } else {
      // Default: January 1st of current year to today (max Dec 31st)
      startMonth = new Date(currentYear, 0, 1); // January 1st
      // End at current date, but no later than December 31st of current year
      const dec31 = new Date(currentYear, 11, 31);
      endMonth = today <= dec31 ? today : dec31;
    }
    
    // Generate all months between start and end
    const current = new Date(startMonth.getFullYear(), startMonth.getMonth(), 1);
    const end = new Date(endMonth.getFullYear(), endMonth.getMonth(), 1);
    
    while (current <= end) {
      const monthKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
      allMonths.push(monthKey);
      current.setMonth(current.getMonth() + 1);
    }

    // Use all months for labels and data (fill with 0 if no expenses)
    const labels = allMonths.map(month => {
      const [year, monthNum] = month.split('-');
      const date = new Date(Number(year), Number(monthNum) - 1);
      return date.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
    });
    const data = allMonths.map(month => monthlyData[month] || 0);

    // Create chart
    trendChartInstanceRef.current = new Chart(trendChartRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Ausgaben',
          data,
          borderColor: '#8b5cf6',
          backgroundColor: '#8b5cf620',
          fill: true,
          tension: 0.4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: (context: any) => {
                return `${formatCurrency(context.parsed.y)}`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value: any) => formatCurrency(value as number)
            }
          }
        }
      }
    });

    return () => {
      if (trendChartInstanceRef.current) {
        trendChartInstanceRef.current.destroy();
      }
    };
  }, [expenses, propStartDate, propEndDate]);

  // getStatusBadgeColor removed - status column hidden for solo freelancer

  const columns: Column<any>[] = useMemo(() => [
    {
      key: 'date',
      accessorKey: 'expense_date',
      header: t('table.date'),
      render: (expense) => (
        <span className="text-gray-900 dark:text-gray-100">
          {formatDate(expense.expense_date)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'description',
      accessorKey: 'description',
      header: t('table.description'),
      render: (expense) => (
        <div className="max-w-xs">
          <div className="font-medium text-gray-900 dark:text-gray-100">{expense.description}</div>
          <div className="flex gap-2 mt-1">
            {expense.is_billable && (
              <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                {t('fields.billable')}
              </span>
            )}
            {expense.is_recurring && (
              <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">
                🔄 {t('recurring.recurring', 'Recurring')}
              </span>
            )}
            {expense.parent_expense_id && (
              <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                {t('recurring.autoGenerated', 'Auto-generated')}
              </span>
            )}
          </div>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'category',
      accessorKey: 'category',
      header: t('table.category'),
      render: (expense) => (
        <span className="text-gray-600 dark:text-gray-400">
          {getCategoryLabel(expense.category)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'amount',
      accessorKey: 'amount',
      header: t('table.amount'),
      render: (expense) => (
        <span className="font-semibold text-red-600 dark:text-red-400">
          {formatCurrency(expense.amount, expense.currency)}
        </span>
      ),
      sortable: true,
      sortValue: (expense) => Number(expense.amount),
    },
    {
      key: 'depreciation',
      header: t('table.depreciation', 'Depreciation'),
      render: (expense) => (
        expense.depreciation_type === 'immediate' ? (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
            Immediate
          </span>
        ) : expense.depreciation_type === 'partial' ? (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
            {expense.depreciation_years}y
          </span>
        ) : (
          <span className="text-gray-400">-</span>
        )
      ),
    },
    {
      key: 'taxDeductible',
      header: t('table.taxDeductible', 'Tax Deductible'),
      render: (expense) => (
        expense.tax_deductible_percentage !== null && expense.tax_deductible_percentage !== undefined ? (
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              expense.tax_deductible_percentage === 100
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : expense.tax_deductible_percentage === 0
                ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
            }`}>
              {expense.tax_deductible_percentage}%
            </span>
          </div>
        ) : (
          <span className="text-gray-400">-</span>
        )
      ),
    },
    {
      key: 'receipt',
      header: t('table.receipt'),
      render: (expense) => (
        expense.receipt_url ? (
          <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        ) : (
          <span className="text-gray-400">-</span>
        )
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (expense) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelectedExpenseId(expense.id);
          }}
          className="text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 font-medium"
        >
          {t('view')}
        </button>
      ),
    },
  ], [t, getCategoryLabel]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-red-800 dark:bg-red-900/20 dark:text-red-300">
        <p className="font-semibold">{t('errorLoading')}</p>
        <p className="text-sm mt-1">
          {error instanceof Error ? error.message : 'An unknown error occurred'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 dark:text-white">
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('subtitle')}
          </p>
        </div>
        
        <button
          onClick={() => setShowExpenseModal(true)}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-700"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('addExpense')}
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
        <div className="flex gap-3">
          <CustomSelect
            label={t('fields.category')}
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={categoryOptions}
            size="md"
          />
          {/* Status filter hidden - not needed for solo freelancer (all expenses auto-approved) */}
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Total Expenses Card */}
            <div className="lg:col-span-1 space-y-4">
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-900/30 dark:bg-orange-900/20">
                <div className="text-sm font-medium text-orange-600 dark:text-orange-400 mb-1">
                  {t('summary.totalExpenses')}
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {formatCurrency(summary.total_amount)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {summary.total_expenses} {t('summary.transactions')}
                </div>
              </div>

              {/* Average per Month Card */}
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/30 dark:bg-blue-900/20">
                <div className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-1">
                  Durchschnitt je Monat
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {formatCurrency(monthlyAverage)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Ø Betrag
                </div>
              </div>
            </div>

            {/* Category Breakdown Donut Chart */}
            <div className="lg:col-span-2">
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-900/30 dark:bg-purple-900/20 h-full">
                <div className="text-sm font-medium text-purple-600 dark:text-purple-400 mb-3">
                  Ausgaben nach Kategorie
                </div>
                {Object.keys(categoryBreakdown).length > 0 ? (
                  <div className="flex items-center gap-6">
                    {/* Chart.js Donut Chart */}
                    <div className="flex-shrink-0" style={{ width: '200px', height: '200px' }}>
                      <canvas ref={chartRef}></canvas>
                    </div>
                    
                    {/* Legend */}
                    <div className="flex-1 space-y-2">
                      {Object.entries(categoryBreakdown)
                        .sort(([, a], [, b]) => b.total - a.total)
                        .map(([category, data]) => {
                          const percentage = (data.total / categoryTotal) * 100;
                          return (
                            <div key={category} className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-sm flex-shrink-0"
                                style={{ backgroundColor: categoryColors[category] || categoryColors.other }}
                              />
                              <div className="flex-1 flex justify-between items-center gap-4 text-xs">
                                <span className="text-gray-700 dark:text-gray-300 truncate">
                                  {getCategoryLabel(category)}
                                </span>
                                <span className="font-medium text-gray-900 dark:text-white whitespace-nowrap">
                                  {formatCurrency(data.total)} ({percentage.toFixed(1)}%)
                                </span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                    Keine Kategoriedaten verfügbar
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expense Trend Line Chart */}
      <div className="bg-white dark:bg-gray-900 rounded-lg p-6 shadow-lg">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Ausgaben über Zeit
        </h3>
        <div className="relative" style={{ height: '300px' }}>
          {expenses.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-gray-500 dark:text-gray-400">Keine Daten verfügbar</p>
            </div>
          ) : (
            <canvas ref={trendChartRef} style={{ maxHeight: '300px' }}></canvas>
          )}
        </div>
      </div>

      {/* Depreciation Summary Cards */}
      {depreciationSummary && depreciationSummary.summary.total_assets_under_depreciation > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Abschreibungen (AfA) {currentYear}
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-900/30 dark:bg-purple-900/20">
              <div className="text-sm font-medium text-purple-600 dark:text-purple-400 mb-1">
                Anzahl Vermögenswerte
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {depreciationSummary.summary.total_assets_under_depreciation}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Wird über mehrere Jahre abgeschrieben
              </div>
            </div>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/30 dark:bg-emerald-900/20">
              <div className="text-sm font-medium text-emerald-600 dark:text-emerald-400 mb-1">
                Steuerlich Absetzbar ({currentYear})
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatCurrency(depreciationSummary.summary.depreciation_amount || 0)}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Abschreibung dieses Jahr
              </div>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/30 dark:bg-amber-900/20">
              <div className="text-sm font-medium text-amber-600 dark:text-amber-400 mb-1">
                Verbleibender Wert
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatCurrency(depreciationSummary.summary.deferred_amount || 0)}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Wird in Zukunft abgeschrieben
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expenses Table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <Table
          data={expenses}
          columns={columns}
          pageSize={10}
          onRowClick={(expense) => setSelectedExpenseId(expense.id)}
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
                {t('noExpenses')}
              </h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {searchTerm || categoryFilter !== 'all' || statusFilter !== 'all'
                  ? t('tryAdjustingFilters')
                  : t('noExpensesMessage')}
              </p>
            </div>
          }
          className="border-0 shadow-none"
        />
      </div>

      {/* Add Expense Modal */}
      <AddExpenseModal
        isOpen={showExpenseModal}
        onClose={() => setShowExpenseModal(false)}
        onExpenseAdded={() => refetch()}
      />

      {/* Expense Detail Modal */}
      {selectedExpenseId && (
        <ExpenseDetailModal
          expenseId={selectedExpenseId}
          isOpen={!!selectedExpenseId}
          onClose={() => setSelectedExpenseId(null)}
          onExpenseUpdated={() => refetch()}
        />
      )}
    </div>
  );
}

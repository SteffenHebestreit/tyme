/**
 * @fileoverview Monthly hours visualization component.
 * 
 * Displays hours worked per day/week for the current month with filtering options
 * by customer/project/task and grouping capabilities.
 * 
 * Features:
 * - Bar chart showing daily or weekly hours for the month
 * - Filter by project/customer/task
 * - Group by project, task, or show total
 * - Toggle between daily and weekly view
 * - Shows month total
 * 
 * @module components/business/time-tracking/MonthlyHoursChart
 */

import { FC, useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { TimeEntry, Project } from '../../../api/types';
import { BarChart3, ChevronDown } from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { getChartColorForDate, prefetchHolidays, holidayDateCache } from '../../../utils/holidays-api';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface MonthlyHoursChartProps {
  /** Time entries for the month */
  timeEntries: TimeEntry[];
  /** Available projects */
  projects: Project[];
}

interface PeriodHours {
  label: string;
  date: string;
  hours: number;
  projectHours: Record<string, number>;
  taskHours: Record<string, number>;
  clientHours: Record<string, number>;
}

type ViewMode = 'daily' | 'weekly';
type GroupMode = 'none' | 'project' | 'task' | 'client';

/**
 * Gets the start and end of the current month in Europe/Berlin timezone.
 */
function getCurrentMonth(): { start: Date; end: Date; startStr: string; endStr: string } {
  // Get current date in Europe/Berlin timezone as YYYY-MM-DD
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
  const today = new Date(todayStr + 'T00:00:00'); // Parse as local date
  
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  
  return { 
    start, 
    end,
    startStr: start.toISOString().split('T')[0],
    endStr: end.toISOString().split('T')[0],
  };
}

/**
 * Gets Monday of the week for a given date.
 */
function getWeekStart(date: Date): Date {
  const dayOfWeek = date.getDay();
  const monday = new Date(date);
  monday.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * Gets project color for chart.
 */
function getProjectChartColor(projectName: string): string {
  const colors = [
    'rgb(59, 130, 246)',   // blue
    'rgb(168, 85, 247)',   // purple
    'rgb(236, 72, 153)',   // pink
    'rgb(99, 102, 241)',   // indigo
    'rgb(6, 182, 212)',    // cyan
    'rgb(20, 184, 166)',   // teal
    'rgb(34, 197, 94)',    // green
    'rgb(163, 230, 53)',   // lime
    'rgb(234, 179, 8)',    // yellow
    'rgb(249, 115, 22)',   // orange
    'rgb(239, 68, 68)',    // red
    'rgb(244, 63, 94)',    // rose
  ];
  
  let hash = 0;
  for (let i = 0; i < projectName.length; i++) {
    hash = projectName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export const MonthlyHoursChart: FC<MonthlyHoursChartProps> = ({
  timeEntries,
  projects,
}) => {
  const { t, i18n } = useTranslation('time-tracking');
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [selectedTask, setSelectedTask] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [groupMode, setGroupMode] = useState<GroupMode>('none');
  const [showFilters, setShowFilters] = useState(false);
  const [holidaysLoaded, setHolidaysLoaded] = useState(false);
  
  // Get localization settings from localStorage
  const region = localStorage.getItem('user_region') || undefined;
  
  // Prefetch holiday data for current year and trigger re-render when loaded
  useEffect(() => {
    const currentYear = new Date().getFullYear();
    prefetchHolidays(currentYear, 'DE').then(() => {
      setHolidaysLoaded(true);
    });
  }, []);
  
  // Get current month range in Europe/Berlin timezone
  const currentMonthRange = useMemo(() => {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    const [year, month, day] = todayStr.split('-').map(Number);
    
    // Create dates in UTC to avoid timezone shifts
    // Month is 0-indexed in JavaScript Date
    const start = new Date(Date.UTC(year, month - 1, 1)); // 1st day of current month
    const end = new Date(Date.UTC(year, month, 0)); // Last day of current month (0th day of next month)
    
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
    };
  }, []);
  
  // Filter entries for current month only
  const monthEntries = useMemo(() => {
    return timeEntries.filter(entry => {
      if (!entry.entry_date) return false;
      const entryDateStr = entry.entry_date.split('T')[0];
      return entryDateStr >= currentMonthRange.start && entryDateStr <= currentMonthRange.end;
    });
  }, [timeEntries, currentMonthRange]);
  
  // Apply filters
  const filteredEntries = useMemo(() => {
    let entries = monthEntries;
    
    if (selectedProject !== 'all') {
      entries = entries.filter(entry => entry.project_id === selectedProject);
    }
    
    if (selectedTask !== 'all') {
      entries = entries.filter(entry => entry.task_name === selectedTask);
    }
    
    return entries;
  }, [monthEntries, selectedProject, selectedTask]);
  
  // Get available tasks for selected project
  const availableTasks = useMemo(() => {
    const entries = selectedProject === 'all' 
      ? monthEntries 
      : monthEntries.filter(e => e.project_id === selectedProject);
    
    return Array.from(
      new Set(entries.map(e => e.task_name).filter(Boolean))
    ).sort();
  }, [monthEntries, selectedProject]);
  
  // Calculate period hours (daily or weekly)
  const periodHours = useMemo((): PeriodHours[] => {
    // Use monthEntries instead of filteredEntries for grouping modes
    const entriesToProcess = groupMode === 'none' ? filteredEntries : monthEntries;
    
    if (viewMode === 'daily') {
      // Daily view - only show days that have actual entries
      const daysMap = new Map<string, PeriodHours>();
      
      entriesToProcess.forEach(entry => {
        if (!entry.entry_date) return;
        
        const dateStr = entry.entry_date.split('T')[0]; // Get YYYY-MM-DD
        
        if (!daysMap.has(dateStr)) {
          const date = new Date(dateStr + 'T00:00:00');
          daysMap.set(dateStr, {
            label: date.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }),
            date: dateStr,
            hours: 0,
            projectHours: {},
            taskHours: {},
            clientHours: {},
          });
        }
        
        const day = daysMap.get(dateStr)!;
        const hours = entry.duration_hours || 0;
        day.hours += hours;
        
        if (entry.project_name) {
          day.projectHours[entry.project_name] = (day.projectHours[entry.project_name] || 0) + hours;
        }
        if (entry.task_name) {
          day.taskHours[entry.task_name] = (day.taskHours[entry.task_name] || 0) + hours;
        }
        if (entry.client_name) {
          day.clientHours[entry.client_name] = (day.clientHours[entry.client_name] || 0) + hours;
        }
      });
      
      return Array.from(daysMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    } else {
      // Weekly view
      const weeksMap = new Map<string, PeriodHours>();
      
      entriesToProcess.forEach(entry => {
        if (!entry.entry_date) return;
        
        const entryDate = new Date(entry.entry_date);
        const weekStart = getWeekStart(entryDate);
        const weekKey = weekStart.toISOString().split('T')[0];
        
        if (!weeksMap.has(weekKey)) {
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          
          weeksMap.set(weekKey, {
            label: `${weekStart.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })} - ${weekEnd.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })}`,
            date: weekKey,
            hours: 0,
            projectHours: {},
            taskHours: {},
            clientHours: {},
          });
        }
        
        const week = weeksMap.get(weekKey)!;
        const hours = entry.duration_hours || 0;
        week.hours += hours;
        
        if (entry.project_name) {
          week.projectHours[entry.project_name] = (week.projectHours[entry.project_name] || 0) + hours;
        }
        if (entry.task_name) {
          week.taskHours[entry.task_name] = (week.taskHours[entry.task_name] || 0) + hours;
        }
        if (entry.client_name) {
          week.clientHours[entry.client_name] = (week.clientHours[entry.client_name] || 0) + hours;
        }
      });
      
      return Array.from(weeksMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
  }, [filteredEntries, monthEntries, groupMode, viewMode, i18n.language]);
  
  const totalMonthHours = useMemo(() => {
    return periodHours.reduce((sum, period) => sum + period.hours, 0);
  }, [periodHours]);
  
  // Prepare chart data
  const chartData = useMemo(() => {
    const labels = periodHours.map(period => period.label);
    
    if (groupMode === 'none') {
      // Simple bar chart - total hours per period
      return {
        labels,
        datasets: [
          {
            label: t('charts.monthlyHours.hoursWorked'),
            data: periodHours.map(period => period.hours),
            backgroundColor: 'rgba(168, 85, 247, 0.8)',
            borderColor: 'rgba(168, 85, 247, 1)',
            borderWidth: 1,
          },
        ],
      };
    }
    
    if (groupMode === 'project') {
      // Stacked bar chart - grouped by project
      const allProjects = Array.from(
        new Set(monthEntries.map(e => e.project_name).filter(Boolean))
      );
      
      const datasets = allProjects.map(projectName => ({
        label: projectName,
        data: periodHours.map(period => period.projectHours[projectName!] || 0),
        backgroundColor: getProjectChartColor(projectName!),
        borderWidth: 0,
      }));
      
      return { labels, datasets };
    }
    
    if (groupMode === 'task') {
      // Stacked bar chart - grouped by task
      const allTasks = Array.from(
        new Set(monthEntries.map(e => e.task_name).filter(Boolean))
      );
      
      const datasets = allTasks.map((taskName, index) => ({
        label: taskName,
        data: periodHours.map(period => period.taskHours[taskName!] || 0),
        backgroundColor: getProjectChartColor(taskName! + index), // Use index for variation
        borderWidth: 0,
      }));
      
      return { labels, datasets };
    }
    
    if (groupMode === 'client') {
      // Stacked bar chart - grouped by client
      const allClients = Array.from(
        new Set(monthEntries.map(e => e.client_name).filter(Boolean))
      );
      
      const datasets = allClients.map((clientName, index) => ({
        label: clientName,
        data: periodHours.map(period => period.clientHours[clientName!] || 0),
        backgroundColor: getProjectChartColor(clientName! + index), // Use index for variation
        borderWidth: 0,
      }));
      
      return { labels, datasets };
    }
    
    return { labels, datasets: [] };
  }, [periodHours, groupMode, monthEntries, t]);
  
  // Memoize chart options with holidaysLoaded dependency to re-render when holidays are fetched
  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: groupMode !== 'none',
        position: 'bottom' as const,
      },
      tooltip: {
        callbacks: {
          label: (context: any) => {
            return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}h`;
          },
          footer: (tooltipItems: any) => {
            const index = tooltipItems[0].dataIndex;
            if (index < periodHours.length) {
              const dateStr = periodHours[index].date;
              const holiday = holidayDateCache.get(dateStr);
              if (holiday) {
                return `\ud83c\udf89 ${holiday.name}`;
              }
            }
            return '';
          },
        },
      },
    },
    scales: {
      x: {
        stacked: groupMode !== 'none',
        grid: {
          display: false,
        },
        ticks: {
          color: function(context: any) {
            const index = context.index;
            if (index < periodHours.length) {
              return getChartColorForDate(periodHours[index].date, 'DE', region).replace('0.8)', '1)');
            }
            return '#6b7280'; // gray-500
          },
          font: {
            weight: 'bold' as const
          }
        }
      },
      y: {
        stacked: groupMode !== 'none',
        beginAtZero: true,
        ticks: {
          callback: (value: any) => `${value}h`,
        },
      },
    },
  }), [groupMode, periodHours, region, holidaysLoaded]);
  
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('charts.monthlyHours.title')}
          </h2>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {totalMonthHours.toFixed(2)}h
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {t('charts.monthlyHours.totalMonth')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <ChevronDown
              className={`h-5 w-5 text-gray-600 transition-transform dark:text-gray-400 ${
                showFilters ? 'rotate-180' : ''
              }`}
            />
          </button>
        </div>
      </div>
      
      {/* Filters */}
      {showFilters && (
        <div className="mb-4 space-y-4 rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
          <div className="flex flex-wrap gap-4">
            {/* View Mode */}
            <div className="flex-1 min-w-[150px]">
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('charts.filters.viewMode')}
              </label>
              <select
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as ViewMode)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="daily">{t('charts.filters.daily')}</option>
                <option value="weekly">{t('charts.filters.weekly')}</option>
              </select>
            </div>
            
            {/* Project Filter */}
            <div className="flex-1 min-w-[200px]">
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('charts.filters.project')}
              </label>
              <select
                value={selectedProject}
                onChange={(e) => {
                  setSelectedProject(e.target.value);
                  setSelectedTask('all'); // Reset task when project changes
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="all">{t('charts.filters.allProjects')}</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Task Filter */}
            <div className="flex-1 min-w-[200px]">
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('charts.filters.task')}
              </label>
              <select
                value={selectedTask}
                onChange={(e) => setSelectedTask(e.target.value)}
                disabled={availableTasks.length === 0}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="all">{t('charts.filters.allTasks')}</option>
                {availableTasks.map(task => (
                  <option key={task} value={task}>
                    {task}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          {/* Group Mode */}
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('charts.filters.grouping')}
              </label>
              <select
                value={groupMode}
                onChange={(e) => setGroupMode(e.target.value as GroupMode)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="none">{t('charts.filters.noGrouping')}</option>
                <option value="client">
                  {t('charts.filters.groupByClient')}
                </option>
                <option value="project">
                  {t('charts.filters.groupByProject')}
                </option>
                <option value="task">
                  {t('charts.filters.groupByTask')}
                </option>
              </select>
            </div>
          </div>
        </div>
      )}
      
      {/* Chart */}
      <div className="h-64">
        {periodHours.length > 0 ? (
          <Bar key={`chart-${holidaysLoaded}`} data={chartData} options={chartOptions} />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
            {t('charts.monthlyHours.noData')}
          </div>
        )}
      </div>
    </div>
  );
};

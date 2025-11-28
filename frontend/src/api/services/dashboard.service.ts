import apiClient from './client';
import {
  Client,
  DashboardData,
  Invoice,
  Project,
  TimeEntry,
} from '../types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function toStartOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function toEndOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function startOfWeek(date: Date): Date {
  const result = toStartOfDay(date);
  const day = result.getDay();
  const diff = (day + 6) % 7; // convert Sunday=0 to Monday-based index
  result.setDate(result.getDate() - diff);
  return result;
}

function endOfWeek(date: Date): Date {
  const start = startOfWeek(date);
  start.setDate(start.getDate() + 6);
  return toEndOfDay(start);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function subMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() - amount, 1, 0, 0, 0, 0);
}

function isWithinInterval(date: Date, interval: { start: Date; end: Date }): boolean {
  return date.getTime() >= interval.start.getTime() && date.getTime() <= interval.end.getTime();
}

function parseISO(dateString: string): Date {
  return new Date(dateString);
}

function isAfter(date: Date, comparison: Date): boolean {
  return date.getTime() >= comparison.getTime();
}

function isBefore(date: Date, comparison: Date): boolean {
  return date.getTime() <= comparison.getTime();
}

function differenceInMinutes(laterDate: Date, earlierDate: Date): number {
  return Math.round((laterDate.getTime() - earlierDate.getTime()) / 60000);
}

function safeParse(dateString: string | null | undefined): Date | null {
  if (!dateString) return null;
  const parsed = parseISO(dateString);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function calculateDurationMinutes(entry: TimeEntry): number {
  if (entry.duration_minutes !== null && entry.duration_minutes !== undefined) {
    return entry.duration_minutes;
  }

  const start = safeParse(entry.start_time);
  const end = safeParse(entry.end_time ?? undefined);

  if (!start || !end) {
    return 0;
  }

  const minutes = differenceInMinutes(end, start);
  return minutes > 0 ? minutes : 0;
}

function computeWeeklyHours(timeEntries: TimeEntry[], now: Date) {
  // Use Europe/Berlin timezone to match WeeklyHoursChart
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
  const [year, month, day] = todayStr.split('-').map(Number);
  const todayUTC = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = todayUTC.getUTCDay();
  
  // Calculate Monday (start of week)
  const mondayUTC = new Date(todayUTC);
  mondayUTC.setUTCDate(todayUTC.getUTCDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  
  // Day names starting from Monday
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
  
  return Array.from({ length: 7 }).map((_, index) => {
    const dayUTC = new Date(mondayUTC);
    dayUTC.setUTCDate(mondayUTC.getUTCDate() + index);
    const dayStr = dayUTC.toISOString().split('T')[0];
    
    const value = timeEntries
      .filter((entry: TimeEntry) => {
        if (!entry.entry_date) return false;
        const entryDateStr = entry.entry_date.split('T')[0];
        return entryDateStr === dayStr;
      })
      .reduce((accumulator: number, entry: TimeEntry) => accumulator + (entry.duration_hours || 0), 0);

    return {
      label: dayNames[index],
      value: Number(value.toFixed(2)),
    };
  });
}

function computeRevenueTrend(invoices: Invoice[], now: Date) {
  return Array.from({ length: 6 }).map((_, index) => {
    const monthDate = subMonths(now, 5 - index);
    const start = startOfMonth(monthDate);
    const end = endOfMonth(monthDate);

    const value = invoices
      .filter((invoice: Invoice) => {
        if (invoice.status !== 'paid') return false;
        const issueDate = safeParse(invoice.issue_date);
        if (!issueDate) return false;
        return isWithinInterval(issueDate, { start, end });
      })
      .reduce((accumulator: number, invoice: Invoice) => accumulator + Number(invoice.total_amount || 0), 0);

    return {
      label: MONTH_NAMES[monthDate.getMonth()],
      value: Number(value.toFixed(2)),
    };
  });
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const [clientsResponse, projectsResponse, invoicesResponse, timeEntriesResponse] = await Promise.all([
    apiClient.get<Client[]>('/clients'),
    apiClient.get<Project[]>('/projects'),
    apiClient.get<Invoice[]>('/invoices'),
    apiClient.get<TimeEntry[]>('/time-entries'),
  ]);

  const clients = clientsResponse.data;
  const projects = projectsResponse.data;
  const invoices = invoicesResponse.data;
  const timeEntries = timeEntriesResponse.data;

  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);

  // Calculate uninvoiced amount: (Total billable hours × rate) - Total invoiced net amount
  // This represents work done but not yet billed
  const currentYear = now.getFullYear();
  const yearStart = new Date(currentYear, 0, 1);
  
  // Calculate revenue for this month and last month (based on billable hours × rates)
  const thisMonthStart = startOfMonth(now);
  const thisMonthEnd = now; // Up to today, not end of month
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const lastMonthEnd = endOfMonth(subMonths(now, 1));
  
  const MONTH_NAMES_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  
  const revenueThisMonth = Number(
    timeEntries
      .filter((entry: TimeEntry) => {
        if (!entry.billable) return false;
        const entryDate = safeParse(entry.entry_date);
        if (!entryDate) return false;
        return entryDate >= thisMonthStart && entryDate <= thisMonthEnd;
      })
      .reduce((sum: number, entry: TimeEntry) => {
        const hours = entry.duration_hours || 0;
        const rate = entry.hourly_rate || 0;
        return sum + (hours * rate);
      }, 0)
      .toFixed(2)
  );
  
  const revenueLastMonth = Number(
    timeEntries
      .filter((entry: TimeEntry) => {
        if (!entry.billable) return false;
        const entryDate = safeParse(entry.entry_date);
        if (!entryDate) return false;
        return entryDate >= lastMonthStart && entryDate <= lastMonthEnd;
      })
      .reduce((sum: number, entry: TimeEntry) => {
        const hours = entry.duration_hours || 0;
        const rate = entry.hourly_rate || 0;
        return sum + (hours * rate);
      }, 0)
      .toFixed(2)
  );
  
  const thisMonthLabel = MONTH_NAMES_DE[now.getMonth()];
  const lastMonthLabel = MONTH_NAMES_DE[subMonths(now, 1).getMonth()];

  // Calculate week range as ISO date strings (Monday to Sunday) in Europe/Berlin timezone
  // This matches the WeeklyHoursChart calculation exactly
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
  const [year, month, day] = todayStr.split('-').map(Number);
  const todayUTC = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = todayUTC.getUTCDay();
  
  // Calculate Monday (start of week)
  const mondayUTC = new Date(todayUTC);
  mondayUTC.setUTCDate(todayUTC.getUTCDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  
  // Calculate Sunday (end of week)
  const sundayUTC = new Date(mondayUTC);
  sundayUTC.setUTCDate(mondayUTC.getUTCDate() + 6);
  
  const weekStartStr = mondayUTC.toISOString().split('T')[0];
  const weekEndStr = sundayUTC.toISOString().split('T')[0];

  const metrics = {
    activeProjects: projects.filter((project: Project) => project.status === 'active').length,
    activeClients: clients.filter((client: Client) => client.status === 'active').length,
    hoursThisWeek: Number(
      timeEntries
        .filter((entry: TimeEntry) => {
          if (!entry.entry_date) return false;
          const entryDateStr = entry.entry_date.split('T')[0];
          return entryDateStr >= weekStartStr && entryDateStr <= weekEndStr;
        })
        .reduce((accumulator: number, entry: TimeEntry) => accumulator + (entry.duration_hours || 0), 0)
        .toFixed(2)
    ),
    outstandingInvoiceCount: invoices.filter(
      (invoice: Invoice) => invoice.status !== 'paid' && invoice.status !== 'cancelled'
    ).length,
    outstandingInvoiceTotal: Number(
      invoices
        .filter((invoice: Invoice) => invoice.status !== 'paid' && invoice.status !== 'cancelled')
        .reduce((accumulator: number, invoice: Invoice) => accumulator + Number(invoice.total_amount || 0), 0)
        .toFixed(2)
    ),
    revenueThisMonth,
    revenueLastMonth,
    thisMonthLabel,
    lastMonthLabel,
  };

  const weeklyHours = computeWeeklyHours(timeEntries, now);
  const revenueTrend = computeRevenueTrend(invoices, now);

  const recentTimeEntries = [...timeEntries]
    .sort((a: TimeEntry, b: TimeEntry) => {
      const aDate = safeParse(a.start_time);
      const bDate = safeParse(b.start_time);
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return bDate.getTime() - aDate.getTime();
    })
    .slice(0, 5);

  const recentInvoices = [...invoices]
    .sort((a: Invoice, b: Invoice) => {
      const aDate = safeParse(a.updated_at || a.issue_date);
      const bDate = safeParse(b.updated_at || b.issue_date);
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return bDate.getTime() - aDate.getTime();
    })
    .slice(0, 5);

  return {
    metrics,
    weeklyHours,
    revenueTrend,
    recentTimeEntries,
    recentInvoices,
  };
}

import { FC, useMemo } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Project, ProjectStatus } from '../../../api/types';
import { Button } from '../../common/Button';
import { getCurrencySymbol } from '../../../utils/currency';
import clsx from 'clsx';
import { Table, Column } from '../../common/Table';

/**
 * Props for the ProjectTable component.
 * 
 * @interface ProjectTableProps
 * @property {Project[]} projects - Array of projects to display
 * @property {(project: Project) => void} onEdit - Callback when edit button is clicked
 * @property {(project: Project) => void} onManageRates - Callback when the rate timeline button is clicked
 * @property {(project: Project) => void} onDelete - Callback when delete button is clicked
 * @property {string | null} [isDeletingId] - ID of project currently being deleted (shows loading state)
 */
interface ProjectTableProps {
  projects: Project[];
  onEdit: (project: Project) => void;
  onManageRates: (project: Project) => void;
  onDelete: (project: Project) => void;
  isDeletingId?: string | null;
}

/**
 * Status display labels.
 * @constant
 */
const getStatusLabel = (t: (key: string) => string, status: ProjectStatus): string => {
  const labels: Record<ProjectStatus, string> = {
    not_started: t('status.notStarted'),
    active: t('status.active'),
    on_hold: t('status.onHold'),
    completed: t('status.completed'),
  };
  return labels[status];
};

const statusClasses: Record<ProjectStatus, string> = {
  not_started: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
  active: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  on_hold: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
};

const formatDate = (iso: string | null) => {
  if (!iso) {
    return '—';
  }
  try {
    return format(new Date(iso), 'MMM d, yyyy');
  } catch (error) {
    return iso;
  }
};

const formatCurrency = (value: number | null, currency: string = 'USD') => {
  if (value === null || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency,
    maximumFractionDigits: 0,
  }).format(value);
};

/**
 * Project table component displaying projects with sortable columns.
 * 
 * Features:
 * - 7 columns: Project (name + description), Client, Status, Timeline (start/end dates), Budget, Tracked hours, Actions
 * - Color-coded status badges (not_started: yellow, active: green, on_hold: orange, completed: blue)
 * - Currency formatting for budget
 * - Date formatting (MMM d, yyyy)
 * - Hover effects on rows
 * - Edit, Rates (date-effective hourly rate timeline) and Delete action buttons
 * - Loading state for delete button (shows "Deleting..." when isDeletingId matches)
 * - Dark mode support
 * - Responsive horizontal scroll
 * 
 * Budget displays either hourly rate or fixed fee amount based on rate_type.
 * Tracked hours shows total_hours_tracked field.
 * 
 * @component
 * @example
 * <ProjectTable
 *   projects={filteredProjects}
 *   onEdit={handleEdit}
 *   onManageRates={openRatesModal}
 *   onDelete={handleDelete}
 *   isDeletingId={deletingProjectId}
 * />
 * 
 * @param {ProjectTableProps} props - Component props
 * @returns {JSX.Element} Table of projects with actions
 */
export const ProjectTable: FC<ProjectTableProps> = ({ projects, onEdit, onManageRates, onDelete, isDeletingId }) => {
  const { t } = useTranslation('projects');

  const columns: Column<Project>[] = useMemo(() => [
    {
      key: 'project',
      accessorKey: 'name',
      header: t('table.project'),
      render: (project) => (
        <>
          <div className="font-medium text-gray-900 dark:text-white">{project.name}</div>
          {project.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{project.description}</p>
          ) : null}
        </>
      ),
      sortable: true,
    },
    {
      key: 'client',
      accessorKey: 'client_name',
      header: t('table.client'),
      render: (project) => (
        <div className="text-gray-700 dark:text-gray-300">
          {project.client_name ?? '—'}
        </div>
      ),
      sortable: true,
    },
    {
      key: 'status',
      accessorKey: 'status',
      header: t('table.status'),
      render: (project) => (
        <span className={clsx('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', statusClasses[project.status])}>
          {getStatusLabel(t, project.status)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'timeline',
      accessorKey: 'start_date',
      header: t('table.timeline'),
      render: (project) => (
        <div className="flex flex-col text-gray-600 dark:text-gray-400">
          <span>{t('table.start')}: {formatDate(project.start_date)}</span>
          <span>{t('table.due')}: {formatDate(project.end_date)}</span>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'budget',
      accessorKey: 'budget',
      header: t('table.budget'),
      render: (project) => (
        <div className="flex flex-col text-gray-900 dark:text-gray-100">
          <span className="font-medium">{formatCurrency(project.budget, project.currency || 'USD')}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t('table.rate')}: {project.hourly_rate != null 
              ? `${getCurrencySymbol(project.currency || 'USD')}${typeof project.hourly_rate === 'string' ? parseFloat(project.hourly_rate).toFixed(2) : project.hourly_rate.toFixed(2)}/hr`
              : '—'}
          </span>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'trackedHours',
      accessorKey: 'total_tracked_hours',
      header: t('table.trackedHours'),
      render: (project) => (
        <div className="text-gray-700 dark:text-gray-300">
          {project.total_tracked_hours != null ? `${project.total_tracked_hours.toFixed(1)}h` : '—'}
        </div>
      ),
      sortable: true,
    },
    {
      key: 'actions',
      header: t('table.actions'),
      align: 'right',
      render: (project) => (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onEdit(project)}
          >
            {t('edit')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onManageRates(project)}
          >
            {t('rates.manage')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="danger"
            onClick={() => onDelete(project)}
            disabled={isDeletingId === project.id}
          >
            {isDeletingId === project.id ? t('deleting') : t('delete')}
          </Button>
        </div>
      ),
    },
  ], [t, onEdit, onManageRates, onDelete, isDeletingId]);
  
  return <Table data={projects} columns={columns} pageSize={10} />;
};

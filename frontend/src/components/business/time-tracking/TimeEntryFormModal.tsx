/**
 * @fileoverview Time entry form modal component for logging and editing time entries.
 * 
 * Provides a comprehensive form interface for time tracking with automatic duration calculation,
 * project selection, billable toggle, and hourly rate management. Uses single date with
 * separate start/end times for better UX.
 * 
 * Features:
 * - Project selection with automatic hourly rate pre-fill
 * - Single date picker + start/end time inputs
 * - Automatic duration calculation in hours
 * - Manual duration override capability
 * - Billable toggle with hourly rate input
 * - Task name, category, and description fields
 * 
 * @module components/business/time-tracking/TimeEntryFormModal
 */

import { FC, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Alert } from '../../common/Alert';
import { Button } from '../../common/Button';
import { Input } from '../../forms/Input';
import { Select } from '../../forms/Select';
import { Textarea } from '../../forms/Textarea';
import { Modal } from '../../ui/Modal';
import { Project, TimeEntry, TimeEntryPayload, Client } from '../../../api/types';
import { TimeSlotPicker } from './TimeSlotPicker';
import { fetchTimeEntries, checkTimeEntryOverlap } from '../../../api/services/timeEntry.service';
import { getEffectiveRate } from '../../../api/services/project-rate.service';
import { Calendar } from 'lucide-react';

/**
 * Props for the TimeEntryFormModal component.
 * 
 * @interface TimeEntryFormModalProps
 * @property {boolean} open - Whether the modal is currently visible
 * @property {'create' | 'edit'} mode - Form mode determining behavior and title
 * @property {Project[]} projects - Available projects for the project dropdown
 * @property {TimeEntry | null} [initialEntry] - Time entry data for edit mode (null for create mode)
 * @property {string} [defaultProjectId] - Default project ID to pre-select in create mode
 * @property {(payload: TimeEntryPayload) => Promise<void>} onSubmit - Async handler for form submission
 * @property {() => void} onClose - Handler for modal close (cancel button or backdrop click)
 * @property {boolean} isSubmitting - Loading state during form submission
 * @property {string | null} [error] - Error message to display above the form
 */
interface TimeEntryFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  projects: Project[];
  clients: Client[];
  clientFilter: string;
  onClientFilterChange: (value: string) => void;
  initialEntry?: TimeEntry | null;
  defaultProjectId?: string;
  onSubmit: (payload: TimeEntryPayload) => Promise<void>;
  onClose: () => void;
  isSubmitting: boolean;
  error?: string | null;
}

/**
 * Internal form values interface for react-hook-form.
 * Uses single date with separate start/end times for better UX.
 * 
 * @interface FormValues
 * @property {string} project_id - ID of the selected project (required)
 * @property {string} task_name - Name/title of the task
 * @property {string} description - Detailed description of work performed
 * @property {string} category - Category/type of work (e.g., Development, QA)
 * @property {string} entry_date - Date of work in YYYY-MM-DD format
 * @property {string} start_time - Start time in HH:mm format (24-hour)
 * @property {string} end_time - End time in HH:mm format (24-hour)
 * @property {boolean} billable - Whether this time is billable to the client
 * @property {string} hourly_rate - Hourly rate as string for input field
 * @property {string} duration_hours - Duration in hours as string (can be decimal, e.g., "2.5")
 */
interface FormValues {
  project_id: string;
  task_name: string;
  description: string;
  category: string;
  entry_date: string;
  start_time: string;
  end_time: string;
  billable: boolean;
  hourly_rate: string;
  duration_hours: string;
}

/**
 * Default form values for time entry creation.
 * 
 * @constant
 * @type {FormValues}
 */
const DEFAULT_VALUES: FormValues = {
  project_id: '',
  task_name: '',
  description: '',
  category: '',
  entry_date: '',
  start_time: '',
  end_time: '',
  billable: true,
  hourly_rate: '',
  duration_hours: '',
};

/**
 * Unique form ID for associating the submit button with the form element.
 * Allows submit button to be placed in modal footer outside the form.
 * 
 * @constant
 */
const formId = 'time-entry-form-modal';

/**
 * Modal form component for logging and editing time entries.
 * 
 * Provides a comprehensive form interface with automatic duration calculation and validation.
 * Handles both manual time entry logging and editing of existing entries with proper
 * initialization and validation.
 * 
 * Form Fields:
 * - **Project** (required): Dropdown of available projects
 * - **Task name** (optional): Short task title
 * - **Category** (optional): Work type (Research, Development, QA, etc.)
 * - **Description** (optional): Detailed notes about the work (textarea)
 * - **Date** (required): Single date picker
 * - **Start time** (required): Time picker (HH:mm)
 * - **End time** (optional): Time picker (HH:mm)
 * - **Duration** (required): Hours with auto-calculation from start/end time
 * - **Hourly rate** (optional): Auto-filled from project, overridable
 * - **Billable** (default: true): Checkbox for billable status
 * 
 * Auto-calculation Logic:
 * 1. When project is selected: auto-fills hourly_rate from project.hourly_rate
 * 2. When start_time and end_time are provided: auto-calculates duration_hours
 * 3. Duration can be manually overridden (e.g., to account for breaks)
 * 4. Only auto-calculates if duration field is empty (not manually set)
 * 
 * Validation Rules:
 * - Project is required
 * - Start time is required and must be valid
 * - End time must be after start time if provided
 * - End time must be valid if provided
 * - Duration must be greater than zero if provided
 * - Hourly rate must be zero or higher if provided
 * - Optional fields trim whitespace and omit if empty
 * 
 * Special Features:
 * - Shows warning when no projects exist and disables form
 * - Pre-fills defaultProjectId in create mode for quick logging
 * - Formats datetime values for datetime-local inputs
 * - Resets form when modal opens
 * - Clears errors when modal opens
 * 
 * @component
 * @example
 * // Create new time entry with default project
 * <TimeEntryFormModal
 *   open={isCreateModalOpen}
 *   mode="create"
 *   projects={projects}
 *   defaultProjectId={currentProjectId}
 *   onSubmit={async (payload) => {
 *     await createTimeEntryMutation.mutateAsync(payload);
 *     setIsCreateModalOpen(false);
 *   }}
 *   onClose={() => setIsCreateModalOpen(false)}
 *   isSubmitting={createTimeEntryMutation.isPending}
 *   error={createTimeEntryMutation.error?.message}
 * />
 * 
 * @example
 * // Edit existing time entry
 * <TimeEntryFormModal
 *   open={isEditModalOpen}
 *   mode="edit"
 *   projects={projects}
 *   initialEntry={selectedEntry}
 *   onSubmit={async (payload) => {
 *     await updateTimeEntryMutation.mutateAsync({
 *       id: selectedEntry.id,
 *       ...payload
 *     });
 *     setIsEditModalOpen(false);
 *   }}
 *   onClose={() => setIsEditModalOpen(false)}
 *   isSubmitting={updateTimeEntryMutation.isPending}
 *   error={updateTimeEntryMutation.error?.message}
 * />
 * 
 * @param {TimeEntryFormModalProps} props - Component props
 * @returns {JSX.Element} Time entry form modal component
 */
export const TimeEntryFormModal: FC<TimeEntryFormModalProps> = ({
  open,
  mode,
  projects,
  clients,
  clientFilter,
  onClientFilterChange,
  initialEntry,
  defaultProjectId,
  onSubmit,
  onClose,
  isSubmitting,
  error,
}) => {
  const { t } = useTranslation('time-tracking');
  const hasProjects = projects.length > 0;
  const [showTimeSlotPicker, setShowTimeSlotPicker] = useState(false);

  const initialValues = useMemo<FormValues>(() => {
    if (!initialEntry) {
      // For create mode, set default date to today and use current time as-is (no rounding)
      const now = new Date();
      
      const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; // HH:mm
      
      // Get hourly rate from default project if available
      const defaultProject = projects.find(p => p.id === defaultProjectId);
      const hourlyRate = defaultProject?.hourly_rate ? String(defaultProject.hourly_rate) : '';
      
      return {
        ...DEFAULT_VALUES,
        project_id: defaultProjectId ?? DEFAULT_VALUES.project_id,
        entry_date: dateStr,
        start_time: timeStr,
        hourly_rate: hourlyRate,
      };
    }
    
    // Edit mode - extract date and time from entry
    let entryDate = '';
    let startTime = '';
    let endTime = '';
    
    if (initialEntry.entry_date) {
      // New format: use entry_date, entry_time, and entry_end_time
      entryDate = typeof initialEntry.entry_date === 'string' 
        ? initialEntry.entry_date.split('T')[0]  
        : new Date(initialEntry.entry_date).toISOString().split('T')[0];
      startTime = initialEntry.entry_time ? initialEntry.entry_time.slice(0, 5) : '';
      endTime = initialEntry.entry_end_time ? initialEntry.entry_end_time.slice(0, 5) : '';

      // Derive end time from start + duration when entry_end_time is not stored
      if (!endTime && startTime && initialEntry.duration_hours) {
        const [h, m] = startTime.split(':').map(Number);
        const endMinutes = h * 60 + m + Math.round(initialEntry.duration_hours * 60);
        const endH = Math.floor(endMinutes / 60) % 24;
        const endM = endMinutes % 60;
        endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
      }
    } else if (initialEntry.start_time) {
      // Legacy format: extract from start_time timestamp
      const startDate = new Date(initialEntry.start_time);
      entryDate = startDate.toISOString().split('T')[0];
      startTime = `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`;
      
      if (initialEntry.end_time) {
        const endDate = new Date(initialEntry.end_time);
        endTime = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
      }
    }
    
    // Get hourly rate from entry or project
    let hourlyRate = '';
    if (initialEntry.hourly_rate) {
      hourlyRate = String(initialEntry.hourly_rate);
    } else {
      const entryProject = projects.find(p => p.id === initialEntry.project_id);
      if (entryProject?.hourly_rate) {
        hourlyRate = String(entryProject.hourly_rate);
      }
    }
    
    return {
      project_id: initialEntry.project_id,
      task_name: initialEntry.task_name ?? '',
      description: initialEntry.description ?? '',
      category: initialEntry.category ?? '',
      entry_date: entryDate,
      start_time: startTime,
      end_time: endTime,
      billable: initialEntry.billable,
      hourly_rate: hourlyRate,
      duration_hours: initialEntry.duration_hours ? String(initialEntry.duration_hours) : '',
    };
  }, [defaultProjectId, initialEntry, projects]);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    watch,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm<FormValues>({
    defaultValues: initialValues,
  });

  // Watch time fields to auto-calculate duration
  // Mirrors dirtyFields so an async rate lookup can check it at apply time
  // without re-running the effect on every keystroke.
  const dirtyFieldsRef = useRef(dirtyFields);
  dirtyFieldsRef.current = dirtyFields;

  const watchStartTime = watch('start_time');
  const watchEndTime = watch('end_time');
  const watchDuration = watch('duration_hours');
  const watchProjectId = watch('project_id');
  const watchEntryDate = watch('entry_date');

  // Fetch existing time entries for the selected date
  const { data: dayTimeEntries = [] } = useQuery({
    queryKey: ['time-entries-day', watchEntryDate],
    queryFn: () => watchEntryDate
      ? fetchTimeEntries({
          start_date: watchEntryDate,
          end_date: watchEntryDate
        })
      : Promise.resolve([]),
    enabled: !!watchEntryDate && open,
  });

  // Non-blocking overlap check: warns when the proposed slot collides with an existing entry
  const overlapEnabled = Boolean(
    open && watchEntryDate && watchStartTime && (watchEndTime || watchDuration)
  );
  const { data: overlapResult } = useQuery({
    queryKey: ['time-entry-overlap', watchEntryDate, watchStartTime, watchEndTime, watchDuration, initialEntry?.id],
    queryFn: () =>
      checkTimeEntryOverlap({
        entry_date: watchEntryDate,
        entry_time: watchStartTime,
        entry_end_time: watchEndTime || undefined,
        duration_hours: !watchEndTime && watchDuration ? Number(watchDuration) : undefined,
        exclude_id: initialEntry?.id,
      }),
    enabled: overlapEnabled,
    retry: false,
  });

  // Auto-calculate duration when start/end times change
  // Supports cross-midnight entries: when end < start the entry spans to the next day
  useEffect(() => {
    if (watchStartTime && watchEndTime) {
      const [startHour, startMin] = watchStartTime.split(':').map(Number);
      const [endHour, endMin] = watchEndTime.split(':').map(Number);

      if (isNaN(startHour) || isNaN(startMin) || isNaN(endHour) || isNaN(endMin)) {
        return;
      }

      const startMinutes = startHour * 60 + startMin;
      let endMinutes = endHour * 60 + endMin;

      // Cross-midnight: add 24 h to end time
      if (endMinutes < startMinutes) {
        endMinutes += 24 * 60;
      }

      if (endMinutes > startMinutes) {
        const durationMinutes = endMinutes - startMinutes;
        const durationHours = (durationMinutes / 60).toFixed(2);

        if (watchDuration !== durationHours) {
          setValue('duration_hours', durationHours);
        }
      }
    }
  }, [watchStartTime, watchEndTime, setValue]);

  /**
   * Auto-fill the hourly rate from the project's rate timeline.
   *
   * Uses the rate effective on the ENTRY's date, not the project's current
   * rate: logging yesterday's work after a rate rise must bill at the old rate.
   * Prefilling project.hourly_rate would submit today's rate explicitly and
   * override the date-effective rate the backend would otherwise stamp.
   *
   * Falls back to the project's current rate only when the lookup fails, so a
   * network hiccup degrades to the old behaviour rather than an empty field.
   */
  useEffect(() => {
    if (!watchProjectId) return;

    // Never overwrite a rate the user typed themselves. dirtyFields is checked
    // at apply time rather than in the dependency list, so a rate edited while
    // the request is still in flight also survives — the response can arrive
    // after the keystroke.
    let cancelled = false;

    const apply = (value: string) => {
      if (cancelled || dirtyFieldsRef.current.hourly_rate) return;
      setValue('hourly_rate', value);
    };

    getEffectiveRate(watchProjectId, watchEntryDate || undefined)
      .then(result => {
        if (result.hourly_rate !== null && result.hourly_rate !== undefined) {
          apply(String(result.hourly_rate));
        } else {
          // No rate agreed for that date — leave it to the user rather than
          // inventing one.
          apply('');
        }
      })
      .catch(() => {
        // Degrade to the project's current rate rather than an empty field.
        const selectedProject = projects.find(p => p.id === watchProjectId);
        if (selectedProject?.hourly_rate) apply(String(selectedProject.hourly_rate));
      });

    return () => {
      cancelled = true;
    };
  }, [watchProjectId, watchEntryDate, projects, setValue]);

  useEffect(() => {
    if (open) {
      reset(initialValues);
      clearErrors();
    }
  }, [clearErrors, initialValues, open, reset]);

  const handleFormSubmit = async (values: FormValues) => {
    if (!values.project_id) {
      setError('project_id', { type: 'required', message: t('form.project.required') });
      return;
    }

    if (!values.entry_date) {
      setError('entry_date', { type: 'required', message: t('form.date.required') });
      return;
    }

    if (!values.start_time) {
      setError('start_time', { type: 'required', message: t('form.startTime.required') });
      return;
    }

    if (!values.duration_hours) {
      setError('duration_hours', { type: 'required', message: t('form.duration.required') });
      return;
    }

    // Validate duration
    const durationHours = Number(values.duration_hours);
    if (Number.isNaN(durationHours) || durationHours <= 0) {
      setError('duration_hours', { type: 'validate', message: t('form.duration.validation.positive') });
      return;
    }

    // Validate end time if provided (cross-midnight entries are valid)
    if (values.end_time) {
      const [startHour, startMin] = values.start_time.split(':').map(Number);
      const [endHour, endMin] = values.end_time.split(':').map(Number);

      const startMinutes = startHour * 60 + startMin;
      let endMinutes = endHour * 60 + endMin;

      // Allow cross-midnight: treat end < start as next-day end
      if (endMinutes < startMinutes) {
        endMinutes += 24 * 60;
      }

      if (endMinutes === startMinutes) {
        setError('end_time', { type: 'validate', message: t('form.endTime.validation.afterStart') });
        return;
      }
    }

    const payload: TimeEntryPayload = {
      project_id: values.project_id,
      task_name: values.task_name.trim() ? values.task_name.trim() : undefined,
      description: values.description.trim() || '',
      category: values.category.trim() ? values.category.trim() : undefined,
      entry_date: values.entry_date, // Already in YYYY-MM-DD format
      entry_time: values.start_time, // HH:mm format
      entry_end_time: values.end_time || undefined, // HH:mm format, optional
      duration_hours: durationHours,
      billable: values.billable,
      hourly_rate: values.hourly_rate ? Number(values.hourly_rate) : undefined,
    };

    await onSubmit(payload);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? t('form.modal.title.create') : t('form.modal.title.edit')}
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={isSubmitting || !hasProjects}>
            {isSubmitting ? t('saving') : mode === 'create' ? t('form.modal.submit.create') : t('form.modal.submit.edit')}
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-5" onSubmit={handleSubmit(handleFormSubmit)}>
        {error ? <Alert type="error" message={error} /> : null}
        {!hasProjects ? (
          <Alert
            type="warning"
            message={t('form.modal.noProjects')}
          />
        ) : null}

        <Select
          label={t('filters.client')}
          disabled={!hasProjects}
          value={clientFilter}
          onChange={(e) => onClientFilterChange(e.target.value)}
        >
          <option value="">{t('filters.allClients')}</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </Select>

        <Select
          label={t('form.project.label')}
          disabled={!hasProjects}
          {...register('project_id', { required: t('form.project.required') })}
          error={errors.project_id?.message}
        >
          <option value="">{t('form.project.placeholder')}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.client?.name 
                ? `${project.name} (${project.client.name})`
                : project.name}
            </option>
          ))}
        </Select>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="time-entry-task"
            label={t('form.taskName.label')}
            placeholder={t('form.taskName.placeholder')}
            {...register('task_name')}
            error={errors.task_name?.message}
          />
          <Input
            id="time-entry-category"
            label={t('form.category.label')}
            placeholder={t('form.category.placeholder')}
            {...register('category')}
            error={errors.category?.message}
          />
        </div>

        <Textarea
          label={t('form.description.label')}
          rows={3}
          placeholder={t('form.description.placeholder')}
          {...register('description')}
          error={errors.description?.message}
        />

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              id="time-entry-date"
              label={t('form.date.label')}
              type="date"
              {...register('entry_date', { required: t('form.date.required') })}
              error={errors.entry_date?.message}
            />
            <Input
              id="time-entry-start"
              label={t('form.startTime.label')}
              type="time"
              {...register('start_time', { required: t('form.startTime.required') })}
              error={errors.start_time?.message}
            />
            <Input
              id="time-entry-end"
              label={t('form.endTime.label')}
              type="time"
              {...register('end_time')}
              error={errors.end_time?.message}
            />
          </div>

          {/* Toggle for Time Slot Picker */}
          {watchEntryDate && (
            <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
              <button
                type="button"
                onClick={() => setShowTimeSlotPicker(!showTimeSlotPicker)}
                className="flex items-center gap-2 text-sm text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 transition-colors"
              >
                <Calendar className="h-4 w-4" />
                {showTimeSlotPicker 
                  ? t('form.timeSlotPicker.hide')
                  : t('form.timeSlotPicker.show')}
              </button>
              {showTimeSlotPicker && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t('form.timeSlotPicker.clickToSelect')}
                </span>
              )}
            </div>
          )}

          {/* Time Slot Picker */}
          {showTimeSlotPicker && watchEntryDate && (
            <TimeSlotPicker
              selectedDate={watchEntryDate}
              timeEntries={dayTimeEntries}
              projects={projects}
              startTime={watchStartTime}
              endTime={watchEndTime}
              onStartTimeChange={(time) => setValue('start_time', time)}
              onEndTimeChange={(time) => setValue('end_time', time)}
            />
          )}

          {/* Non-blocking overlap warning */}
          {overlapResult?.hasOverlap && (
            <Alert
              type="warning"
              message={t('form.overlap.warning', {
                count: overlapResult.overlaps.length,
                defaultValue:
                  'This time range overlaps {{count}} existing entry/entries: ' +
                  overlapResult.overlaps
                    .map((o) => `${(o.entry_time || '').slice(0, 5)}${o.project_name ? ' · ' + o.project_name : ''}`)
                    .join(', '),
              })}
            />
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            id="time-entry-duration"
            label={t('form.duration.label')}
            type="number"
            min="0.01"
            step="0.01"
            placeholder={t('form.duration.placeholder')}
            {...register('duration_hours', { required: t('form.duration.required') })}
            error={errors.duration_hours?.message}
          />
          <Input
            id="time-entry-rate"
            label={t('form.hourlyRate.label')}
            type="number"
            min="0"
            step="0.01"
            placeholder={t('form.hourlyRate.placeholder')}
            {...register('hourly_rate', {
              min: { value: 0, message: t('form.hourlyRate.validation.min') },
            })}
            error={errors.hourly_rate?.message}
          />
          <label className="flex items-center gap-3 text-sm font-medium text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-600 dark:border-gray-400 text-purple-600 focus:ring-2 focus:ring-purple-500 focus:ring-offset-0 bg-transparent"
              {...register('billable')}
            />
            {t('form.billable.label')}
          </label>
        </div>
      </form>
    </Modal>
  );
};

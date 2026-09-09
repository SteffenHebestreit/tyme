import { FC, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { format, parseISO, subDays } from 'date-fns';
import clsx from 'clsx';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/forms';
import { Modal } from '@/components/ui/Modal';
import { Project } from '@/api/types';
import { formatCurrency } from '@/utils/currency';
import type {
  ProjectRatePayload,
  ProjectRatePeriod,
  ProjectRateUpdatePayload,
} from '@/api/services/project-rate.service';

/**
 * Modal showing a project's hourly rate as a timeline of periods.
 *
 * **Why a timeline:** a rate is not one number but a sequence of periods. Adding
 * "150 € from 2026-01-01" schedules a raise without re-pricing work that was
 * already logged — time entries keep the rate they were stamped with. The modal
 * says so explicitly, because that is the fear that stops people from editing rates.
 *
 * **Features:**
 * - Table of periods (valid from / valid until / rate / note / actions), oldest first
 * - Badge on the period covering today, distinct styling for future-dated periods
 * - Inline add form, switching into an edit form when a row's Edit is pressed
 * - Empty state inviting the first rate for projects that never had one
 * - Dark mode support
 *
 * Presentational only: the parent owns the mutations plus the error and success state.
 *
 * @component
 * @example
 * <ProjectRatesModal
 *   open={isRatesModalOpen}
 *   project={ratesProject}
 *   rates={rates}
 *   isLoading={isLoadingRates}
 *   onSubmit={handleRateSubmit}
 *   onDelete={handleRateDelete}
 *   onClose={closeRatesModal}
 *   isSubmitting={isSavingRate}
 *   error={rateFormError}
 * />
 */

/**
 * Props for the ProjectRatesModal component.
 *
 * @interface ProjectRatesModalProps
 * @property {boolean} open - Whether the modal is visible
 * @property {Project | null} project - The project whose rate timeline is shown
 * @property {ProjectRatePeriod[]} rates - Rate periods, oldest first
 * @property {boolean} isLoading - Whether the timeline is still loading
 * @property {string | null} [loadError] - Error message for a failed timeline load
 * @property {(payload, rateId?) => Promise<boolean>} onSubmit - Adds a period, or updates the one identified by rateId; resolves true when stored
 * @property {(rate: ProjectRatePeriod) => Promise<void>} onDelete - Removes a period
 * @property {() => void} onClose - Callback when the modal should close
 * @property {boolean} isSubmitting - Whether an add/update is in flight
 * @property {string | null} [deletingRateId] - Id of the period currently being deleted
 * @property {string | null} [error] - Error message for the add/update form
 */
interface ProjectRatesModalProps {
  open: boolean;
  project: Project | null;
  rates: ProjectRatePeriod[];
  isLoading: boolean;
  loadError?: string | null;
  onSubmit: (payload: ProjectRatePayload | ProjectRateUpdatePayload, rateId?: string) => Promise<boolean>;
  onDelete: (rate: ProjectRatePeriod) => Promise<void>;
  onClose: () => void;
  isSubmitting: boolean;
  deletingRateId?: string | null;
  error?: string | null;
}

/**
 * Internal form values. All strings, converted in the submit handler.
 *
 * @interface FormValues
 */
interface FormValues {
  hourly_rate: string;
  valid_from: string;
  note: string;
}

/**
 * Unique form ID for linking the submit button to the form.
 *
 * @constant
 */
const formId = 'project-rate-form';

/**
 * Today as `YYYY-MM-DD` in local time, used both as the add form's default start
 * date and to tell past periods from scheduled ones.
 *
 * @returns {string} Today's date
 */
function today(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Formats a `YYYY-MM-DD` string for display. Parsed with `parseISO` so a
 * date-only value stays on its own day regardless of the viewer's time zone.
 *
 * @param {string | null} value - Date string or null
 * @returns {string} Formatted date, or an em dash when absent
 */
function formatDay(value: string | null): string {
  if (!value) {
    return '—';
  }
  try {
    return format(parseISO(value), 'MMM d, yyyy');
  } catch (error) {
    return value;
  }
}

/**
 * Renders a period's end. `valid_until` is exclusive (it is the next period's
 * start), so the last day the rate actually applies is the day before.
 *
 * @param {string | null} validUntil - Exclusive end of the period
 * @param {string} openLabel - Label for the open-ended latest period
 * @returns {string} Inclusive last day, or the open-ended label
 */
function formatPeriodEnd(validUntil: string | null, openLabel: string): string {
  if (!validUntil) {
    return openLabel;
  }
  try {
    return format(subDays(parseISO(validUntil), 1), 'MMM d, yyyy');
  } catch (error) {
    return validUntil;
  }
}

export const ProjectRatesModal: FC<ProjectRatesModalProps> = ({
  open,
  project,
  rates,
  isLoading,
  loadError,
  onSubmit,
  onDelete,
  onClose,
  isSubmitting,
  deletingRateId,
  error,
}) => {
  const { t } = useTranslation('projects');
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const currency = project?.currency || 'EUR';

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { hourly_rate: '', valid_from: today(), note: '' },
  });

  // Reopening the modal for another project must not carry the previous
  // project's draft (or edit mode) over.
  useEffect(() => {
    if (open) {
      setEditingRateId(null);
      reset({ hourly_rate: '', valid_from: today(), note: '' });
    }
  }, [open, project?.id, reset]);

  const startEdit = (rate: ProjectRatePeriod) => {
    setEditingRateId(rate.id);
    reset({
      hourly_rate: String(rate.hourly_rate),
      valid_from: rate.valid_from,
      note: rate.note ?? '',
    });
  };

  const cancelEdit = () => {
    setEditingRateId(null);
    reset({ hourly_rate: '', valid_from: today(), note: '' });
  };

  const handleFormSubmit = async (values: FormValues) => {
    const note = values.note.trim();
    const payload: ProjectRatePayload = {
      hourly_rate: Number(values.hourly_rate),
      valid_from: values.valid_from,
      note: note ? note : undefined,
    };

    const saved = await onSubmit(payload, editingRateId ?? undefined);

    // The parent reports failures through the `error` prop and keeps the draft
    // on screen, so the form is only cleared once the period was really stored.
    if (saved) {
      setEditingRateId(null);
      reset({ hourly_rate: '', valid_from: today(), note: '' });
    }
  };

  const currentDay = today();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? t('rates.title', { name: project.name }) : t('rates.titleFallback')}
      size="lg"
      footer={
        <Button type="button" variant="outline" onClick={onClose}>
          {t('rates.close')}
        </Button>
      }
    >
      <div className="space-y-5">
        <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
          {t('rates.intro')}
        </p>

        {loadError ? <Alert type="error" message={loadError} /> : null}

        {isLoading ? (
          <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{t('rates.loading')}</p>
        ) : rates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center dark:border-gray-700 dark:bg-gray-900/40">
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('rates.empty.title')}</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('rates.empty.message')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/60">
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('rates.columns.validFrom')}
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('rates.columns.validUntil')}
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('rates.columns.rate')}
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('rates.columns.note')}
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('rates.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => {
                  const isFuture = rate.valid_from > currentDay;
                  const isPast = !rate.is_current && !isFuture;
                  return (
                    <tr
                      key={rate.id}
                      className={clsx(
                        'border-b border-gray-100 last:border-b-0 dark:border-gray-800',
                        rate.is_current && 'bg-purple-50 dark:bg-purple-900/20',
                        isFuture && 'bg-blue-50 dark:bg-blue-900/20',
                        rate.id === editingRateId && 'ring-1 ring-inset ring-purple-400 dark:ring-purple-500'
                      )}
                    >
                      <td className="px-4 py-3 align-top">
                        <span
                          className={clsx(
                            'text-sm font-medium',
                            isPast ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'
                          )}
                        >
                          {formatDay(rate.valid_from)}
                        </span>
                        {rate.is_current ? (
                          <span className="ml-2 inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800 dark:bg-purple-900/40 dark:text-purple-200">
                            {t('rates.badge.current')}
                          </span>
                        ) : null}
                        {isFuture ? (
                          <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
                            {t('rates.badge.scheduled')}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top text-sm text-gray-600 dark:text-gray-400">
                        {formatPeriodEnd(rate.valid_until, t('rates.openEnded'))}
                      </td>
                      <td
                        className={clsx(
                          'px-4 py-3 align-top text-sm font-medium',
                          isPast ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'
                        )}
                      >
                        {formatCurrency(rate.hourly_rate, currency)}
                        <span className="text-gray-500 dark:text-gray-400">{t('rates.perHour')}</span>
                      </td>
                      <td className="px-4 py-3 align-top text-sm text-gray-600 dark:text-gray-400">
                        {rate.note ? rate.note : '—'}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => startEdit(rate)}
                            disabled={deletingRateId === rate.id}
                          >
                            {t('edit')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            onClick={() => void onDelete(rate)}
                            disabled={deletingRateId === rate.id}
                          >
                            {deletingRateId === rate.id ? t('deleting') : t('delete')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <form
          id={formId}
          className="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
          onSubmit={handleSubmit(handleFormSubmit)}
        >
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
            {editingRateId ? t('rates.form.editTitle') : t('rates.form.addTitle')}
          </h3>

          {error ? <Alert type="error" message={error} /> : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              id="project-rate-amount"
              label={t('rates.form.rate.label')}
              type="number"
              min="0"
              step="0.01"
              placeholder={t('rates.form.rate.placeholder')}
              {...register('hourly_rate', {
                required: t('rates.form.rate.required'),
                min: { value: 0, message: t('rates.form.rate.min') },
              })}
              error={errors.hourly_rate?.message}
            />
            <Input
              id="project-rate-valid-from"
              label={t('rates.form.validFrom.label')}
              type="date"
              {...register('valid_from', { required: t('rates.form.validFrom.required') })}
              error={errors.valid_from?.message}
              helperText={t('rates.form.validFrom.helper')}
            />
            <Input
              id="project-rate-note"
              label={t('rates.form.note.label')}
              placeholder={t('rates.form.note.placeholder')}
              {...register('note')}
            />
          </div>

          <div className="flex justify-end gap-2">
            {editingRateId ? (
              <Button type="button" size="sm" variant="outline" onClick={cancelEdit} disabled={isSubmitting}>
                {t('rates.form.cancelEdit')}
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={isSubmitting || !project}>
              {isSubmitting
                ? t('saving')
                : editingRateId
                  ? t('rates.form.saveEdit')
                  : t('rates.form.addSubmit')}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
};

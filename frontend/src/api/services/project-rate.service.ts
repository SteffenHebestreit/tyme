/**
 * @fileoverview Date-effective project hourly rates API service
 *
 * A project's hourly rate is a timeline rather than a single number: each rate
 * period applies from its `valid_from` until the next period starts. Adding a
 * period therefore never re-prices work that was already logged — time entries
 * keep the rate they were stamped with when they were created.
 *
 * `projects.hourly_rate` stays maintained by the backend as the rate effective
 * today, so every existing display of a project's rate keeps working.
 *
 * @module api/services/project-rate
 */

import apiClient from '@/api/services/client';

/**
 * One stored rate period of a project.
 */
export interface ProjectRate {
  id: string;
  user_id: string;
  project_id: string;
  hourly_rate: number;
  /** Inclusive start of the period, `YYYY-MM-DD`. */
  valid_from: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A rate period enriched with the exclusive end derived from the next period
 * plus a flag marking the period that covers today.
 */
export interface ProjectRatePeriod extends ProjectRate {
  /** Exclusive end (the next period's `valid_from`); `null` for the open-ended latest period. */
  valid_until: string | null;
  /** True for the period covering today — the rate new time entries are stamped with. */
  is_current: boolean;
}

/**
 * The rate effective on a given date.
 */
export interface EffectiveProjectRate {
  hourly_rate: number | null;
  date: string | null;
}

/**
 * Body for opening a new rate period. A future `valid_from` is allowed and is
 * the main use case (scheduling a raise ahead of time).
 */
export interface ProjectRatePayload {
  hourly_rate: number;
  /** `YYYY-MM-DD` */
  valid_from: string;
  note?: string;
}

/**
 * Body for correcting an existing rate period. All fields are optional.
 */
export interface ProjectRateUpdatePayload {
  hourly_rate?: number;
  /** `YYYY-MM-DD` */
  valid_from?: string;
  note?: string;
}

/**
 * Fetches a project's full rate timeline, oldest first.
 *
 * @async
 * @param {string} projectId - The UUID of the project
 * @returns {Promise<ProjectRatePeriod[]>} Rate periods ordered by `valid_from` ascending
 *
 * @example
 * const periods = await listProjectRates('project-uuid');
 * const current = periods.find((period) => period.is_current);
 */
export async function listProjectRates(projectId: string): Promise<ProjectRatePeriod[]> {
  const { data } = await apiClient.get<{ data: ProjectRatePeriod[] }>(`/projects/${projectId}/rates`);
  return data.data;
}

/**
 * Resolves the rate a time entry on the given date would be stamped with.
 *
 * @async
 * @param {string} projectId - The UUID of the project
 * @param {string} [date] - Optional `YYYY-MM-DD`; defaults to today on the backend
 * @returns {Promise<EffectiveProjectRate>} The effective rate, `hourly_rate: null` when the project has none
 *
 * @example
 * const { hourly_rate } = await getEffectiveRate('project-uuid', '2026-01-01');
 */
export async function getEffectiveRate(projectId: string, date?: string): Promise<EffectiveProjectRate> {
  const { data } = await apiClient.get<{ data: EffectiveProjectRate }>(
    `/projects/${projectId}/rates/effective`,
    { params: date ? { date } : {} }
  );
  return data.data;
}

/**
 * Opens a new rate period on a project.
 *
 * @async
 * @param {string} projectId - The UUID of the project
 * @param {ProjectRatePayload} payload - Rate, start date and optional note
 * @returns {Promise<ProjectRate>} The created rate period
 * @throws Rejects with a 409 when a rate already starts on that date
 *
 * @example
 * await addProjectRate('project-uuid', { hourly_rate: 150, valid_from: '2026-01-01' });
 */
export async function addProjectRate(projectId: string, payload: ProjectRatePayload): Promise<ProjectRate> {
  const { data } = await apiClient.post<{ data: ProjectRate }>(`/projects/${projectId}/rates`, payload);
  return data.data;
}

/**
 * Corrects an existing rate period. Time entries already stamped keep their rate.
 *
 * @async
 * @param {string} rateId - The UUID of the rate period
 * @param {ProjectRateUpdatePayload} payload - Partial update
 * @returns {Promise<ProjectRate>} The updated rate period
 * @throws Rejects with a 409 when another rate already starts on the new date
 *
 * @example
 * await updateProjectRate('rate-uuid', { hourly_rate: 160 });
 */
export async function updateProjectRate(
  rateId: string,
  payload: ProjectRateUpdatePayload
): Promise<ProjectRate> {
  const { data } = await apiClient.put<{ data: ProjectRate }>(`/projects/rates/${rateId}`, payload);
  return data.data;
}

/**
 * Removes a rate period. Deleting the only/current period is allowed — the
 * backend simply re-derives `projects.hourly_rate` from what is left.
 *
 * @async
 * @param {string} rateId - The UUID of the rate period
 * @returns {Promise<void>} Resolves when the deletion succeeded
 *
 * @example
 * await deleteProjectRate('rate-uuid');
 */
export async function deleteProjectRate(rateId: string): Promise<void> {
  await apiClient.delete(`/projects/rates/${rateId}`);
}

/**
 * Project rate service object providing all rate-timeline API operations.
 */
export const projectRateService = {
  listProjectRates,
  getEffectiveRate,
  addProjectRate,
  updateProjectRate,
  deleteProjectRate,
};

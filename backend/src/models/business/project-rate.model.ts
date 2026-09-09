/**
 * @fileoverview Date-effective project hourly rates
 *
 * A project's billing rate is not a single number but a timeline: each
 * {@link ProjectRate} row is the rate that applies from `valid_from` until the
 * next row's `valid_from`. Raising a rate therefore adds a row rather than
 * overwriting one, which is what keeps already-logged time entries priced at
 * the rate that was agreed when the work happened.
 *
 * @module models/business/project-rate
 */

/**
 * One rate period of a project, as stored in `project_rate_history`.
 */
export interface ProjectRate {
  id: string;
  user_id: string;
  project_id: string;
  hourly_rate: number;
  /** Inclusive start of the period, YYYY-MM-DD. */
  valid_from: string;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * A rate period enriched with the exclusive end derived from the next period,
 * so the UI can render "150 € from 01.01. to 30.06." without recomputing it.
 */
export interface ProjectRatePeriod extends ProjectRate {
  /** Exclusive end, i.e. the next period's valid_from; null for the open-ended latest period. */
  valid_until: string | null;
  /** True for the period covering today — the rate new time entries are stamped with. */
  is_current: boolean;
}

export interface CreateProjectRateDto {
  project_id: string;
  user_id: string;
  hourly_rate: number;
  valid_from: string;
  note?: string | null;
}

export interface UpdateProjectRateDto {
  hourly_rate?: number;
  valid_from?: string;
  note?: string | null;
}

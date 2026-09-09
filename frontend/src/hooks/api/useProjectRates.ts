/**
 * @fileoverview React Query hooks for date-effective project hourly rates
 *
 * Every mutation invalidates two things: the project's rate timeline and the
 * projects list. The second one matters because the backend keeps
 * `projects.hourly_rate` in sync as the rate effective today, so changing the
 * timeline changes what the project table shows.
 *
 * @module hooks/api/useProjectRates
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addProjectRate,
  deleteProjectRate,
  getEffectiveRate,
  listProjectRates,
  updateProjectRate,
} from '@/api/services/project-rate.service';
import type {
  EffectiveProjectRate,
  ProjectRate,
  ProjectRatePayload,
  ProjectRatePeriod,
  ProjectRateUpdatePayload,
} from '@/api/services/project-rate.service';
import { queryKeys } from './queryKeys';

/**
 * React Query hook for a project's full rate timeline (oldest first).
 * Disabled while no project id is available, so it can be driven straight from
 * the "selected project" state of a list page.
 *
 * @param {string | undefined} projectId - The UUID of the project
 * @param {boolean} [enabled=true] - Additional gate, e.g. "only while the modal is open"
 * @returns {UseQueryResult<ProjectRatePeriod[]>} Query result with the rate periods
 *
 * @example
 * const { data: rates = [], isLoading } = useProjectRates(project?.id, isModalOpen);
 */
export function useProjectRates(projectId: string | undefined, enabled = true) {
  return useQuery<ProjectRatePeriod[]>({
    queryKey: queryKeys.projectRates.list(projectId ?? 'pending'),
    queryFn: () => listProjectRates(projectId as string),
    enabled: enabled && Boolean(projectId),
  });
}

/**
 * React Query hook for the rate effective on a given date — what a time entry
 * on that date would be stamped with.
 *
 * @param {string | undefined} projectId - The UUID of the project
 * @param {string} [date] - Optional `YYYY-MM-DD`; defaults to today on the backend
 * @param {boolean} [enabled=true] - Additional gate
 * @returns {UseQueryResult<EffectiveProjectRate>} Query result with the effective rate
 *
 * @example
 * const { data } = useEffectiveProjectRate(projectId, entryDate);
 * const rate = data?.hourly_rate ?? null;
 */
export function useEffectiveProjectRate(projectId: string | undefined, date?: string, enabled = true) {
  return useQuery<EffectiveProjectRate>({
    queryKey: queryKeys.projectRates.effective(projectId ?? 'pending', date),
    queryFn: () => getEffectiveRate(projectId as string, date),
    enabled: enabled && Boolean(projectId),
  });
}

/**
 * React Query mutation hook for opening a new rate period.
 * A future `valid_from` is allowed — that is how a raise is scheduled ahead of time.
 *
 * @returns {UseMutationResult} Mutation object; rejects with a 409 when a rate already starts on that date
 *
 * @example
 * const addRate = useAddProjectRate();
 * await addRate.mutateAsync({ projectId, payload: { hourly_rate: 150, valid_from: '2026-01-01' } });
 */
export function useAddProjectRate() {
  const queryClient = useQueryClient();
  return useMutation<ProjectRate, Error, { projectId: string; payload: ProjectRatePayload }>({
    mutationFn: ({ projectId, payload }) => addProjectRate(projectId, payload),
    onSuccess: (_rate, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectRates.list(variables.projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}

/**
 * React Query mutation hook for correcting an existing rate period.
 * The project id is only carried along so the right timeline can be invalidated.
 *
 * @returns {UseMutationResult} Mutation object; rejects with a 409 on a duplicate start date
 *
 * @example
 * const updateRate = useUpdateProjectRate();
 * await updateRate.mutateAsync({ projectId, rateId, payload: { hourly_rate: 160 } });
 */
export function useUpdateProjectRate() {
  const queryClient = useQueryClient();
  return useMutation<
    ProjectRate,
    Error,
    { projectId: string; rateId: string; payload: ProjectRateUpdatePayload }
  >({
    mutationFn: ({ rateId, payload }) => updateProjectRate(rateId, payload),
    onSuccess: (_rate, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectRates.list(variables.projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}

/**
 * React Query mutation hook for removing a rate period.
 * Removing the only/current period is allowed; the backend re-derives
 * `projects.hourly_rate` from whatever is left.
 *
 * @returns {UseMutationResult} Mutation object
 *
 * @example
 * const deleteRate = useDeleteProjectRate();
 * await deleteRate.mutateAsync({ projectId, rateId });
 */
export function useDeleteProjectRate() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { projectId: string; rateId: string }>({
    mutationFn: ({ rateId }) => deleteProjectRate(rateId),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectRates.list(variables.projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}

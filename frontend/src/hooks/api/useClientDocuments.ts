/**
 * @fileoverview React Query hooks for client documents (signed contracts and
 * related paperwork stored per customer).
 *
 * Provides hooks for:
 * - Listing a client's documents, optionally narrowed to one project or type
 * - Fetching a single document's metadata
 * - Uploading a document — including uploading it as a NEW VERSION of an
 *   existing one via `supersedes_document_id`
 * - Updating a document's metadata
 * - Deleting a document together with its stored file
 *
 * Every mutation invalidates the document list so the version chain re-renders
 * with the new row in place.
 *
 * @module hooks/api/useClientDocuments
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClientDocument,
  ClientDocumentFilters,
  ClientDocumentUpdatePayload,
  ClientDocumentUploadPayload,
  deleteClientDocument,
  getClientDocument,
  listClientDocuments,
  updateClientDocument,
  uploadClientDocument,
} from '@/api/services/client-document.service';
import { queryKeys } from './queryKeys';

/**
 * React Query hook for a client's documents, newest first.
 * Disabled until a client ID is available (the modal mounts before one is picked).
 *
 * @param {string | undefined} clientId - UUID of the client
 * @param {ClientDocumentFilters} [filters] - Optional project/type narrowing
 * @param {boolean} [enabled=true] - Extra gate, e.g. only fetch while the modal is open
 * @returns {UseQueryResult<ClientDocument[]>} Query result with the client's documents
 *
 * @example
 * const { data: documents = [] } = useClientDocuments(client.id, { project_id }, isOpen);
 */
export function useClientDocuments(
  clientId: string | undefined,
  filters?: ClientDocumentFilters,
  enabled = true
) {
  return useQuery<ClientDocument[]>({
    queryKey: queryKeys.clientDocuments.list(clientId ?? 'pending', filters),
    queryFn: () => listClientDocuments(clientId as string, filters),
    enabled: Boolean(clientId) && enabled,
  });
}

/**
 * React Query hook for a single document's metadata.
 *
 * @param {string | undefined} documentId - UUID of the document
 * @param {boolean} [enabled=true] - Extra gate for conditional fetching
 * @returns {UseQueryResult<ClientDocument>} Query result with the document
 */
export function useClientDocument(documentId: string | undefined, enabled = true) {
  return useQuery<ClientDocument>({
    queryKey: queryKeys.clientDocuments.detail(documentId ?? 'pending'),
    queryFn: () => getClientDocument(documentId as string),
    enabled: Boolean(documentId) && enabled,
  });
}

/**
 * React Query mutation hook for uploading a client document.
 *
 * Passing `payload.supersedes_document_id` stores the upload as the next
 * version of that document rather than as a new chain.
 *
 * @returns {UseMutationResult} Mutation object for the upload
 *
 * @example
 * await uploadDocument.mutateAsync({ clientId, payload: { file, title } });
 */
export function useUploadClientDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      clientId,
      payload,
    }: {
      clientId: string;
      payload: ClientDocumentUploadPayload;
    }) => uploadClientDocument(clientId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.clientDocuments.all,
        refetchType: 'all',
      });
    },
  });
}

/**
 * React Query mutation hook for updating a document's metadata.
 * Invalidates both the list and the document's own detail entry.
 *
 * @returns {UseMutationResult} Mutation object for the update
 */
export function useUpdateClientDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      payload,
    }: {
      documentId: string;
      payload: ClientDocumentUpdatePayload;
    }) => updateClientDocument(documentId, payload),
    onSuccess: (
      _document: ClientDocument,
      variables: { documentId: string; payload: ClientDocumentUpdatePayload }
    ) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.clientDocuments.all,
        refetchType: 'all',
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.clientDocuments.detail(variables.documentId),
      });
    },
  });
}

/**
 * React Query mutation hook for deleting a document and its stored file.
 *
 * @returns {UseMutationResult} Mutation object for the delete
 */
export function useDeleteClientDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => deleteClientDocument(documentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.clientDocuments.all,
        refetchType: 'all',
      });
    },
  });
}

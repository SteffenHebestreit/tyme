/**
 * @fileoverview Client document API service — signed contracts and related paperwork.
 *
 * Documents live on a CLIENT, with an optional project link that narrows a
 * document to a single engagement. A client may hold any number of documents,
 * and a document can be replaced by a newer version: the replacement carries
 * `supersedes_document_id`, so the whole version chain stays readable and every
 * superseded file remains downloadable.
 *
 * The download endpoint streams the stored file behind the Bearer token, so it
 * can never be used as a plain `<a href>` or `<img src>`. `downloadClientDocument`
 * fetches it through the shared authenticated axios client and hands back a Blob
 * for the caller to turn into an object URL (preview) or a synthetic download.
 *
 * @module api/services/client-document
 */

import apiClient from '@/api/services/client';

/**
 * Kinds of document that can be stored against a client.
 * Mirrors the `document_type` CHECK constraint on `client_documents`.
 */
export type ClientDocumentType =
  | 'contract'
  | 'amendment'
  | 'nda'
  | 'offer'
  | 'order'
  | 'invoice_terms'
  | 'other';

/** Every document type, in the order they are offered in the UI. */
export const CLIENT_DOCUMENT_TYPES: ClientDocumentType[] = [
  'contract',
  'amendment',
  'nda',
  'offer',
  'order',
  'invoice_terms',
  'other',
];

/**
 * One stored client document.
 * `client_name` / `project_name` are resolved by the backend so the UI does not
 * have to join them itself.
 */
export interface ClientDocument {
  id: string;
  user_id: string;
  client_id: string;
  project_id: string | null;
  title: string;
  document_type: ClientDocumentType | string;
  file_url: string | null;
  file_filename: string | null;
  file_size: number | null;
  file_mimetype: string | null;
  /** Version number within its chain, starting at 1. */
  version: number;
  /** The document this one replaces, or `null` for an original. */
  supersedes_document_id: string | null;
  signed_at: string | null;
  valid_from: string | null;
  valid_until: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  client_name?: string;
  project_name?: string | null;
}

/** Optional server-side filters for a client's document list. */
export interface ClientDocumentFilters {
  project_id?: string;
  document_type?: ClientDocumentType | string;
}

/**
 * Body of an upload. Everything but `file` and `title` is optional; passing
 * `supersedes_document_id` stores the upload as the NEXT version of that
 * document instead of a new chain, leaving the superseded file intact.
 */
export interface ClientDocumentUploadPayload {
  file: File;
  title: string;
  document_type?: ClientDocumentType | string;
  project_id?: string;
  /** `YYYY-MM-DD` */
  signed_at?: string;
  /** `YYYY-MM-DD` */
  valid_from?: string;
  /** `YYYY-MM-DD` */
  valid_until?: string;
  notes?: string;
  supersedes_document_id?: string;
}

/**
 * Metadata-only update. The stored file is immutable — replacing it means
 * uploading a new version that supersedes the current one.
 */
export interface ClientDocumentUpdatePayload {
  title?: string;
  document_type?: ClientDocumentType | string;
  project_id?: string | null;
  signed_at?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  notes?: string | null;
}

/** Upload ceiling enforced by the backend (25 MB) — checked client-side too. */
export const CLIENT_DOCUMENT_MAX_FILE_SIZE = 25 * 1024 * 1024;

/** MIME types the backend's multer filter accepts. */
export const CLIENT_DOCUMENT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
];

/** Value for the file input's `accept` attribute. */
export const CLIENT_DOCUMENT_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.odt,application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text';

/** Extensions accepted as a fallback when the browser reports no/odd MIME type. */
const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'doc', 'docx', 'odt'];

/**
 * Client-side mirror of the backend's file filter, so an oversized or unsupported
 * file gets a clear message instead of a bare 400/500 from the server.
 *
 * @param {File} file - The file picked in the upload form
 * @returns {'size' | 'type' | null} The rule the file breaks, or `null` if it is fine
 */
export function validateClientDocumentFile(file: File): 'size' | 'type' | null {
  if (file.size > CLIENT_DOCUMENT_MAX_FILE_SIZE) {
    return 'size';
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const typeAllowed =
    (!!file.type && CLIENT_DOCUMENT_ALLOWED_MIME_TYPES.includes(file.type)) ||
    ALLOWED_EXTENSIONS.includes(extension);
  return typeAllowed ? null : 'type';
}

/**
 * Fetches a client's documents, newest first.
 *
 * @async
 * @param {string} clientId - UUID of the client
 * @param {ClientDocumentFilters} [filters] - Optional project/type narrowing
 * @returns {Promise<ClientDocument[]>} The client's documents
 *
 * @example
 * const docs = await listClientDocuments(clientId, { project_id: projectId });
 */
export async function listClientDocuments(
  clientId: string,
  filters?: ClientDocumentFilters
): Promise<ClientDocument[]> {
  const { data } = await apiClient.get<ClientDocument[]>(`/clients/${clientId}/documents`, {
    params: filters,
  });
  return data;
}

/**
 * Uploads a document for a client as `multipart/form-data`.
 *
 * Passing `supersedes_document_id` creates a NEW version of that document
 * (version = previous + 1); the superseded row and its file stay intact.
 *
 * @async
 * @param {string} clientId - UUID of the client
 * @param {ClientDocumentUploadPayload} payload - The file plus its metadata
 * @returns {Promise<ClientDocument>} The stored document
 *
 * @example
 * await uploadClientDocument(clientId, { file, title: 'Rahmenvertrag', document_type: 'contract' });
 */
export async function uploadClientDocument(
  clientId: string,
  payload: ClientDocumentUploadPayload
): Promise<ClientDocument> {
  const formData = new FormData();
  formData.append('document', payload.file);
  formData.append('title', payload.title);

  const optionalFields: Array<keyof ClientDocumentUploadPayload> = [
    'document_type',
    'project_id',
    'signed_at',
    'valid_from',
    'valid_until',
    'notes',
    'supersedes_document_id',
  ];
  optionalFields.forEach((field) => {
    const value = payload[field];
    if (typeof value === 'string' && value.trim()) {
      formData.append(field, value.trim());
    }
  });

  const { data } = await apiClient.post<ClientDocument>(
    `/clients/${clientId}/documents`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return data;
}

/**
 * Fetches a single document's metadata.
 *
 * @async
 * @param {string} documentId - UUID of the document
 * @returns {Promise<ClientDocument>} The document
 */
export async function getClientDocument(documentId: string): Promise<ClientDocument> {
  const { data } = await apiClient.get<ClientDocument>(`/clients/documents/${documentId}`);
  return data;
}

/**
 * Updates a document's metadata. The stored file itself is immutable.
 *
 * @async
 * @param {string} documentId - UUID of the document
 * @param {ClientDocumentUpdatePayload} payload - Fields to change
 * @returns {Promise<ClientDocument>} The updated document
 */
export async function updateClientDocument(
  documentId: string,
  payload: ClientDocumentUpdatePayload
): Promise<ClientDocument> {
  const { data } = await apiClient.put<ClientDocument>(
    `/clients/documents/${documentId}`,
    payload
  );
  return data;
}

/**
 * Deletes a document row together with its stored file.
 *
 * @async
 * @param {string} documentId - UUID of the document
 * @returns {Promise<void>} Resolves once the document is gone
 */
export async function deleteClientDocument(documentId: string): Promise<void> {
  await apiClient.delete(`/clients/documents/${documentId}`);
}

/**
 * Downloads a document's file.
 *
 * The endpoint streams the file behind the Bearer token, so it is fetched
 * through the shared authenticated axios client rather than linked to directly.
 * The caller owns the returned Blob and is responsible for revoking any object
 * URL it creates from it.
 *
 * @async
 * @param {string} documentId - UUID of the document
 * @returns {Promise<Blob>} The file contents
 *
 * @example
 * const blob = await downloadClientDocument(doc.id);
 * const url = URL.createObjectURL(blob);
 * // …use url, then:
 * URL.revokeObjectURL(url);
 */
export async function downloadClientDocument(documentId: string): Promise<Blob> {
  const response = await apiClient.get(`/clients/documents/${documentId}/download`, {
    responseType: 'blob',
  });
  return response.data as Blob;
}

/**
 * @fileoverview Client document model definitions for signed contracts and
 * related paperwork.
 *
 * Documents live on a CLIENT, with an optional project link that narrows a
 * document to a single engagement. A client may hold any number of documents,
 * and a document can be replaced by a newer version — the replacement points
 * back at the row it supersedes, so the whole version chain stays readable and
 * every superseded file remains downloadable.
 *
 * @module models/business/client-document
 */

/**
 * Client document type enum
 * Mirrors the document_type CHECK constraint on the client_documents table.
 */
export enum ClientDocumentType {
  CONTRACT = 'contract',
  AMENDMENT = 'amendment',
  NDA = 'nda',
  OFFER = 'offer',
  ORDER = 'order',
  INVOICE_TERMS = 'invoice_terms',
  OTHER = 'other',
}

/**
 * Main client document interface
 *
 * @interface ClientDocument
 * @property {string} id - Unique document identifier (UUID)
 * @property {string} user_id - Owner of the document (Keycloak UUID)
 * @property {string} client_id - Client the document belongs to
 * @property {string | null} project_id - Optional project the document narrows to
 * @property {string} title - Human-readable document title
 * @property {ClientDocumentType | string} document_type - Kind of document
 * @property {string | null} file_url - Path to the file in object storage (/{bucket}/{key})
 * @property {string | null} file_filename - Original (sanitised) filename
 * @property {number | null} file_size - File size in bytes
 * @property {string | null} file_mimetype - File MIME type
 * @property {number} version - Version number within its chain, starting at 1
 * @property {string | null} supersedes_document_id - Document this one replaces
 * @property {string | null} signed_at - Date the document was signed (YYYY-MM-DD)
 * @property {string | null} valid_from - Start of the validity period (YYYY-MM-DD)
 * @property {string | null} valid_until - End of the validity period (YYYY-MM-DD)
 * @property {string | null} notes - Additional notes
 * @property {string} created_at - Timestamp when the document was created
 * @property {string} updated_at - Timestamp when the document was last updated
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
  version: number;
  supersedes_document_id: string | null;
  signed_at: string | null;
  valid_from: string | null;
  valid_until: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Client document with related entity names
 * Extended document interface carrying the client and project names so the
 * frontend does not have to resolve them separately.
 */
export interface ClientDocumentWithRelations extends ClientDocument {
  client_name?: string;
  project_name?: string | null;
}

/**
 * Client document filter options for querying a client's documents
 *
 * @interface ClientDocumentFilters
 * @property {string} [project_id] - Only documents linked to this project
 * @property {ClientDocumentType | string} [document_type] - Only documents of this type
 */
export interface ClientDocumentFilters {
  project_id?: string;
  document_type?: ClientDocumentType | string;
}

/**
 * Client document creation data
 * Metadata accompanying the uploaded file. The file itself is passed
 * separately as an Express.Multer.File.
 */
export interface CreateClientDocumentData {
  project_id?: string | null;
  title: string;
  document_type?: ClientDocumentType | string;
  signed_at?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  notes?: string | null;
  supersedes_document_id?: string | null;
}

/**
 * Client document update data
 * Metadata-only updates. The stored file is immutable — replacing it means
 * uploading a new version that supersedes this one.
 */
export interface UpdateClientDocumentData {
  project_id?: string | null;
  title?: string;
  document_type?: ClientDocumentType | string;
  signed_at?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  notes?: string | null;
}

/**
 * Stored document file information
 */
export interface ClientDocumentFile {
  url: string;
  filename: string;
  size: number;
  mimetype: string;
}

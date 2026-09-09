/**
 * @fileoverview Client document service for signed contracts and related files.
 *
 * Provides functionality for:
 * - Uploading documents against a client, optionally narrowed to a project
 * - Listing and reading a client's documents
 * - Metadata updates and deletion (row plus stored object)
 * - Versioning: a new upload can supersede an existing document
 *
 * Ownership note: ClientService.findById/update/delete are NOT tenant-scoped,
 * so nothing in here authorises through them. Every statement joins clients and
 * filters on clients.user_id itself, which makes the tenant check part of the
 * same query that reads the row — there is no window in which a document is
 * fetched before its owner is known.
 *
 * @module services/business/client-document
 */

import { getDbClient } from '../../utils/database';
import { logger } from '../../utils/logger';
import {
  ClientDocument,
  ClientDocumentWithRelations,
  ClientDocumentFilters,
  CreateClientDocumentData,
  UpdateClientDocumentData,
} from '../../models/business/client-document.model';

/**
 * node-pg returns `date` columns as JS Date objects; normalise them to
 * YYYY-MM-DD strings so the API output matches the model's declared types.
 */
function toDateStr(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  return String(val).split('T')[0];
}

/** Normalise a client_documents row's date columns to YYYY-MM-DD strings. */
function mapRow(row: any): ClientDocumentWithRelations {
  if (!row) return row;
  return {
    ...row,
    signed_at: toDateStr(row.signed_at),
    valid_from: toDateStr(row.valid_from),
    valid_until: toDateStr(row.valid_until),
  };
}

/**
 * Raised when a document that has already been superseded is superseded again.
 *
 * Carries the winning version so the caller can tell the user which document
 * replaced it, instead of a bare failure.
 */
export class DocumentAlreadySupersededError extends Error {
  constructor(
    public readonly currentDocumentId: string | null,
    public readonly currentVersion: number | null
  ) {
    super('This document has already been superseded by a newer version.');
    this.name = 'DocumentAlreadySupersededError';
  }
}

export class ClientDocumentService {
  private db = getDbClient();

  /**
   * Verify that a client belongs to the given user.
   *
   * @param {string} clientId - Client ID
   * @param {string} userId - Owner to check against
   * @returns {Promise<boolean>} True if the client exists and is owned by the user
   */
  private async isClientOwnedBy(clientId: string, userId: string): Promise<boolean> {
    const result = await this.db.query('SELECT 1 FROM clients WHERE id = $1 AND user_id = $2', [
      clientId,
      userId,
    ]);
    return result.rows.length > 0;
  }

  /**
   * Verify that a project belongs to the given user AND to the given client.
   * A document may only be narrowed to a project of the client it hangs on.
   *
   * @param {string} projectId - Project ID
   * @param {string} clientId - Client the project must belong to
   * @param {string} userId - Owner to check against
   * @returns {Promise<boolean>} True if the project is a valid narrowing target
   */
  private async isProjectValidFor(
    projectId: string,
    clientId: string,
    userId: string
  ): Promise<boolean> {
    const result = await this.db.query(
      'SELECT 1 FROM projects WHERE id = $1 AND client_id = $2 AND user_id = $3',
      [projectId, clientId, userId]
    );
    return result.rows.length > 0;
  }

  /**
   * Create a document for a client from an uploaded file.
   *
   * When `supersedes_document_id` is given the new row becomes the next version
   * in that chain. The superseded row and its stored object are deliberately
   * left untouched: a countersigned contract has to stay retrievable after it
   * has been replaced.
   *
   * The version is read and written inside a transaction, with the superseded
   * row locked, so two concurrent uploads cannot mint the same version number.
   * The file is uploaded before the transaction opens — an object-storage round
   * trip has no business holding a database connection — and is cleaned up again
   * if the insert fails.
   *
   * @param {string} clientId - Client the document belongs to
   * @param {string} userId - User uploading the document
   * @param {CreateClientDocumentData} data - Document metadata
   * @param {Express.Multer.File} file - Uploaded file
   * @returns {Promise<ClientDocument>} Created document
   */
  async createDocument(
    clientId: string,
    userId: string,
    data: CreateClientDocumentData,
    file: Express.Multer.File
  ): Promise<ClientDocument> {
    if (!(await this.isClientOwnedBy(clientId, userId))) {
      throw new Error('Client not found or unauthorized');
    }

    if (data.project_id && !(await this.isProjectValidFor(data.project_id, clientId, userId))) {
      throw new Error('Project not found or does not belong to this client');
    }

    // Check before the storage round trip, so the common case fails without
    // having uploaded a file first. This is advisory only — the unique index is
    // what actually decides, and the 23505 below is the authoritative answer.
    if (data.supersedes_document_id) {
      const existing = await this.db.query(
        `SELECT d.id, d.version FROM client_documents d
         WHERE d.supersedes_document_id = $1`,
        [data.supersedes_document_id]
      );
      if (existing.rows.length > 0) {
        throw new DocumentAlreadySupersededError(existing.rows[0].id, existing.rows[0].version);
      }
    }

    // Import storage service dynamically to avoid circular dependencies
    const { storageService } = await import('../storage/storage.service');

    // Scope the object key by client so two clients' files can never collide on
    // the timestamp-plus-filename part of the key.
    const uploadResult = await storageService.uploadFile(
      userId,
      file.buffer,
      file.originalname,
      file.mimetype,
      'documents',
      `clients/${clientId}`
    );

    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      let version = 1;
      let supersedesId: string | null = null;

      if (data.supersedes_document_id) {
        // Lock the superseded row for the length of the transaction so a
        // concurrent upload against the same predecessor waits for our version.
        const previous = await client.query(
          `SELECT d.id, d.version, d.client_id
           FROM client_documents d
           JOIN clients c ON c.id = d.client_id
           WHERE d.id = $1 AND c.user_id = $2
           FOR UPDATE OF d`,
          [data.supersedes_document_id, userId]
        );

        if (previous.rows.length === 0) {
          throw new Error('Superseded document not found or unauthorized');
        }
        if (previous.rows[0].client_id !== clientId) {
          throw new Error('Superseded document belongs to a different client');
        }

        version = previous.rows[0].version + 1;
        supersedesId = previous.rows[0].id;
      }

      const query = `
        INSERT INTO client_documents (
          user_id, client_id, project_id, title, document_type,
          file_url, file_filename, file_size, file_mimetype,
          version, supersedes_document_id, signed_at, valid_from, valid_until, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *
      `;

      const values = [
        userId,
        clientId,
        data.project_id || null,
        data.title,
        data.document_type || 'contract',
        uploadResult.url,
        uploadResult.filename,
        file.size,
        file.mimetype,
        version,
        supersedesId,
        data.signed_at || null,
        data.valid_from || null,
        data.valid_until || null,
        data.notes || null,
      ];

      const result = await client.query(query, values);

      await client.query('COMMIT');
      return mapRow(result.rows[0]);
    } catch (error) {
      // The race the unique index exists for: another upload superseded the same
      // predecessor between our pre-flight check and our INSERT.
      if ((error as any)?.code === '23505'
          && (error as any)?.constraint === 'uq_client_documents_supersedes') {
        const winner = await this.db
          .query(`SELECT id, version FROM client_documents WHERE supersedes_document_id = $1`,
                 [data.supersedes_document_id])
          .catch(() => ({ rows: [] as any[] }));
        error = new DocumentAlreadySupersededError(
          winner.rows[0]?.id ?? null,
          winner.rows[0]?.version ?? null
        );
      }

      // A failing ROLLBACK (dead connection) must not stop the file cleanup, or
      // mask the error that actually caused the failure.
      await client.query('ROLLBACK').catch((rollbackError) => {
        logger.error('Error rolling back document creation:', rollbackError);
      });

      // The object is already in storage but no row will ever reference it —
      // remove it rather than leak it, since there is no storage GC.
      await this.deleteDocumentFile(uploadResult.url).catch((cleanupError) => {
        logger.error(`Error removing orphaned upload ${uploadResult.url}:`, cleanupError);
      });

      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * List a client's documents, newest first.
   *
   * @param {string} clientId - Client whose documents to list
   * @param {string} userId - Owner of the client
   * @param {ClientDocumentFilters} [filters] - Optional project/type narrowing
   * @returns {Promise<ClientDocumentWithRelations[]>} Matching documents
   */
  async getDocumentsByClient(
    clientId: string,
    userId: string,
    filters?: ClientDocumentFilters
  ): Promise<ClientDocumentWithRelations[]> {
    if (!(await this.isClientOwnedBy(clientId, userId))) {
      throw new Error('Client not found or unauthorized');
    }

    const values: any[] = [clientId, userId];
    const conditions: string[] = ['d.client_id = $1', 'c.user_id = $2'];

    if (filters?.project_id) {
      conditions.push(`d.project_id = $${values.length + 1}`);
      values.push(filters.project_id);
    }

    if (filters?.document_type) {
      conditions.push(`d.document_type = $${values.length + 1}`);
      values.push(filters.document_type);
    }

    const query = `
      SELECT d.*, c.name AS client_name, p.name AS project_name
      FROM client_documents d
      JOIN clients c ON c.id = d.client_id
      LEFT JOIN projects p ON p.id = d.project_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.created_at DESC
    `;

    const result = await this.db.query(query, values);
    return result.rows.map(mapRow);
  }

  /**
   * Fetch a single document, scoped to its owner.
   *
   * @param {string} documentId - Document ID
   * @param {string} userId - Owner of the client the document hangs on
   * @returns {Promise<ClientDocumentWithRelations | null>} Document, or null if not found
   */
  async getDocumentById(
    documentId: string,
    userId: string
  ): Promise<ClientDocumentWithRelations | null> {
    const query = `
      SELECT d.*, c.name AS client_name, p.name AS project_name
      FROM client_documents d
      JOIN clients c ON c.id = d.client_id
      LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.id = $1 AND c.user_id = $2
    `;

    const result = await this.db.query(query, [documentId, userId]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  /**
   * Update a document's metadata. The stored file is never touched here —
   * replacing a file means uploading a new version that supersedes this one.
   *
   * client_documents has no updated_at trigger, so the timestamp is set
   * explicitly.
   *
   * @param {string} documentId - Document ID
   * @param {string} userId - Owner of the client the document hangs on
   * @param {UpdateClientDocumentData} data - Fields to update
   * @returns {Promise<ClientDocumentWithRelations>} Updated document
   */
  async updateDocument(
    documentId: string,
    userId: string,
    data: UpdateClientDocumentData
  ): Promise<ClientDocumentWithRelations> {
    const existing = await this.getDocumentById(documentId, userId);
    if (!existing) {
      throw new Error('Document not found or unauthorized');
    }

    if (
      data.project_id &&
      !(await this.isProjectValidFor(data.project_id, existing.client_id, userId))
    ) {
      throw new Error('Project not found or does not belong to this client');
    }

    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;

    const set = (col: string, val: any) => {
      fields.push(`${col} = $${i++}`);
      values.push(val);
    };

    if (data.title !== undefined) set('title', data.title);
    if (data.document_type !== undefined) set('document_type', data.document_type);
    if (data.project_id !== undefined) set('project_id', data.project_id || null);
    if (data.signed_at !== undefined) set('signed_at', data.signed_at || null);
    if (data.valid_from !== undefined) set('valid_from', data.valid_from || null);
    if (data.valid_until !== undefined) set('valid_until', data.valid_until || null);
    if (data.notes !== undefined) set('notes', data.notes || null);

    if (fields.length === 0) return existing;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(documentId, userId);

    // UPDATE ... FROM keeps the tenant check inside the writing statement, so
    // the row can never be updated on the strength of an earlier read.
    const query = `
      UPDATE client_documents d
      SET ${fields.join(', ')}
      FROM clients c
      WHERE c.id = d.client_id AND d.id = $${i++} AND c.user_id = $${i}
      RETURNING d.*
    `;

    const result = await this.db.query(query, values);

    if (result.rows.length === 0) {
      throw new Error('Document not found or unauthorized');
    }

    return mapRow(result.rows[0]);
  }

  /**
   * Delete a document row and its stored object.
   *
   * Rows that were superseded BY this document keep existing; rows that
   * supersede it have their supersedes_document_id set to NULL by the foreign
   * key, so the chain simply loses a link rather than cascading.
   *
   * @param {string} documentId - Document ID
   * @param {string} userId - Owner of the client the document hangs on
   * @returns {Promise<void>}
   */
  async deleteDocument(documentId: string, userId: string): Promise<void> {
    const document = await this.getDocumentById(documentId, userId);
    if (!document) {
      throw new Error('Document not found or unauthorized');
    }

    const query = `
      DELETE FROM client_documents d
      USING clients c
      WHERE c.id = d.client_id AND d.id = $1 AND c.user_id = $2
    `;
    const result = await this.db.query(query, [documentId, userId]);

    if ((result.rowCount ?? 0) === 0) {
      throw new Error('Document not found or unauthorized');
    }

    // Only remove the object once the row is gone, so a storage failure can
    // never leave a row pointing at a deleted file.
    if (document.file_url) {
      await this.deleteDocumentFile(document.file_url);
    }
  }

  /**
   * Get a document's file stream for download.
   *
   * @param {string} documentId - Document ID
   * @param {string} userId - Owner of the client the document hangs on
   * @returns {Promise<{stream: import('stream').Readable, filename: string, mimetype: string}>} File stream and metadata
   */
  async getDocumentFileStream(
    documentId: string,
    userId: string
  ): Promise<{
    stream: import('stream').Readable;
    filename: string;
    mimetype: string;
  }> {
    const document = await this.getDocumentById(documentId, userId);
    if (!document) {
      throw new Error('Document not found or unauthorized');
    }

    if (!document.file_url) {
      throw new Error('No file found for this document');
    }

    // Import storage service dynamically
    const { storageService } = await import('../storage/storage.service');

    // Extract bucket and object name from the stored path
    // Path format: /user-{id}/documents/clients/{clientId}/{timestamp}-{filename}
    const urlParts = document.file_url.replace(/^\//, '').split('/');
    const bucket = urlParts[0]; // First part is the bucket name
    const objectName = urlParts.slice(1).join('/'); // Rest is the object name

    const stream = await storageService.getFileStream(bucket, objectName);

    return {
      stream,
      filename: document.file_filename || 'document',
      mimetype: document.file_mimetype || 'application/octet-stream',
    };
  }

  /**
   * Delete a document's stored object.
   *
   * @param {string} fileUrl - Stored path, e.g. /{bucket}/{key}
   * @returns {Promise<void>}
   */
  private async deleteDocumentFile(fileUrl: string): Promise<void> {
    try {
      // Import storage service dynamically
      const { storageService } = await import('../storage/storage.service');

      await storageService.deleteFileFromPath(fileUrl);
    } catch (error) {
      logger.error('Error deleting client document file:', error);
      // Don't throw - file might already be deleted
    }
  }
}

/**
 * @fileoverview Joi validation schemas for client document endpoints.
 *
 * Provides validation schemas for:
 * - Creating (uploading) client documents
 * - Updating client document metadata
 * - Filtering a client's documents
 * - Route parameters
 *
 * The create schema validates a multipart/form-data body, where every text
 * field arrives as a string and an untouched form control arrives as ''. The
 * optional fields therefore use `.empty('')` so a blank control is treated as
 * "not provided" rather than as an invalid date or UUID.
 *
 * @module schemas/business/client-document
 */

import Joi from 'joi';
import { ClientDocumentType } from '../../models/business/client-document.model';

/** Optional UUID that a blank multipart field clears rather than fails. */
const optionalUuid = Joi.string().uuid().optional().allow(null).empty('');

/** Optional YYYY-MM-DD date that a blank multipart field clears rather than fails. */
const optionalDate = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .allow(null)
  .empty('')
  .messages({
    'string.pattern.base': 'Date must be in YYYY-MM-DD format',
  });

/**
 * Schema for creating a client document
 * Validates the metadata fields of the multipart upload; the file itself is
 * handled by multer and checked in the controller.
 */
export const createClientDocumentSchema = Joi.object({
  title: Joi.string().min(1).max(255).required(),
  document_type: Joi.string()
    .valid(...Object.values(ClientDocumentType))
    .empty('')
    .default(ClientDocumentType.CONTRACT),
  project_id: optionalUuid,
  signed_at: optionalDate,
  valid_from: optionalDate,
  valid_until: optionalDate,
  notes: Joi.string().max(5000).optional().allow(null, ''),
  supersedes_document_id: optionalUuid,
});

/**
 * Schema for updating a client document
 * Metadata only — the stored file is immutable, a replacement is uploaded as a
 * new version instead.
 */
export const updateClientDocumentSchema = Joi.object({
  title: Joi.string().min(1).max(255).optional(),
  document_type: Joi.string()
    .valid(...Object.values(ClientDocumentType))
    .optional(),
  project_id: Joi.string().uuid().optional().allow(null),
  signed_at: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .allow(null)
    .messages({
      'string.pattern.base': 'Date must be in YYYY-MM-DD format',
    }),
  valid_from: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .allow(null)
    .messages({
      'string.pattern.base': 'Date must be in YYYY-MM-DD format',
    }),
  valid_until: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .allow(null)
    .messages({
      'string.pattern.base': 'Date must be in YYYY-MM-DD format',
    }),
  notes: Joi.string().max(5000).optional().allow(null, ''),
}).min(1).messages({
  'object.min': 'At least one field must be provided for update',
});

/**
 * Schema for the client ID route parameter (/api/clients/:id/documents)
 */
export const clientIdParamSchema = Joi.object({
  id: Joi.string().uuid().required().messages({
    'string.guid': 'Invalid client ID format',
  }),
});

/**
 * Schema for the document ID route parameter (/api/clients/documents/:documentId)
 */
export const clientDocumentIdSchema = Joi.object({
  documentId: Joi.string().uuid().required().messages({
    'string.guid': 'Invalid document ID format',
  }),
});

/**
 * Schema for filtering a client's documents
 */
export const clientDocumentFilterSchema = Joi.object({
  project_id: Joi.string().uuid().optional(),
  document_type: Joi.string()
    .valid(...Object.values(ClientDocumentType))
    .optional(),
});

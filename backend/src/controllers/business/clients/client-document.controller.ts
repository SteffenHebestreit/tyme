/**
 * @fileoverview Client document endpoints: upload, list, read, download,
 * metadata update and deletion of signed contracts and related files.
 * @module controllers/business/clients/client-document
 */

import { Request, Response } from 'express';
import { ClientDocumentService } from '../../../services/business/client-document.service';
import {
  createClientDocumentSchema,
  updateClientDocumentSchema,
  clientIdParamSchema,
  clientDocumentIdSchema,
  clientDocumentFilterSchema,
} from '../../../schemas/business/client-document.schema';
import { logger } from '../../../utils/logger';

export class ClientDocumentController {
  private clientDocumentService: ClientDocumentService;

  constructor() {
    this.clientDocumentService = new ClientDocumentService();
  }

  /**
   * Upload a document for a client
   * POST /api/clients/:id/documents
   */
  uploadDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
        return;
      }

      // Validate client ID parameter
      const { error: idError, value: idValue } = clientIdParamSchema.validate(req.params);
      if (idError) {
        res.status(400).json({ error: 'Validation error', details: idError.details });
        return;
      }

      // Check if file was uploaded
      if (!req.file) {
        res.status(400).json({ error: 'Bad request', message: 'No file uploaded' });
        return;
      }

      // Validate the multipart metadata fields
      const { error: bodyError, value: validatedData } = createClientDocumentSchema.validate(
        req.body
      );
      if (bodyError) {
        res.status(400).json({ error: 'Validation error', details: bodyError.details });
        return;
      }

      const document = await this.clientDocumentService.createDocument(
        idValue.id,
        userId,
        validatedData,
        req.file
      );

      res.status(201).json(document);
    } catch (error: any) {
      logger.error('Upload client document error:', error);
      if (error.message.includes('not found') || error.message.includes('unauthorized')) {
        res.status(404).json({ error: 'Not found', message: error.message });
      } else if (error.message.includes('does not belong')) {
        res.status(400).json({ error: 'Validation error', message: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error', message: error.message });
      }
    }
  };

  /**
   * List a client's documents, newest first
   * GET /api/clients/:id/documents
   */
  getDocuments = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
        return;
      }

      // Validate client ID parameter
      const { error: idError, value: idValue } = clientIdParamSchema.validate(req.params);
      if (idError) {
        res.status(400).json({ error: 'Validation error', details: idError.details });
        return;
      }

      // Validate query filters
      const { error: filterError, value: filters } = clientDocumentFilterSchema.validate(req.query);
      if (filterError) {
        res.status(400).json({ error: 'Validation error', details: filterError.details });
        return;
      }

      const documents = await this.clientDocumentService.getDocumentsByClient(
        idValue.id,
        userId,
        filters
      );

      res.status(200).json(documents);
    } catch (error: any) {
      logger.error('Get client documents error:', error);
      if (error.message.includes('not found') || error.message.includes('unauthorized')) {
        res.status(404).json({ error: 'Not found', message: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error', message: error.message });
      }
    }
  };

  /**
   * Get a single document's metadata
   * GET /api/clients/documents/:documentId
   */
  getDocumentById = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
        return;
      }

      // Validate document ID parameter
      const { error: idError, value: idValue } = clientDocumentIdSchema.validate(req.params);
      if (idError) {
        res.status(400).json({ error: 'Validation error', details: idError.details });
        return;
      }

      const document = await this.clientDocumentService.getDocumentById(idValue.documentId, userId);

      if (!document) {
        res.status(404).json({ error: 'Not found', message: 'Document not found' });
        return;
      }

      res.status(200).json(document);
    } catch (error: any) {
      logger.error('Get client document by ID error:', error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  };

  /**
   * Download a document's file
   * GET /api/clients/documents/:documentId/download
   */
  downloadDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
        return;
      }

      // Validate document ID parameter
      const { error: idError, value: idValue } = clientDocumentIdSchema.validate(req.params);
      if (idError) {
        res.status(400).json({ error: 'Validation error', details: idError.details });
        return;
      }

      // Get document file stream
      const { stream, filename, mimetype } =
        await this.clientDocumentService.getDocumentFileStream(idValue.documentId, userId);

      // Set response headers for file download
      res.setHeader('Content-Type', mimetype);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      // Pipe stream to response
      stream.pipe(res);
    } catch (error: any) {
      logger.error('Download client document error:', error);
      if (error.message.includes('not found') || error.message.includes('unauthorized')) {
        res.status(404).json({ error: 'Not found', message: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error', message: error.message });
      }
    }
  };

  /**
   * Update a document's metadata
   * PUT /api/clients/documents/:documentId
   */
  updateDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
        return;
      }

      // Validate document ID parameter
      const { error: idError, value: idValue } = clientDocumentIdSchema.validate(req.params);
      if (idError) {
        res.status(400).json({ error: 'Validation error', details: idError.details });
        return;
      }

      // Validate request body
      const { error: bodyError, value: validatedData } = updateClientDocumentSchema.validate(
        req.body
      );
      if (bodyError) {
        res.status(400).json({ error: 'Validation error', details: bodyError.details });
        return;
      }

      const document = await this.clientDocumentService.updateDocument(
        idValue.documentId,
        userId,
        validatedData
      );

      res.status(200).json(document);
    } catch (error: any) {
      logger.error('Update client document error:', error);
      if (error.message.includes('not found') || error.message.includes('unauthorized')) {
        res.status(404).json({ error: 'Not found', message: error.message });
      } else if (error.message.includes('does not belong')) {
        res.status(400).json({ error: 'Validation error', message: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error', message: error.message });
      }
    }
  };

  /**
   * Delete a document and its stored file
   * DELETE /api/clients/documents/:documentId
   */
  deleteDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
        return;
      }

      // Validate document ID parameter
      const { error: idError, value: idValue } = clientDocumentIdSchema.validate(req.params);
      if (idError) {
        res.status(400).json({ error: 'Validation error', details: idError.details });
        return;
      }

      await this.clientDocumentService.deleteDocument(idValue.documentId, userId);

      res.status(204).send();
    } catch (error: any) {
      logger.error('Delete client document error:', error);
      if (error.message.includes('not found') || error.message.includes('unauthorized')) {
        res.status(404).json({ error: 'Not found', message: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error', message: error.message });
      }
    }
  };
}

import { Router, Request, Response, NextFunction } from 'express';
import { ClientController } from '../../controllers/business/client.controller';
import { ClientDocumentController } from '../../controllers/business/clients/client-document.controller';
import { authenticateKeycloak, extractKeycloakUser } from '../../middleware/auth/keycloak.middleware';
import multer from 'multer';

// Configure multer for client document uploads (signed contracts and the like)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB limit — scanned contracts run large
  },
  fileFilter: (req, file, cb) => {
    // Allow PDFs, scans/photos and the common office document formats
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/msword', // .doc
      'application/vnd.oasis.opendocument.text', // .odt
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDFs, images and Word/ODT documents are allowed.'));
    }
  },
});

const router = Router();
const clientController = new ClientController();
const clientDocumentController = new ClientDocumentController();

// Apply Keycloak authentication to all routes
router.use(authenticateKeycloak);
router.use(extractKeycloakUser);

/**
 * @openapi
 * /api/clients:
 *   post:
 *     tags:
 *       - Clients
 *     summary: Create a new client
 *     description: Creates a new client record for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateClientDto'
 *     responses:
 *       201:
 *         description: Client created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Client'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/', clientController.create.bind(clientController));

/**
 * @openapi
 * /api/clients:
 *   get:
 *     tags:
 *       - Clients
 *     summary: Get all clients
 *     description: Retrieves all clients for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of clients retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Client'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', clientController.findAll.bind(clientController));

/**
 * Client document routes
 *
 * Deliberately NOT annotated with @openapi. Every annotated route is turned
 * into a callable LLM tool by openapi-tool-builder.service, and /clients is not
 * in its BLOCKED_PREFIXES — documenting these would hand the AI assistant the
 * ability to upload, overwrite and delete signed contracts. Plain comments keep
 * them out of the tool surface while staying readable here.
 *
 * The literal /documents/... paths are registered before the /:id routes below
 * so the literal segment always wins over the parameter.
 */

// Get single document metadata
router.get('/documents/:documentId', clientDocumentController.getDocumentById);

// Download a document's file
router.get('/documents/:documentId/download', clientDocumentController.downloadDocument);

// Update a document's metadata (the stored file is immutable)
router.put('/documents/:documentId', clientDocumentController.updateDocument);

// Delete a document and its stored file
router.delete('/documents/:documentId', clientDocumentController.deleteDocument);

// List a client's documents (filters: project_id, document_type)
router.get('/:id/documents', clientDocumentController.getDocuments);

/**
 * Turns multer's rejections into 400s.
 *
 * Without this, an oversized or wrong-typed upload reaches the app-level error
 * handler and surfaces as a 500 — telling the user the server broke when they
 * simply picked a 30 MB file or a .zip.
 */
const handleUploadErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  upload.single('document')(req, res, (err: any) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'File is too large. The maximum size is 25 MB.'
          : `Upload failed: ${err.message}`;
      res.status(400).json({ error: 'Bad request', message });
      return;
    }

    // The fileFilter rejects unsupported types with a plain Error.
    res.status(400).json({ error: 'Bad request', message: err.message });
  });
};

// Upload a document for a client
router.post('/:id/documents', handleUploadErrors, clientDocumentController.uploadDocument);

/**
 * @openapi
 * /api/clients/{id}:
 *   get:
 *     tags:
 *       - Clients
 *     summary: Get a client by ID
 *     description: Retrieves a specific client by their ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Client ID
 *     responses:
 *       200:
 *         description: Client retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Client'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/:id', clientController.findById.bind(clientController));

/**
 * @openapi
 * /api/clients/{id}:
 *   put:
 *     tags:
 *       - Clients
 *     summary: Update a client
 *     description: Updates an existing client's information
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Client ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateClientDto'
 *     responses:
 *       200:
 *         description: Client updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Client'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/:id', clientController.update.bind(clientController));

/**
 * @openapi
 * /api/clients/{id}:
 *   delete:
 *     tags:
 *       - Clients
 *     summary: Delete a client
 *     description: Deletes a client and all associated data (projects, time entries, invoices)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Client ID
 *     responses:
 *       200:
 *         description: Client deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Client deleted successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/:id', clientController.delete.bind(clientController));

export default router;

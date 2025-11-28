import { Router } from 'express';
import { InvoiceController } from '../../controllers/financial/invoice.controller';
import { authenticateKeycloak, extractKeycloakUser } from '../../middleware/auth/keycloak.middleware';
import { PaymentController } from '../../controllers/financial/payment.controller';

const router = Router();
const invoiceController = new InvoiceController();
const paymentController = new PaymentController();

// Apply Keycloak authentication to all routes
router.use(authenticateKeycloak);
router.use(extractKeycloakUser);

/**
 * @openapi
 * /api/invoices:
 *   post:
 *     tags:
 *       - Invoices
 *     summary: Create a new invoice
 *     description: Creates a new invoice for a client
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [client_id, invoice_number, issue_date, due_date]
 *             properties:
 *               client_id:
 *                 type: string
 *                 format: uuid
 *               project_id:
 *                 type: string
 *                 format: uuid
 *               invoice_number:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [draft, sent, paid, overdue, cancelled]
 *                 default: draft
 *               issue_date:
 *                 type: string
 *                 format: date
 *               due_date:
 *                 type: string
 *                 format: date
 *               tax_rate:
 *                 type: number
 *                 format: decimal
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Invoice created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Invoice'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/', invoiceController.create.bind(invoiceController));

/**
 * @openapi
 * /api/invoices:
 *   get:
 *     tags:
 *       - Invoices
 *     summary: Get all invoices
 *     description: Retrieves all invoices for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: client_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by client ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, sent, paid, overdue, cancelled]
 *         description: Filter by invoice status
 *     responses:
 *       200:
 *         description: List of invoices retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Invoice'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', invoiceController.findAll.bind(invoiceController));

/**
 * @openapi
 * /api/invoices/{id}/billing-status:
 *   get:
 *     tags:
 *       - Invoices
 *     summary: Get billing validation status for an invoice
 *     description: Validates invoice billing, checking for overbilling, underbilling, and duplicate payments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice ID
 *       - in: query
 *         name: threshold
 *         schema:
 *           type: number
 *           format: decimal
 *           default: 1.50
 *         description: Acceptable variance threshold in EUR/USD (default 1.50)
 *     responses:
 *       200:
 *         description: Billing validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 invoice_id:
 *                   type: string
 *                   format: uuid
 *                 invoice_total:
 *                   type: number
 *                 total_paid:
 *                   type: number
 *                 balance:
 *                   type: number
 *                 status:
 *                   type: string
 *                   enum: [valid, underbilled, overbilled]
 *                 warnings:
 *                   type: array
 *                   items:
 *                     type: string
 *                 threshold:
 *                   type: number
 *                 currency:
 *                   type: string
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/:id/billing-status', invoiceController.getBillingStatus.bind(invoiceController));

/**
 * @openapi
 * /api/invoices/{id}/validate-payment:
 *   post:
 *     tags:
 *       - Invoices
 *     summary: Validate a proposed payment before recording
 *     description: Checks if a payment amount would cause overbilling beyond threshold
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount:
 *                 type: number
 *                 format: decimal
 *                 description: Proposed payment amount
 *               threshold:
 *                 type: number
 *                 format: decimal
 *                 default: 1.50
 *               strict:
 *                 type: boolean
 *                 default: false
 *                 description: If true, rejects payments causing overbilling
 *     responses:
 *       200:
 *         description: Payment validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 isValid:
 *                   type: boolean
 *                 warnings:
 *                   type: array
 *                   items:
 *                     type: string
 *                 projectedBalance:
 *                   type: number
 *                 projectedStatus:
 *                   type: string
 *                   enum: [valid, underbilled, overbilled]
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/:id/validate-payment', invoiceController.validateProposedPayment.bind(invoiceController));

/**
 * @openapi
 * /api/invoices/{id}:
 *   get:
 *     tags:
 *       - Invoices
 *     summary: Get an invoice by ID
 *     description: Retrieves a specific invoice by its ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice ID
 *     responses:
 *       200:
 *         description: Invoice retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Invoice'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', invoiceController.findAll.bind(invoiceController));

/**
 * @openapi
 * /api/invoices/placeholders:
 *   get:
 *     tags:
 *       - Invoices
 *     summary: Get available placeholders
 *     description: Returns a list of all available placeholders for invoice templates with descriptions and examples
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: language
 *         schema:
 *           type: string
 *           enum: [en, de]
 *           default: en
 *         description: Language for month names and date formatting
 *     responses:
 *       200:
 *         description: Placeholders retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   placeholder:
 *                     type: string
 *                     example: "{{month-1}}"
 *                   description:
 *                     type: string
 *                     example: "Previous month name"
 *                   example:
 *                     type: string
 *                     example: "September"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/placeholders', invoiceController.getPlaceholders.bind(invoiceController));

/**
 * @openapi
 * /api/invoices/{id}:
 *   get:
 *     tags:
 *       - Invoices
 *     summary: Get invoice by ID
 *     description: Retrieves a single invoice with all details including client information and line items
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice ID
 *     responses:
 *       200:
 *         description: Invoice found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 invoice_number:
 *                   type: string
 *                 client_id:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   enum: [draft, sent, paid, overdue, cancelled]
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/:id', invoiceController.findById.bind(invoiceController));

/**
 * @openapi
 * /api/invoices/:id:
 *   put:
 *     tags:
 *       - Invoices
 *     summary: Update an invoice
 *     description: Updates an existing invoice
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [draft, sent, paid, overdue, cancelled]
 *               issue_date:
 *                 type: string
 *                 format: date
 *               due_date:
 *                 type: string
 *                 format: date
 *               tax_rate:
 *                 type: number
 *                 format: decimal
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Invoice updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Invoice'
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
router.put('/:id', invoiceController.update.bind(invoiceController));

/**
 * @openapi
 * /api/invoices/{id}/cancel:
 *   patch:
 *     tags:
 *       - Invoices
 *     summary: Cancel an invoice
 *     description: Cancels an invoice by setting its status to 'cancelled'. Cannot cancel already cancelled invoices.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice ID
 *     responses:
 *       200:
 *         description: Invoice cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Invoice cancelled successfully
 *                 invoice:
 *                   $ref: '#/components/schemas/Invoice'
 *       400:
 *         description: Invoice is already cancelled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Invoice is already cancelled
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.patch('/:id/cancel', invoiceController.cancel.bind(invoiceController));

/**
 * @openapi
 * /api/invoices/{id}:
 *   delete:
 *     tags:
 *       - Invoices
 *     summary: Delete an invoice
 *     description: Deletes an invoice
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice ID
 *     responses:
 *       200:
 *         description: Invoice deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Invoice deleted successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/:id', invoiceController.delete.bind(invoiceController));

/**
 * @openapi
 * /api/invoices/{id}/items:
 *   post:
 *     tags:
 *       - Invoices
 *     summary: Add line items to an invoice
 *     description: Adds one or more line items to an existing invoice
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [description, quantity, unit_price]
 *                   properties:
 *                     description:
 *                       type: string
 *                     quantity:
 *                       type: number
 *                       format: decimal
 *                     unit_price:
 *                       type: number
 *                       format: decimal
 *                     time_entry_id:
 *                       type: string
 *                       format: uuid
 *     responses:
 *       200:
 *         description: Line items added successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Invoice'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/:id/items', invoiceController.addLineItems.bind(invoiceController));

/**
 * @openapi
 * /api/invoices/{id}/items:
 *   put:
 *     tags:
 *       - Invoices
 *     summary: Replace all line items for an invoice
 *     description: Deletes all existing line items and adds new ones
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/InvoiceLineItem'
 *     responses:
 *       200:
 *         description: Line items replaced successfully
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.put('/:id/items', invoiceController.replaceLineItems.bind(invoiceController));

/**
 * @openapi
 * /api/invoices/generate-from-time-entries:
 *   post:
 *     tags:
 *       - Invoices
 *     summary: Generate invoice from time entries
 *     description: Automatically generates an invoice from selected time entries
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [client_id, time_entry_ids]
 *             properties:
 *               client_id:
 *                 type: string
 *                 format: uuid
 *               project_id:
 *                 type: string
 *                 format: uuid
 *               time_entry_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *               issue_date:
 *                 type: string
 *                 format: date
 *               due_date:
 *                 type: string
 *                 format: date
 *               tax_rate:
 *                 type: number
 *                 format: decimal
 *     responses:
 *       201:
 *         description: Invoice generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Invoice'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/generate-from-time-entries', invoiceController.generateFromTimeEntries.bind(invoiceController));

/**
 * @openapi
 * /api/invoices/client/{client_id}/history:
 *   get:
 *     tags:
 *       - Invoices
 *     summary: Get billing history for a client
 *     description: Retrieves all invoices for a specific client
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: client_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Client ID
 *     responses:
 *       200:
 *         description: Billing history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Invoice'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/client/:client_id/history', invoiceController.getBillingHistory.bind(invoiceController));

/**
 * @openapi
 * /api/invoices/number/{invoice_number}:
 *   get:
 *     tags:
 *       - Invoices
 *     summary: Find invoice by invoice number
 *     description: Retrieves an invoice by its unique invoice number
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invoice_number
 *         required: true
 *         schema:
 *           type: string
 *         description: Invoice number
 *     responses:
 *       200:
 *         description: Invoice retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Invoice'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/number/:invoice_number', invoiceController.findByNumber.bind(invoiceController));

/**
 * @openapi
 * /api/invoices/{id}/payments:
 *   get:
 *     tags:
 *       - Invoices
 *     summary: Get all payments for an invoice
 *     description: Retrieves payment history for a specific invoice
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice ID
 *     responses:
 *       200:
 *         description: Payment history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   invoice_id:
 *                     type: string
 *                     format: uuid
 *                   amount:
 *                     type: number
 *                     format: decimal
 *                   payment_method:
 *                     type: string
 *                   payment_date:
 *                     type: string
 *                     format: date
 *                   transaction_id:
 *                     type: string
 *                   notes:
 *                     type: string
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/:id/payments', (req: any, res: any) => {
  // Delegate to PaymentController with modified params
  req.params.invoice_id = req.params.id;
  return paymentController.getPaymentsByInvoice(req, res);
});

/**
 * @openapi
 * /api/invoices/{id}/pdf:
 *   get:
 *     tags:
 *       - Invoices
 *     summary: Generate and download invoice PDF
 *     description: Generates a professional PDF document for the specified invoice
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Invoice ID
 *     responses:
 *       200:
 *         description: PDF generated successfully
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/:id/pdf', invoiceController.generatePDF.bind(invoiceController));

export default router;

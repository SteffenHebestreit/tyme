import { Request, Response, NextFunction } from 'express';
// Assuming we will have a PaymentService
// import { PaymentService } from '../services/payment.service'; 
import { getDbClient } from '../../utils/database';
import { BillingValidationService } from '../../services/financial/billing-validation.service';

// Joi Validation Schemas
import {
  createPaymentSchema,
  updatePaymentSchema,
  getPaymentByIdParamsSchema,
  getPaymentsByInvoiceParamsSchema,
  paymentIdSchema as validatePaymentId, // Corrected alias for the schema named in payment.schema.ts
} from '../../schemas/financial/payment.schema';

const validate = (schema: any) => (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body || {}, { abortEarly: false });
    if (error) {
        const errorMessage = error.details.map((detail: any) => detail.message).join(', ');
        res.status(400).json({ message: 'Validation failed', details: errorMessage });
        return;
    }
    next();
};

const validateParams = (schema: any, target: 'params' | 'query' = 'params') => (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req[target], { abortEarly: false });
    if (error) {
        const errorMessage = error.details.map((detail: any) => detail.message).join(', ');
        res.status(400).json({ message: 'Validation failed', details: errorMessage });
        return;
    }
    next();
};

// Placeholder for now, direct DB queries due to lack of dedicated service layer initially

export class PaymentController {
  private billingValidationService: BillingValidationService;

  constructor() {
    this.billingValidationService = new BillingValidationService();
  }

  private get db() {
    return getDbClient();
  }

  // Create a new payment record
  async create(req: Request, res: Response) {
    const validatedBody = req.body; // Joi schema will validate all required fields
    
    console.log('=== Payment Creation Debug ===');
    console.log('Request body:', JSON.stringify(validatedBody, null, 2));
    console.log('client_id:', validatedBody.client_id);
    console.log('invoice_id:', validatedBody.invoice_id);
    console.log('project_id:', validatedBody.project_id);
    console.log('payment_type:', validatedBody.payment_type);
    
    // Manual validation specific to this endpoint's logic
    if (!validatedBody.client_id) {
        res.status(400).json({ message: 'Client ID is required.' });
        return;
    }

    // Require either invoice_id OR project_id for payments (not refunds)
    if (validatedBody.payment_type === 'payment' && !validatedBody.invoice_id && !validatedBody.project_id) {
        res.status(400).json({ message: 'Either invoice_id or project_id is required for payment type.' });
        return;
    }

    // Refunds must have invoice_id
    if (validatedBody.payment_type === 'refund' && !validatedBody.invoice_id) {
        res.status(400).json({ message: 'Invoice ID is required for refund type.' });
        return;
    }
    
    const { client_id, invoice_id, project_id, amount, payment_type = 'payment', payment_method, transaction_id, payment_date, notes, exclude_from_tax } = validatedBody;

    // Validate invoice if provided (ensure it belongs to client and user has access)
    let invoiceProjectId = project_id; // Start with provided project_id
    if (invoice_id) {
      const validateInvoice = await this.db.query(
        `SELECT i.id, i.project_id FROM invoices i WHERE i.id = $1 AND i.client_id = $2 AND i.user_id = $3`,
        [invoice_id, client_id, (req as any).user?.id]
      );
      if (validateInvoice.rows.length === 0) {
          res.status(404).json({ message: 'Invoice not found or does not belong to the specified client for this user.' });
          return;
      }
      // Automatically use the invoice's project_id if not explicitly provided
      if (!invoiceProjectId && validateInvoice.rows[0].project_id) {
        invoiceProjectId = validateInvoice.rows[0].project_id;
        console.log('Auto-assigned project_id from invoice:', invoiceProjectId);
      }
    }

    // Validate project if provided (ensure it belongs to client and user has access)
    if (project_id) {
      const validateProject = await this.db.query(
        `SELECT p.id FROM projects p WHERE p.id = $1 AND p.client_id = $2 AND p.user_id = $3`,
        [project_id, client_id, (req as any).user?.id]
      );
      if (validateProject.rows.length === 0) {
          res.status(404).json({ message: 'Project not found or does not belong to the specified client for this user.' });
          return;
      }
    }

    try {
      const queryText = `
        INSERT INTO payments (
          user_id, client_id, invoice_id, project_id, amount, payment_type, payment_method, transaction_id, payment_date, notes, exclude_from_tax
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, user_id, client_id, invoice_id, project_id, amount, payment_type, payment_method, transaction_id, payment_date, notes, exclude_from_tax, created_at
      `;
      const values = [
        (req as any).user?.id,
        client_id,
        invoice_id || null,
        invoiceProjectId || null, // Use the resolved project_id from invoice or provided value
        Number(amount),
        payment_type,
        payment_method || null,
        transaction_id || null,
        payment_date ? new Date(payment_date) : new Date(), // Default to today if not provided
        notes || null,
        exclude_from_tax || false
      ];
      
      const result = await this.db.query(queryText, values); // record the payment first
      
      // After recording a payment, update the invoice status (only if invoice_id is provided)
      const paymentRecord = result.rows[0];
      
      // Only validate billing status and update invoice status if this payment is linked to an invoice
      if (paymentRecord.invoice_id) {
        // Validate billing status after payment
        let billingValidation;
        try {
          billingValidation = await this.billingValidationService.validateInvoice(paymentRecord.invoice_id);
        } catch (validationError) {
          console.error('Billing validation error:', validationError);
          // Don't fail the payment creation if validation fails
          billingValidation = null;
        }
        
        // Calculate total paid for this specific invoice
        // Add payments, subtract refunds and expenses
        const totalPaidQuery = `
          SELECT COALESCE(SUM(
            CASE 
              WHEN p.payment_type = 'payment' THEN p.amount 
              ELSE -p.amount 
            END
          ), 0) as total_paid 
          FROM payments p WHERE p.invoice_id = $1
        `;
        const totalPaidResult = await this.db.query(totalPaidQuery, [paymentRecord.invoice_id]);
        const totalPaid = Number(totalPaidResult.rows[0].total_paid);

        // Get invoice details to determine new status and due date check
        const invoiceDetailsQuery = `
          SELECT id, total_amount, due_date FROM invoices WHERE id = $1
        `;
        const invoiceDetailsResult = await this.db.query(invoiceDetailsQuery, [paymentRecord.invoice_id]);
        
        if (invoiceDetailsResult.rows.length > 0) {
            const invoiceTotal = Number(invoiceDetailsResult.rows[0].total_amount);
            const dueDate = new Date(invoiceDetailsResult.rows[0].due_date);
            const today = new Date();
            
            let newStatus: string;
            if (totalPaid >= invoiceTotal && totalPaid > 0) {
                // Fully paid
                newStatus = 'paid';
            } else if (totalPaid > 0 && totalPaid < invoiceTotal) {
                // Partially paid
                newStatus = 'partially_paid';
            } else if (today > dueDate && totalPaid < invoiceTotal) {
                // Overdue and not fully paid
                newStatus = 'overdue';
            } else {
                // Not paid or minimal payment
                newStatus = 'sent';
            }

            // Update invoice status
            await this.db.query(
              `UPDATE invoices SET status = $1 WHERE id = $2`,
              [newStatus, paymentRecord.invoice_id]
            );
        }
        
        // Prepare response with billing validation warnings
        const response: any = {
          message: 'Payment recorded successfully',
          payment: paymentRecord,
        };

        if (billingValidation) {
          response.billing_status = {
            status: billingValidation.status,
            balance: billingValidation.balance,
            warnings: billingValidation.warnings,
          };

          // Add alert if overbilled
          if (billingValidation.status === 'overbilled') {
            response.alert = {
              level: 'warning',
              message: `Invoice is now overbilled by ${Math.abs(billingValidation.balance).toFixed(2)} ${billingValidation.currency}. Please review payment records.`,
            };
          }
        }

        res.status(201).json(response);
      } else {
        // For recurring payments without invoice, just return the payment record
        res.status(201).json({
          message: 'Payment recorded successfully',
          payment: paymentRecord,
        });
      }

    } catch (err: any) {
      console.error('Create payment error:', err);
      console.error('Error details:', {
        code: err.code,
        detail: err.detail,
        constraint: err.constraint,
        table: err.table
      });
      
      // Handle specific PostgreSQL constraint violations
      if (err.code === '23514' && err.constraint === 'payments_invoice_or_recurring') {
        res.status(400).json({ 
          message: 'Payment validation failed. For regular payments, either invoice_id or both client_id and project_id are required. For refunds, invoice_id is required.',
          details: err.detail
        });
        return;
      }
      
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  // Get all payments for a user
  async findAll(req: Request, res: Response) {
    try {
        const queryText = `
          SELECT p.id, p.user_id, p.client_id, p.invoice_id, p.project_id, p.amount, p.payment_type,
                 p.payment_method, p.transaction_id, p.payment_date, p.notes, p.exclude_from_tax, p.created_at,
                 c.name as client_name,
                 i.invoice_number
          FROM payments p 
          LEFT JOIN clients c ON p.client_id = c.id AND c.user_id = $1
          LEFT JOIN invoices i ON p.invoice_id = i.id AND i.user_id = $1
          WHERE p.user_id = $1 ORDER BY p.payment_date DESC, p.created_at DESC
        `;
        const result = await this.db.query(queryText, [(req as any).user?.id]);
        res.status(200).json(result.rows);
    } catch (err: any) {
      console.error('Find all payments error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  // Get a specific payment by ID
  async findById(req: Request, res: Response) {
    // Params validation is done by Joi schema
    const { id } = req.params; 

    try {
      const queryText = `
        SELECT p.id, p.user_id, p.client_id, p.invoice_id, p.amount, p.payment_type,
               p.payment_method, p.transaction_id, p.payment_date, p.notes, p.created_at
        FROM payments p WHERE p.id = $1 AND p.user_id = $2
      `;
      const result = await this.db.query(queryText, [id, (req as any).user?.id]);
      
      if (result.rows.length === 0) {
          res.status(404).json({ message: 'Payment not found.' });
          return;
      }
      res.status(200).json(result.rows[0]);

    } catch (err: any) {
      console.error('Find payment by ID error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  // Update a payment record
  async update(req: Request, res: Response) {
    // Params validation is done by Joi schema
    const { id } = req.params;

    // Body validation is done by Joi schema
    const validatedBody = req.body;
    const { client_id, amount, payment_type, payment_method, transaction_id, payment_date, notes, exclude_from_tax } = validatedBody; 

    let setParts = [];
    let values: any[] = [];

    if (client_id !== undefined) {
        setParts.push(`client_id = $${values.length + 1}`); 
        values.push(client_id);
    }
    if (amount !== undefined) {
        setParts.push(`amount = $${values.length + 1}`);
        values.push(Number(amount));
    }
    if (payment_type !== undefined) {
        setParts.push(`payment_type = $${values.length + 1}`);
        values.push(payment_type);
    }
    if (payment_method !== undefined) {
        setParts.push(`payment_method = $${values.length + 1}`);
        values.push(payment_method || null);
    }
    if (transaction_id !== undefined) {
        setParts.push(`transaction_id = $${values.length + 1}`); 
        values.push(transaction_id || null);
    }
    if (payment_date !== undefined) {
        setParts.push(`payment_date = $${values.length + 1}`);
        values.push(payment_date ? new Date(payment_date) : null);
    }
    if (notes !== undefined) {
        setParts.push(`notes = $${values.length + 1}`); 
        values.push(notes || null);
    }
    if (exclude_from_tax !== undefined) {
        setParts.push(`exclude_from_tax = $${values.length + 1}`); 
        values.push(exclude_from_tax);
    }

    if (setParts.length === 0) {
        res.status(400).json({ message: 'No fields to update.' });
        return;
    }
    
    values.push(id); // For WHERE id = $x
    const queryText = `
      UPDATE payments 
      SET ${setParts.join(', ')}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $${values.length} AND user_id = $${values.length + 1}
      RETURNING id, user_id, client_id, invoice_id, amount, payment_type, payment_method, transaction_id, payment_date, notes, exclude_from_tax, created_at
    `;
    values.push((req as any).user?.id);

    try {
        const result = await this.db.query(queryText, values);
        if (result.rows.length === 0) {
            res.status(404).json({ message: 'Payment not found or no access.' });
            return;
        }
        res.status(200).json({
          message: 'Payment updated successfully',
          payment: result.rows[0]
        });
    } catch (err: any) {
      console.error('Update payment error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  // Delete a payment record
  async delete(req: Request, res: Response) {
    // Params validation is done by Joi schema
    const { id } = req.params; 

    try {
      const queryText = `DELETE FROM payments WHERE id = $1 AND user_id = $2`;
      const result = await this.db.query(queryText, [id, (req as any).user?.id]);
      
      if ((result.rowCount ?? 0) > 0) {
        res.status(200).json({ message: 'Payment deleted successfully' });
      } else {
        res.status(404).json({ message: 'Payment not found or no access.' });
      }
    } catch (err: any) {
      console.error('Delete payment error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

  // Get payments for a specific invoice
  async getPaymentsByInvoice(req: Request, res: Response) {
    // Params validation is done by Joi schema
    const { invoice_id } = req.params; 
    
    // Validate that user has access to this invoice
      const validateInvoice = await this.db.query(
        `SELECT i.id FROM invoices i WHERE i.id = $1 AND i.user_id = $2`,
        [invoice_id, (req as any).user?.id]
      );
      if (validateInvoice.rows.length === 0) {
          res.status(404).json({ message: 'Invoice not found for this user.' });
          return;
      }

    try {
      const queryText = `
        SELECT p.id, p.user_id, p.client_id, p.invoice_id, p.amount, p.payment_type,
               p.payment_method, p.transaction_id, p.payment_date, p.notes, p.created_at
        FROM payments p 
        WHERE p.invoice_id = $1 AND p.user_id = $2
        ORDER BY p.created_at DESC
      `;
      const result = await this.db.query(queryText, [invoice_id, (req as any).user?.id]);
      res.status(200).json(result.rows);
    } catch (err: any) {
      console.error('Get payments by invoice error:', err);
      res.status(500).json({ message: err.message || 'Internal server error' });
    }
  }

}

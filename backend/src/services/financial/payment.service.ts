import { getDbClient } from '../../utils/database';

export interface CreatePaymentDto {
  user_id: string;
  client_id?: string;
  invoice_id?: string;
  project_id?: string;
  amount: number;
  payment_type?: 'payment' | 'refund' | 'expense';
  payment_method: string;
  transaction_id?: string;
  payment_date: Date;
  notes?: string;
}

export interface UpdatePaymentDto {
  amount?: number;
  payment_method?: string;
  transaction_id?: string;
  payment_date?: Date;
  notes?: string;
}

export interface Payment {
  id: string;
  user_id: string;
  client_id: string;
  invoice_id?: string;
  project_id?: string;
  amount: number;
  payment_type: 'payment' | 'refund' | 'expense';
  payment_method: string;
  transaction_id?: string;
  payment_date: Date;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Service for managing payments.
 * Provides CRUD operations for payment records.
 */
export class PaymentService {
  private db = getDbClient();

  /**
   * Creates a new payment record.
   */
  async create(paymentData: CreatePaymentDto): Promise<Payment> {
    const query = `
      INSERT INTO payments (
        user_id, client_id, invoice_id, project_id, amount, 
        payment_type, payment_method, transaction_id, payment_date, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      paymentData.user_id,
      paymentData.client_id || null,
      paymentData.invoice_id || null,
      paymentData.project_id || null,
      paymentData.amount,
      paymentData.payment_type || 'payment',
      paymentData.payment_method,
      paymentData.transaction_id || null,
      paymentData.payment_date,
      paymentData.notes || null,
    ];

    const result = await this.db.query(query, values);
    return result.rows[0] as Payment;
  }

  /**
   * Retrieves all payments for a user.
   */
  async findAllByUser(userId: string): Promise<Payment[]> {
    const query = `
      SELECT * FROM payments 
      WHERE user_id = $1 
      ORDER BY payment_date DESC, created_at DESC
    `;
    const result = await this.db.query(query, [userId]);
    return result.rows as Payment[];
  }

  /**
   * Retrieves payments for a specific invoice.
   */
  async findByInvoiceId(invoiceId: string): Promise<Payment[]> {
    const query = `
      SELECT * FROM payments 
      WHERE invoice_id = $1 
      ORDER BY payment_date DESC, created_at DESC
    `;
    const result = await this.db.query(query, [invoiceId]);
    return result.rows as Payment[];
  }

  /**
   * Retrieves a payment by ID.
   */
  async findById(id: string, userId: string): Promise<Payment | null> {
    const query = `
      SELECT * FROM payments 
      WHERE id = $1 AND user_id = $2
    `;
    const result = await this.db.query(query, [id, userId]);
    return result.rows.length > 0 ? (result.rows[0] as Payment) : null;
  }

  /**
   * Updates a payment record.
   */
  async update(id: string, userId: string, updateData: UpdatePaymentDto): Promise<Payment | null> {
    const setParts: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updateData.amount !== undefined) {
      setParts.push(`amount = $${paramIndex++}`);
      values.push(updateData.amount);
    }
    if (updateData.payment_method !== undefined) {
      setParts.push(`payment_method = $${paramIndex++}`);
      values.push(updateData.payment_method);
    }
    if (updateData.transaction_id !== undefined) {
      setParts.push(`transaction_id = $${paramIndex++}`);
      values.push(updateData.transaction_id);
    }
    if (updateData.payment_date !== undefined) {
      setParts.push(`payment_date = $${paramIndex++}`);
      values.push(updateData.payment_date);
    }
    if (updateData.notes !== undefined) {
      setParts.push(`notes = $${paramIndex++}`);
      values.push(updateData.notes);
    }

    if (setParts.length === 0) {
      return this.findById(id, userId);
    }

    setParts.push('updated_at = NOW()');

    const query = `
      UPDATE payments 
      SET ${setParts.join(', ')}
      WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
      RETURNING *
    `;
    values.push(id, userId);

    const result = await this.db.query(query, values);
    return result.rows.length > 0 ? (result.rows[0] as Payment) : null;
  }

  /**
   * Deletes a payment record.
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const query = `
      DELETE FROM payments 
      WHERE id = $1 AND user_id = $2
    `;
    const result = await this.db.query(query, [id, userId]);
    return result.rowCount !== null && result.rowCount > 0;
  }
}

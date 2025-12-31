import { PaymentService, Payment } from '../../src/services/financial/payment.service';
import { InvoiceService } from '../../src/services/financial/invoice.service';
import { ClientService } from '../../src/services/business/client.service';
import { TEST_USER_ID } from '../setup';

describe('PaymentService', () => {
  let paymentService: PaymentService;
  let invoiceService: InvoiceService;
  let clientService: ClientService;
  let testClientId: string;
  let testInvoiceId: string;

  beforeAll(async () => {
    paymentService = new PaymentService();
    invoiceService = new InvoiceService();
    clientService = new ClientService();

    const testClient = await clientService.create({
      user_id: TEST_USER_ID,
      name: 'Payment Test Client',
    });
    testClientId = testClient.id;

    const testInvoice = await invoiceService.create({
      user_id: TEST_USER_ID,
      client_id: testClientId,
      issue_date: new Date(),
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    testInvoiceId = testInvoice.id;
  });

  describe('create', () => {
    it('should create a payment with all required fields', async () => {
      const payment = await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: testInvoiceId,
        amount: 100.00,
        payment_method: 'bank_transfer',
        payment_date: new Date(),
      });

      expect(payment).toBeDefined();
      expect(payment.id).toBeDefined();
      expect(Number(payment.amount)).toBe(100);
      expect(payment.payment_method).toBe('bank_transfer');
      expect(payment.payment_type).toBe('payment');
    });

    it('should create a payment with optional fields', async () => {
      const payment = await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: testInvoiceId,
        amount: 250.50,
        payment_method: 'credit_card',
        payment_date: new Date(),
        transaction_id: 'TXN-12345',
        notes: 'Partial payment for services',
      });

      expect(payment.transaction_id).toBe('TXN-12345');
      expect(payment.notes).toBe('Partial payment for services');
    });

    it('should create a refund payment', async () => {
      const payment = await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: testInvoiceId,
        amount: 50.00,
        payment_type: 'refund',
        payment_method: 'bank_transfer',
        payment_date: new Date(),
      });

      expect(payment.payment_type).toBe('refund');
      expect(Number(payment.amount)).toBe(50);
    });

    it('should create a payment without invoice', async () => {
      const payment = await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        amount: 75.00,
        payment_method: 'cash',
        payment_date: new Date(),
      });

      expect(payment).toBeDefined();
      expect(payment.invoice_id).toBeNull();
    });
  });

  describe('findAllByUser', () => {
    it('should return all payments for a user', async () => {
      // Create some payments
      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        amount: 100,
        payment_method: 'bank_transfer',
        payment_date: new Date(),
      });

      const payments = await paymentService.findAllByUser(TEST_USER_ID);

      expect(payments.length).toBeGreaterThanOrEqual(1);
      payments.forEach(payment => {
        expect(payment.user_id).toBe(TEST_USER_ID);
      });
    });

    it('should return empty array for user with no payments', async () => {
      const payments = await paymentService.findAllByUser('00000000-0000-0000-0000-000000000001');
      expect(payments).toEqual([]);
    });
  });

  describe('findByInvoiceId', () => {
    it('should return payments for a specific invoice', async () => {
      // Create a new invoice for this test
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(),
      });

      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 300,
        payment_method: 'bank_transfer',
        payment_date: new Date(),
      });

      const payments = await paymentService.findByInvoiceId(invoice.id);

      expect(payments.length).toBe(1);
      expect(payments[0].invoice_id).toBe(invoice.id);
      expect(Number(payments[0].amount)).toBe(300);
    });

    it('should return empty array for invoice with no payments', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(),
      });

      const payments = await paymentService.findByInvoiceId(invoice.id);
      expect(payments).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should return payment if found', async () => {
      const created = await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        amount: 150,
        payment_method: 'bank_transfer',
        payment_date: new Date(),
      });

      const found = await paymentService.findById(created.id, TEST_USER_ID);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(Number(found?.amount)).toBe(150);
    });

    it('should return null if payment not found', async () => {
      const found = await paymentService.findById('00000000-0000-0000-0000-000000000000', TEST_USER_ID);
      expect(found).toBeNull();
    });

    it('should return null for different user', async () => {
      const created = await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        amount: 200,
        payment_method: 'bank_transfer',
        payment_date: new Date(),
      });

      const found = await paymentService.findById(created.id, '00000000-0000-0000-0000-000000000001');
      expect(found).toBeNull();
    });
  });

  describe('update', () => {
    it('should update payment amount', async () => {
      const created = await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        amount: 100,
        payment_method: 'bank_transfer',
        payment_date: new Date(),
      });

      const updated = await paymentService.update(created.id, TEST_USER_ID, {
        amount: 150,
      });

      expect(updated).toBeDefined();
      expect(Number(updated?.amount)).toBe(150);
    });

    it('should update multiple fields', async () => {
      const created = await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        amount: 100,
        payment_method: 'bank_transfer',
        payment_date: new Date(),
      });

      const updated = await paymentService.update(created.id, TEST_USER_ID, {
        amount: 200,
        payment_method: 'credit_card',
        transaction_id: 'NEW-TXN-123',
        notes: 'Updated payment',
      });

      expect(Number(updated?.amount)).toBe(200);
      expect(updated?.payment_method).toBe('credit_card');
      expect(updated?.transaction_id).toBe('NEW-TXN-123');
      expect(updated?.notes).toBe('Updated payment');
    });

    it('should return existing payment when no changes provided', async () => {
      const created = await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        amount: 100,
        payment_method: 'bank_transfer',
        payment_date: new Date(),
      });

      const updated = await paymentService.update(created.id, TEST_USER_ID, {});

      expect(updated).toBeDefined();
      expect(updated?.id).toBe(created.id);
    });

    it('should return null for non-existent ID', async () => {
      const updated = await paymentService.update(
        '00000000-0000-0000-0000-000000000000',
        TEST_USER_ID,
        { amount: 999 }
      );
      expect(updated).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a payment', async () => {
      const created = await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        amount: 100,
        payment_method: 'bank_transfer',
        payment_date: new Date(),
      });

      const result = await paymentService.delete(created.id, TEST_USER_ID);
      expect(result).toBe(true);

      const found = await paymentService.findById(created.id, TEST_USER_ID);
      expect(found).toBeNull();
    });

    it('should return false for non-existent ID', async () => {
      const result = await paymentService.delete('00000000-0000-0000-0000-000000000000', TEST_USER_ID);
      expect(result).toBe(false);
    });
  });
});

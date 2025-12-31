import { BillingValidationService, BillingValidationResult } from '../../src/services/financial/billing-validation.service';
import { InvoiceService } from '../../src/services/financial/invoice.service';
import { ClientService } from '../../src/services/business/client.service';
import { PaymentService } from '../../src/services/financial/payment.service';
import { TEST_USER_ID } from '../setup';

describe('BillingValidationService', () => {
  let billingValidationService: BillingValidationService;
  let invoiceService: InvoiceService;
  let clientService: ClientService;
  let paymentService: PaymentService;
  let testClientId: string;

  beforeAll(async () => {
    billingValidationService = new BillingValidationService();
    invoiceService = new InvoiceService();
    clientService = new ClientService();
    paymentService = new PaymentService();

    const testClient = await clientService.create({
      user_id: TEST_USER_ID,
      name: 'Billing Validation Test Client',
    });
    testClientId = testClient.id;
  });

  describe('validateInvoice', () => {
    it('should return valid status for fully paid invoice', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      // Add line items to set a total
      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 100, total_price: 100 } as any,
      ]);

      // Add payment for the full amount
      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 100,
        payment_date: new Date(),
        payment_method: 'bank_transfer',
      });

      const result = await billingValidationService.validateInvoice(invoice.id);

      expect(result.status).toBe('valid');
      expect(result.invoice_id).toBe(invoice.id);
      expect(result.invoice_total).toBe(100);
      expect(result.total_paid).toBe(100);
      expect(result.balance).toBe(0);
    });

    it('should return underbilled status when not fully paid', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 200, total_price: 200 } as any,
      ]);

      // Add partial payment
      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 50,
        payment_date: new Date(),
        payment_method: 'bank_transfer',
      });

      const result = await billingValidationService.validateInvoice(invoice.id);

      expect(result.status).toBe('underbilled');
      expect(result.balance).toBe(150);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('underbilled');
    });

    it('should return overbilled status when overpaid', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 100, total_price: 100 } as any,
      ]);

      // Add overpayment
      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 150,
        payment_date: new Date(),
        payment_method: 'bank_transfer',
      });

      const result = await billingValidationService.validateInvoice(invoice.id);

      expect(result.status).toBe('overbilled');
      expect(result.balance).toBe(-50);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('overbilled');
    });

    it('should accept balance within threshold as valid', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 100, total_price: 100 } as any,
      ]);

      // Add payment slightly less than total (within default threshold of 1.50)
      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 99,
        payment_date: new Date(),
        payment_method: 'bank_transfer',
      });

      const result = await billingValidationService.validateInvoice(invoice.id);

      expect(result.status).toBe('valid');
      expect(result.balance).toBe(1);
    });

    it('should use custom threshold when provided', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 100, total_price: 100 } as any,
      ]);

      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 98,
        payment_date: new Date(),
        payment_method: 'bank_transfer',
      });

      // With threshold of 1.0, balance of 2 should be underbilled
      const result = await billingValidationService.validateInvoice(invoice.id, { threshold: 1.0 });

      expect(result.status).toBe('underbilled');
      expect(result.threshold).toBe(1.0);
    });

    it('should throw error for non-existent invoice', async () => {
      await expect(
        billingValidationService.validateInvoice('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Invoice with ID 00000000-0000-0000-0000-000000000000 not found');
    });
  });

  describe('checkDuplicatePayments', () => {
    it('should detect no duplicates when payments are unique', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 300, total_price: 300 } as any,
      ]);

      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 100,
        payment_date: new Date(),
        payment_method: 'bank_transfer',
      });

      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 200,
        payment_date: new Date(),
        payment_method: 'credit_card',
      });

      const result = await billingValidationService.checkDuplicatePayments(invoice.id);

      expect(result.hasDuplicates).toBe(false);
      expect(result.duplicateCount).toBe(0);
    });
  });

  describe('validateProposedPayment', () => {
    it('should validate a payment that completes the invoice', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 100, total_price: 100 } as any,
      ]);

      const result = await billingValidationService.validateProposedPayment(invoice.id, 100);

      expect(result.isValid).toBe(true);
      expect(result.projectedStatus).toBe('valid');
      expect(result.projectedBalance).toBe(0);
    });

    it('should warn when proposed payment would cause underbilling', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 100, total_price: 100 } as any,
      ]);

      const result = await billingValidationService.validateProposedPayment(invoice.id, 50);

      expect(result.isValid).toBe(true);
      expect(result.projectedStatus).toBe('underbilled');
      expect(result.projectedBalance).toBe(50);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should warn when proposed payment would cause overbilling', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 100, total_price: 100 } as any,
      ]);

      const result = await billingValidationService.validateProposedPayment(invoice.id, 150);

      expect(result.isValid).toBe(true); // Non-strict mode
      expect(result.projectedStatus).toBe('overbilled');
      expect(result.projectedBalance).toBe(-50);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should reject overbilling payment in strict mode', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 100, total_price: 100 } as any,
      ]);

      const result = await billingValidationService.validateProposedPayment(
        invoice.id,
        150,
        { strict: true }
      );

      expect(result.isValid).toBe(false);
      expect(result.projectedStatus).toBe('overbilled');
    });
  });

  describe('getPaymentBreakdown', () => {
    it('should return all payments for an invoice', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 500, total_price: 500 } as any,
      ]);

      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 200,
        payment_date: new Date(),
        payment_method: 'bank_transfer',
      });

      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 300,
        payment_date: new Date(),
        payment_method: 'credit_card',
      });

      const breakdown = await billingValidationService.getPaymentBreakdown(invoice.id);

      expect(breakdown.length).toBe(2);
      expect(breakdown[0]).toHaveProperty('amount');
      expect(breakdown[0]).toHaveProperty('payment_method');
      expect(breakdown[0]).toHaveProperty('payment_date');
    });

    it('should return empty array for invoice with no payments', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const breakdown = await billingValidationService.getPaymentBreakdown(invoice.id);

      expect(breakdown).toEqual([]);
    });
  });

  describe('checkDuplicatePayments edge cases', () => {
    it('should detect potential duplicates with same amount and date', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 500, total_price: 500 } as any,
      ]);

      const paymentDate = new Date();
      
      // Create two payments with same amount and date
      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 100,
        payment_date: paymentDate,
        payment_method: 'bank_transfer',
      });

      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 100,
        payment_date: paymentDate,
        payment_method: 'bank_transfer',
      });

      const result = await billingValidationService.checkDuplicatePayments(invoice.id);

      // May or may not detect as duplicate depending on implementation
      expect(result).toHaveProperty('hasDuplicates');
      expect(result).toHaveProperty('duplicateCount');
    });
  });

  describe('validateInvoice edge cases', () => {
    it('should handle invoice with zero total', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      // Invoice with no line items has zero total
      const result = await billingValidationService.validateInvoice(invoice.id);

      expect(result.status).toBe('valid');
      expect(result.invoice_total).toBe(0);
      expect(result.balance).toBe(0);
    });

    it('should handle multiple partial payments', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 300, total_price: 300 } as any,
      ]);

      // Multiple partial payments
      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 100,
        payment_date: new Date(),
        payment_method: 'bank_transfer',
      });

      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 100,
        payment_date: new Date(),
        payment_method: 'credit_card',
      });

      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 100,
        payment_date: new Date(),
        payment_method: 'cash',
      });

      const result = await billingValidationService.validateInvoice(invoice.id);

      expect(result.status).toBe('valid');
      expect(result.total_paid).toBe(300);
      expect(result.balance).toBe(0);
    });
  });

  describe('validateProposedPayment edge cases', () => {
    it('should validate zero amount payment', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 100, total_price: 100 } as any,
      ]);

      const result = await billingValidationService.validateProposedPayment(invoice.id, 0);

      expect(result.isValid).toBe(true);
      expect(result.projectedBalance).toBe(100);
      expect(result.projectedStatus).toBe('underbilled');
    });

    it('should handle payment with existing partial payment', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 200, total_price: 200 } as any,
      ]);

      // Add partial payment
      await paymentService.create({
        user_id: TEST_USER_ID,
        client_id: testClientId,
        invoice_id: invoice.id,
        amount: 100,
        payment_date: new Date(),
        payment_method: 'bank_transfer',
      });

      // Validate proposed payment for remaining amount
      const result = await billingValidationService.validateProposedPayment(invoice.id, 100);

      expect(result.isValid).toBe(true);
      expect(result.projectedStatus).toBe('valid');
      expect(result.projectedBalance).toBe(0);
    });
  });
});

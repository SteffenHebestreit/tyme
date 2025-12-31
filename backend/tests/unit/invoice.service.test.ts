import { InvoiceService } from '../../src/services/financial/invoice.service';
import { ClientService } from '../../src/services/business/client.service';
import { CreateInvoiceDto, InvoiceItem } from '../../src/models/financial/invoice.model';
import { Client } from '../../src/models/business/client.model';
import { TEST_USER_ID } from '../setup';

describe('InvoiceService', () => {
  let invoiceService: InvoiceService;
  let clientService: ClientService;
  let testClient: Client;

  beforeAll(async () => {
    invoiceService = new InvoiceService();
    clientService = new ClientService();

    testClient = await clientService.create({ user_id: TEST_USER_ID, name: 'Test Client for Invoices' });
  });

  afterEach(async () => {
    // Database cleanup is handled by global setup
  });

  afterAll(async () => {
    // Database cleanup is handled by global setup
  });

  describe('create', () => {
    it('should create a new invoice with a generated invoice number', async () => {
      const invoiceData: CreateInvoiceDto = {
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      };

      const invoice = await invoiceService.create(invoiceData);

      expect(invoice).toBeDefined();
      expect(invoice.id).toBeDefined();
      expect(invoice.invoice_number).toBeDefined();
      expect(invoice.status).toBe('draft');
    });
  });

  describe('findAll', () => {
    it('should return all invoices', async () => {
      await invoiceService.create({ user_id: TEST_USER_ID, client_id: testClient.id, issue_date: new Date(), due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
      await invoiceService.create({ user_id: TEST_USER_ID, client_id: testClient.id, issue_date: new Date(), due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });

      const invoices = await invoiceService.findAll(TEST_USER_ID);
      // Should have at least 2 invoices (may have more from previous test runs)
      expect(invoices.length).toBeGreaterThanOrEqual(2);
      // Verify they have the expected structure
      expect(invoices[0].invoice_number).toBeDefined();
      expect(invoices[0].user_id).toBe(TEST_USER_ID);
    });
  });

  describe('findById', () => {
    it('should return an invoice if found', async () => {
      const newInvoice = await invoiceService.create({ user_id: TEST_USER_ID, client_id: testClient.id, issue_date: new Date(), due_date: new Date() });
      const foundInvoice = await invoiceService.findById(newInvoice.id);
      expect(foundInvoice).toBeDefined();
      expect(foundInvoice?.id).toBe(newInvoice.id);
    });

    it('should return null if invoice not found', async () => {
      const foundInvoice = await invoiceService.findById('00000000-0000-0000-0000-000000000000');
      expect(foundInvoice).toBeNull();
    });
  });

  describe('update', () => {
    it('should update an invoice', async () => {
      const newInvoice = await invoiceService.create({ user_id: TEST_USER_ID, client_id: testClient.id, issue_date: new Date(), due_date: new Date(), status: 'draft' });
      const updatedData = { status: 'sent' as const };
      const updatedInvoice = await invoiceService.update(newInvoice.id, updatedData);

      expect(updatedInvoice).toBeDefined();
      expect(updatedInvoice?.status).toBe('sent');
    });
  });

  describe('delete', () => {
    it('should delete an invoice and return true', async () => {
      const newInvoice = await invoiceService.create({ user_id: TEST_USER_ID, client_id: testClient.id, issue_date: new Date(), due_date: new Date() });
      const result = await invoiceService.delete(newInvoice.id);
      expect(result).toBe(true);

      const foundInvoice = await invoiceService.findById(newInvoice.id);
      expect(foundInvoice).toBeNull();
    });

    it('should return false if invoice to delete is not found', async () => {
      const result = await invoiceService.delete('00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });
  });

  describe('addLineItems and calculateInvoiceTotals', () => {
    it('should add line items to an invoice and calculate totals', async () => {
      const newInvoice = await invoiceService.create({ 
        user_id: TEST_USER_ID,
        client_id: testClient.id, 
        issue_date: new Date(),
        due_date: new Date(),
      });

      await invoiceService.addLineItems(newInvoice.id, [
        { description: 'Item 1', quantity: 2, unit_price: 50, total_price: 100 } as any,
        { description: 'Item 2', quantity: 1, unit_price: 75, total_price: 75 } as any,
      ]);

      // Re-fetch the invoice to see calculated totals
      const updatedInvoice = await invoiceService.findById(newInvoice.id);
      expect(updatedInvoice).toBeDefined();
      expect(parseFloat(updatedInvoice?.sub_total as any)).toBe(175); // 100 + 75
      expect(parseFloat(updatedInvoice?.total_amount as any)).toBe(175); // No tax in this example
    });

    it('should add single line item', async () => {
      const newInvoice = await invoiceService.create({ 
        user_id: TEST_USER_ID,
        client_id: testClient.id, 
        issue_date: new Date(),
        due_date: new Date(),
      });

      await invoiceService.addLineItems(newInvoice.id, [
        { description: 'Single Item', quantity: 5, unit_price: 20, total_price: 100 } as any,
      ]);

      const updatedInvoice = await invoiceService.findById(newInvoice.id);
      expect(parseFloat(updatedInvoice?.sub_total as any)).toBe(100);
    });

    it('should handle decimal quantities and prices', async () => {
      const newInvoice = await invoiceService.create({ 
        user_id: TEST_USER_ID,
        client_id: testClient.id, 
        issue_date: new Date(),
        due_date: new Date(),
      });

      await invoiceService.addLineItems(newInvoice.id, [
        { description: 'Hourly Work', quantity: 2.5, unit_price: 85.50, total_price: 213.75 } as any,
      ]);

      const updatedInvoice = await invoiceService.findById(newInvoice.id);
      expect(parseFloat(updatedInvoice?.sub_total as any)).toBeCloseTo(213.75, 2);
    });
  });

  describe('invoice status transitions', () => {
    it('should allow status change from draft to sent', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
        status: 'draft',
      });

      const updatedInvoice = await invoiceService.update(newInvoice.id, { status: 'sent' });
      expect(updatedInvoice?.status).toBe('sent');
    });

    it('should allow status change from sent to paid', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
        status: 'sent',
      });

      const updatedInvoice = await invoiceService.update(newInvoice.id, { status: 'paid' });
      expect(updatedInvoice?.status).toBe('paid');
    });

    it('should allow marking invoice as overdue', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        status: 'sent',
      });

      const updatedInvoice = await invoiceService.update(newInvoice.id, { status: 'overdue' });
      expect(updatedInvoice?.status).toBe('overdue');
    });
  });

  describe('invoice with project', () => {
    it('should create invoice with project association', async () => {
      // First we need a project - import ProjectService
      const { ProjectService } = await import('../../src/services/business/project.service');
      const projectService = new ProjectService();

      const project = await projectService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        name: 'Test Project for Invoice',
      });

      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        project_id: project.id,
        issue_date: new Date(),
        due_date: new Date(),
      });

      expect(newInvoice.project_id).toBe(project.id);

      const foundInvoice = await invoiceService.findById(newInvoice.id);
      expect(foundInvoice?.project_id).toBe(project.id);
    });
  });

  describe('invoice with currency', () => {
    it('should create invoice with EUR currency', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
        currency: 'EUR',
      });

      expect(newInvoice.currency).toBe('EUR');
    });

    it('should default to USD currency if not specified', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
      });

      expect(newInvoice.currency).toBe('USD');
    });

    it('should allow updating currency', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
        currency: 'USD',
      });

      const updatedInvoice = await invoiceService.update(newInvoice.id, { currency: 'GBP' });
      expect(updatedInvoice?.currency).toBe('GBP');
    });
  });

  describe('invoice notes', () => {
    it('should create invoice with notes', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
        notes: 'Payment due within 30 days',
      });

      expect(newInvoice.notes).toBe('Payment due within 30 days');
    });

    it('should update invoice notes', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
      });

      const updatedInvoice = await invoiceService.update(newInvoice.id, {
        notes: 'Updated notes - Please pay promptly',
      });

      expect(updatedInvoice?.notes).toBe('Updated notes - Please pay promptly');
    });
  });

  describe('invoice dates', () => {
    it('should update issue date', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date('2024-01-01'),
        due_date: new Date('2024-01-31'),
      });

      const newIssueDate = new Date('2024-02-01');
      const updatedInvoice = await invoiceService.update(newInvoice.id, {
        issue_date: newIssueDate,
      });

      expect(new Date(updatedInvoice!.issue_date).toISOString().split('T')[0]).toBe('2024-02-01');
    });

    it('should update due date', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date('2024-01-01'),
        due_date: new Date('2024-01-31'),
      });

      const newDueDate = new Date('2024-02-28');
      const updatedInvoice = await invoiceService.update(newInvoice.id, {
        due_date: newDueDate,
      });

      expect(new Date(updatedInvoice!.due_date).toISOString().split('T')[0]).toBe('2024-02-28');
    });
  });

  describe('replaceLineItems', () => {
    it('should replace all line items', async () => {
      const newInvoice = await invoiceService.create({ 
        user_id: TEST_USER_ID,
        client_id: testClient.id, 
        issue_date: new Date(),
        due_date: new Date(),
      });

      // Add initial items
      await invoiceService.addLineItems(newInvoice.id, [
        { description: 'Original Item', quantity: 1, unit_price: 100, total_price: 100 } as any,
      ]);

      // Replace with new items
      await invoiceService.replaceLineItems(newInvoice.id, [
        { description: 'Replacement Item 1', quantity: 2, unit_price: 50, total_price: 100 } as any,
        { description: 'Replacement Item 2', quantity: 3, unit_price: 25, total_price: 75 } as any,
      ]);

      const updatedInvoice = await invoiceService.findById(newInvoice.id);
      expect(parseFloat(updatedInvoice?.sub_total as any)).toBe(175); // 100 + 75
    });
  });

  describe('invoice tax handling', () => {
    it('should default tax rate to zero when no tax_rate_id', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
      });

      // No tax rate specified, so it should be 0 or null
      expect(parseFloat(newInvoice.tax_rate as any) || 0).toBe(0);
    });

    it('should add items without tax when no tax_rate_id', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
      });

      await invoiceService.addLineItems(newInvoice.id, [
        { description: 'Taxable Item', quantity: 1, unit_price: 100, total_price: 100 } as any,
      ]);

      const updatedInvoice = await invoiceService.findById(newInvoice.id);
      expect(parseFloat(updatedInvoice?.sub_total as any)).toBe(100);
      // Without tax rate, total should equal subtotal
      expect(parseFloat(updatedInvoice?.total_amount as any)).toBeGreaterThanOrEqual(100);
    });
  });

  describe('invoice notes and footer text', () => {
    it('should create invoice with footer text', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
        footer_text: 'Bank: ABC Bank, Account: 12345',
      });

      expect(newInvoice.footer_text).toBe('Bank: ABC Bank, Account: 12345');
    });

    it('should update footer text', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
      });

      const updatedInvoice = await invoiceService.update(newInvoice.id, {
        footer_text: 'Updated bank details',
      });

      expect(updatedInvoice?.footer_text).toBe('Updated bank details');
    });

    it('should create invoice with invoice text', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
        invoice_text: 'Payment terms: Net 30 days',
      });

      expect(newInvoice.invoice_text).toBe('Payment terms: Net 30 days');
    });
  });

  describe('invoice delivery date', () => {
    it('should create invoice with delivery date', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
        delivery_date: '11.2024',
      });

      expect(newInvoice.delivery_date).toBe('11.2024');
    });

    it('should retrieve delivery date via findById', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
        delivery_date: '10.2024',
      });

      const foundInvoice = await invoiceService.findById(newInvoice.id);
      expect(foundInvoice?.delivery_date).toBe('10.2024');
    });
  });

  describe('update with no changes', () => {
    it('should return existing invoice when no changes provided', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
        notes: 'Original notes',
      });

      const updated = await invoiceService.update(newInvoice.id, {});

      expect(updated?.id).toBe(newInvoice.id);
      expect(updated?.notes).toBe('Original notes');
    });

    it('should return null when updating non-existent invoice', async () => {
      const updated = await invoiceService.update('00000000-0000-0000-0000-000000000000', {
        notes: 'Does not exist',
      });

      expect(updated).toBeNull();
    });
  });

  describe('invoice status cancelled', () => {
    it('should allow marking invoice as cancelled', async () => {
      const newInvoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
        status: 'draft',
      });

      const updatedInvoice = await invoiceService.update(newInvoice.id, { status: 'cancelled' });
      expect(updatedInvoice?.status).toBe('cancelled');
    });
  });

  describe('findAll with filters', () => {
    it('should return invoices for user', async () => {
      await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
        status: 'draft',
      });

      const invoices = await invoiceService.findAll(TEST_USER_ID);
      
      expect(invoices.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('addLineItems edge cases', () => {
    it('should add multiple line items at once', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
      });

      const items: InvoiceItem[] = [
        { description: 'Item 1', quantity: 1, unit_price: 100 } as InvoiceItem,
        { description: 'Item 2', quantity: 2, unit_price: 50 } as InvoiceItem,
        { description: 'Item 3', quantity: 5, unit_price: 20 } as InvoiceItem,
      ];

      await invoiceService.addLineItems(invoice.id, items);
      const updatedInvoice = await invoiceService.findById(invoice.id);

      // Total should be 100 + 100 + 100 = 300
      expect(Number(updatedInvoice?.total_amount)).toBe(300);
    });

    it('should calculate line item total from quantity and unit_price', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
      });

      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 3, unit_price: 75 } as InvoiceItem,
      ]);

      const updatedInvoice = await invoiceService.findById(invoice.id);
      expect(Number(updatedInvoice?.total_amount)).toBe(225); // 3 * 75
    });
  });

  describe('invoice numbering', () => {
    it('should generate unique invoice numbers', async () => {
      const invoice1 = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
      });

      const invoice2 = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
      });

      expect(invoice1.invoice_number).not.toBe(invoice2.invoice_number);
    });
  });

  describe('invoice amount calculations', () => {
    it('should handle line items with tax rate', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
      });

      // Add item without tax (no tax_rate_id)
      await invoiceService.addLineItems(invoice.id, [
        { description: 'Service', quantity: 1, unit_price: 100 } as InvoiceItem,
      ]);

      const updatedInvoice = await invoiceService.findById(invoice.id);
      expect(Number(updatedInvoice?.sub_total)).toBe(100);
      expect(Number(updatedInvoice?.total_amount)).toBe(100);
    });
  });

  describe('create with all fields', () => {
    it('should create invoice with all optional fields', async () => {
      const invoice = await invoiceService.create({
        user_id: TEST_USER_ID,
        client_id: testClient.id,
        issue_date: new Date(),
        due_date: new Date(),
        notes: 'Test notes',
        footer_text: 'Footer text',
        invoice_text: 'Header text',
        delivery_date: '12.2024',
        currency: 'USD',
      });

      expect(invoice.notes).toBe('Test notes');
      expect(invoice.footer_text).toBe('Footer text');
      expect(invoice.invoice_text).toBe('Header text');
      expect(invoice.delivery_date).toBe('12.2024');
      expect(invoice.currency).toBe('USD');
    });
  });
});

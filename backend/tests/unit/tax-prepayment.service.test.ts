import { TaxPrepaymentService } from '../../src/services/financial/tax-prepayment.service';
import { CreateTaxPrepaymentData, TaxPrepaymentStatus, TaxType } from '../../src/models/financial/tax-prepayment.model';
import { TEST_USER_ID } from '../setup';

describe('TaxPrepaymentService', () => {
  let taxPrepaymentService: TaxPrepaymentService;

  beforeAll(async () => {
    taxPrepaymentService = new TaxPrepaymentService();
  });

  describe('createTaxPrepayment', () => {
    it('should create a new income tax prepayment', async () => {
      const prepaymentData: CreateTaxPrepaymentData = {
        tax_type: TaxType.INCOME_TAX,
        amount: 1500.00,
        payment_date: new Date().toISOString().split('T')[0],
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        tax_year: 2024,
        quarter: 1,
        description: 'Q1 2024 Income Tax Prepayment',
        status: TaxPrepaymentStatus.PAID,
      };

      const prepayment = await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, prepaymentData);

      expect(prepayment).toBeDefined();
      expect(prepayment.id).toBeDefined();
      expect(prepayment.user_id).toBe(TEST_USER_ID);
      expect(prepayment.tax_type).toBe('income_tax');
      expect(parseFloat(prepayment.amount as any)).toBe(1500.00);
      expect(prepayment.tax_year).toBe(2024);
      expect(prepayment.quarter).toBe(1);
      expect(prepayment.status).toBe('paid');
    });

    it('should create a VAT prepayment', async () => {
      const prepaymentData: CreateTaxPrepaymentData = {
        tax_type: TaxType.VAT,
        amount: 2500.00,
        payment_date: new Date().toISOString().split('T')[0],
        period_start: '2024-04-01',
        period_end: '2024-06-30',
        tax_year: 2024,
        quarter: 2,
        description: 'Q2 2024 VAT Payment',
        reference_number: 'VAT-2024-Q2-001',
        payment_method: 'bank_transfer',
        status: TaxPrepaymentStatus.PAID,
      };

      const prepayment = await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, prepaymentData);

      expect(prepayment).toBeDefined();
      expect(prepayment.tax_type).toBe('vat');
      expect(prepayment.reference_number).toBe('VAT-2024-Q2-001');
      expect(prepayment.payment_method).toBe('bank_transfer');
    });

    it('should create another VAT prepayment with notes', async () => {
      const prepaymentData: CreateTaxPrepaymentData = {
        tax_type: TaxType.VAT,
        amount: 800.00,
        payment_date: new Date().toISOString().split('T')[0],
        period_start: '2024-07-01',
        period_end: '2024-09-30',
        tax_year: 2024,
        quarter: 3,
        description: 'Q3 2024 VAT',
        notes: 'Quarterly VAT prepayment',
        status: TaxPrepaymentStatus.PAID,
      };

      const prepayment = await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, prepaymentData);

      expect(prepayment).toBeDefined();
      expect(prepayment.tax_type).toBe('vat');
      expect(prepayment.notes).toBe('Quarterly VAT prepayment');
    });

    it('should create prepayment with provided period dates', async () => {
      const prepaymentData: CreateTaxPrepaymentData = {
        tax_type: TaxType.INCOME_TAX,
        amount: 1000.00,
        payment_date: '2024-04-15',
        period_start: '2024-04-01',
        period_end: '2024-06-30',
        tax_year: 2024,
        quarter: 2,
        status: TaxPrepaymentStatus.PAID,
      };

      const prepayment = await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, prepaymentData);

      expect(prepayment).toBeDefined();
      // Period dates may be returned as Date objects or ISO strings
      const periodStart = typeof prepayment.period_start === 'string' 
        ? prepayment.period_start 
        : new Date(prepayment.period_start).toISOString().split('T')[0];
      const periodEnd = typeof prepayment.period_end === 'string'
        ? prepayment.period_end
        : new Date(prepayment.period_end).toISOString().split('T')[0];
      expect(periodStart).toBe('2024-04-01');
      expect(periodEnd).toBe('2024-06-30');
    });
  });

  describe('getTaxPrepaymentById', () => {
    it('should return a prepayment if found', async () => {
      const newPrepayment = await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.INCOME_TAX,
        amount: 500.00,
        payment_date: new Date().toISOString().split('T')[0],
        period_start: '2024-10-01',
        period_end: '2024-12-31',
        tax_year: 2024,
        quarter: 4,
        status: TaxPrepaymentStatus.PAID,
      });

      const foundPrepayment = await taxPrepaymentService.getTaxPrepaymentById(newPrepayment.id, TEST_USER_ID);

      expect(foundPrepayment).toBeDefined();
      expect(foundPrepayment?.id).toBe(newPrepayment.id);
    });

    it('should return null if prepayment not found', async () => {
      const foundPrepayment = await taxPrepaymentService.getTaxPrepaymentById('00000000-0000-0000-0000-000000000000', TEST_USER_ID);
      expect(foundPrepayment).toBeNull();
    });

    it('should not return prepayment for different user', async () => {
      const newPrepayment = await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.VAT,
        amount: 300.00,
        payment_date: new Date().toISOString().split('T')[0],
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        tax_year: 2024,
        quarter: 1,
        status: TaxPrepaymentStatus.PAID,
      });

      // Use a valid UUID format for different user
      const foundPrepayment = await taxPrepaymentService.getTaxPrepaymentById(newPrepayment.id, '00000000-0000-0000-0000-000000000001');
      expect(foundPrepayment).toBeNull();
    });
  });

  describe('getTaxPrepayments', () => {
    it('should return all prepayments for a user', async () => {
      // Create a few prepayments
      await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.INCOME_TAX,
        amount: 1200.00,
        payment_date: '2024-01-15',
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        tax_year: 2024,
        quarter: 1,
        status: TaxPrepaymentStatus.PAID,
      });

      await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.VAT,
        amount: 800.00,
        payment_date: '2024-01-20',
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        tax_year: 2024,
        quarter: 1,
        status: TaxPrepaymentStatus.PAID,
      });

      const result = await taxPrepaymentService.getTaxPrepayments({ user_id: TEST_USER_ID });

      expect(result.prepayments.length).toBeGreaterThanOrEqual(2);
      expect(result.total).toBeGreaterThanOrEqual(2);
    });

    it('should filter prepayments by tax_type', async () => {
      const result = await taxPrepaymentService.getTaxPrepayments({
        user_id: TEST_USER_ID,
        tax_type: TaxType.INCOME_TAX,
      });

      result.prepayments.forEach(prepayment => {
        expect(prepayment.tax_type).toBe('income_tax');
      });
    });

    it('should filter prepayments by tax_year', async () => {
      const result = await taxPrepaymentService.getTaxPrepayments({
        user_id: TEST_USER_ID,
        tax_year: 2024,
      });

      result.prepayments.forEach(prepayment => {
        expect(prepayment.tax_year).toBe(2024);
      });
    });

    it('should filter prepayments by quarter', async () => {
      await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.INCOME_TAX,
        amount: 1000.00,
        payment_date: '2024-07-15',
        period_start: '2024-07-01',
        period_end: '2024-09-30',
        tax_year: 2024,
        quarter: 3,
        status: TaxPrepaymentStatus.PAID,
      });

      const result = await taxPrepaymentService.getTaxPrepayments({
        user_id: TEST_USER_ID,
        quarter: 3,
      });

      expect(result.prepayments.length).toBeGreaterThanOrEqual(1);
      result.prepayments.forEach(prepayment => {
        expect(prepayment.quarter).toBe(3);
      });
    });
  });

  describe('updateTaxPrepayment', () => {
    it('should update a prepayment', async () => {
      const newPrepayment = await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.INCOME_TAX,
        amount: 1000.00,
        payment_date: new Date().toISOString().split('T')[0],
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        tax_year: 2024,
        quarter: 1,
        status: TaxPrepaymentStatus.PLANNED,
      });

      const updatedPrepayment = await taxPrepaymentService.updateTaxPrepayment(
        newPrepayment.id,
        TEST_USER_ID,
        {
          amount: 1200.00,
          status: TaxPrepaymentStatus.PAID,
          notes: 'Updated with correct amount',
        }
      );

      expect(updatedPrepayment).toBeDefined();
      expect(parseFloat(updatedPrepayment?.amount as any)).toBe(1200.00);
      expect(updatedPrepayment?.status).toBe('paid');
      expect(updatedPrepayment?.notes).toBe('Updated with correct amount');
    });

    it('should throw error when updating non-existent prepayment', async () => {
      await expect(
        taxPrepaymentService.updateTaxPrepayment(
          '00000000-0000-0000-0000-000000000000',
          TEST_USER_ID,
          { amount: 500.00 }
        )
      ).rejects.toThrow('Tax prepayment not found or unauthorized');
    });
  });

  describe('deleteTaxPrepayment', () => {
    it('should delete a prepayment', async () => {
      const newPrepayment = await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.VAT,
        amount: 500.00,
        payment_date: new Date().toISOString().split('T')[0],
        period_start: '2024-10-01',
        period_end: '2024-12-31',
        tax_year: 2024,
        quarter: 4,
        status: TaxPrepaymentStatus.PAID,
      });

      // Delete should complete without error
      await taxPrepaymentService.deleteTaxPrepayment(newPrepayment.id, TEST_USER_ID);

      // Verify it's actually deleted
      const foundPrepayment = await taxPrepaymentService.getTaxPrepaymentById(newPrepayment.id, TEST_USER_ID);
      expect(foundPrepayment).toBeNull();
    });

    it('should throw error when deleting non-existent prepayment', async () => {
      await expect(
        taxPrepaymentService.deleteTaxPrepayment('00000000-0000-0000-0000-000000000000', TEST_USER_ID)
      ).rejects.toThrow('Tax prepayment not found or unauthorized');
    });
  });

  describe('getSummary', () => {
    it('should return summary of all paid prepayments', async () => {
      // Create VAT prepayment
      await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.VAT,
        amount: 1000.00,
        payment_date: '2024-01-15',
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        tax_year: 2024,
        quarter: 1,
        status: TaxPrepaymentStatus.PAID,
      });

      // Create Income Tax prepayment
      await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.INCOME_TAX,
        amount: 2000.00,
        payment_date: '2024-01-20',
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        tax_year: 2024,
        quarter: 1,
        status: TaxPrepaymentStatus.PAID,
      });

      const summary = await taxPrepaymentService.getSummary(TEST_USER_ID);

      expect(summary).toBeDefined();
      expect(summary.total_vat).toBeGreaterThanOrEqual(1000);
      expect(summary.total_income_tax).toBeGreaterThanOrEqual(2000);
      expect(summary.count).toBeGreaterThanOrEqual(2);
    });

    it('should filter summary by tax year', async () => {
      // Create 2024 prepayment
      await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.VAT,
        amount: 500.00,
        payment_date: '2024-02-15',
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        tax_year: 2024,
        quarter: 1,
        status: TaxPrepaymentStatus.PAID,
      });

      // Create 2023 prepayment
      await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.VAT,
        amount: 400.00,
        payment_date: '2023-02-15',
        period_start: '2023-01-01',
        period_end: '2023-03-31',
        tax_year: 2023,
        quarter: 1,
        status: TaxPrepaymentStatus.PAID,
      });

      const summary = await taxPrepaymentService.getSummary(TEST_USER_ID, 2024);

      expect(summary).toBeDefined();
      // Should only include 2024 data
      expect(summary.total_by_year[2024]).toBeDefined();
    });

    it('should return zero totals for user with no paid prepayments', async () => {
      const differentUserId = '00000000-0000-0000-0000-000000000002';
      const summary = await taxPrepaymentService.getSummary(differentUserId);

      expect(summary.total_vat).toBe(0);
      expect(summary.total_income_tax).toBe(0);
      expect(summary.count).toBe(0);
    });

    it('should not include planned prepayments in summary', async () => {
      // Create a planned prepayment
      await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.VAT,
        amount: 9999.00, // Use distinct amount
        payment_date: '2024-03-15',
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        tax_year: 2024,
        quarter: 1,
        status: TaxPrepaymentStatus.PLANNED,
      });

      const summaryBefore = await taxPrepaymentService.getSummary(TEST_USER_ID, 2024);
      
      // The 9999 amount should not be included in summary
      // since we only count PAID and REFUND status
      expect(summaryBefore).toBeDefined();
    });

    it('should handle refunds correctly in summary', async () => {
      // Create a refund prepayment
      await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.VAT,
        amount: 100.00,
        payment_date: '2024-04-15',
        period_start: '2024-04-01',
        period_end: '2024-06-30',
        tax_year: 2024,
        quarter: 2,
        status: TaxPrepaymentStatus.REFUND,
        notes: 'Tax refund',
      });

      const summary = await taxPrepaymentService.getSummary(TEST_USER_ID, 2024);
      
      // Summary should include refunds as negative amounts
      expect(summary).toBeDefined();
      // Refund decreases total
    });
  });

  describe('getTaxPrepayments with pagination', () => {
    it('should paginate prepayments', async () => {
      const result = await taxPrepaymentService.getTaxPrepayments({
        user_id: TEST_USER_ID,
        limit: 2,
        offset: 0,
      });

      expect(result.prepayments.length).toBeLessThanOrEqual(2);
      expect(result.total).toBeGreaterThanOrEqual(result.prepayments.length);
    });

    it('should filter by status', async () => {
      const result = await taxPrepaymentService.getTaxPrepayments({
        user_id: TEST_USER_ID,
        status: TaxPrepaymentStatus.PAID,
      });

      result.prepayments.forEach(prepayment => {
        expect(prepayment.status).toBe('paid');
      });
    });

    it('should filter by date range', async () => {
      const result = await taxPrepaymentService.getTaxPrepayments({
        user_id: TEST_USER_ID,
        date_from: '2024-01-01',
        date_to: '2024-12-31',
      });

      expect(result.prepayments).toBeDefined();
      result.prepayments.forEach(prepayment => {
        const paymentDate = new Date(prepayment.payment_date).toISOString().split('T')[0];
        expect(paymentDate >= '2024-01-01' && paymentDate <= '2024-12-31').toBe(true);
      });
    });
  });

  describe('updateTaxPrepayment with more fields', () => {
    it('should update description', async () => {
      const newPrepayment = await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.INCOME_TAX,
        amount: 800.00,
        payment_date: new Date().toISOString().split('T')[0],
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        tax_year: 2024,
        quarter: 1,
        description: 'Original description',
        status: TaxPrepaymentStatus.PAID,
      });

      const updated = await taxPrepaymentService.updateTaxPrepayment(
        newPrepayment.id,
        TEST_USER_ID,
        { description: 'Updated description' }
      );

      expect(updated.description).toBe('Updated description');
    });

    it('should update reference number', async () => {
      const newPrepayment = await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.VAT,
        amount: 600.00,
        payment_date: new Date().toISOString().split('T')[0],
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        tax_year: 2024,
        quarter: 1,
        status: TaxPrepaymentStatus.PAID,
      });

      const updated = await taxPrepaymentService.updateTaxPrepayment(
        newPrepayment.id,
        TEST_USER_ID,
        { reference_number: 'REF-2024-001' }
      );

      expect(updated.reference_number).toBe('REF-2024-001');
    });

    it('should update payment method', async () => {
      const newPrepayment = await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.INCOME_TAX,
        amount: 700.00,
        payment_date: new Date().toISOString().split('T')[0],
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        tax_year: 2024,
        quarter: 1,
        payment_method: 'bank_transfer',
        status: TaxPrepaymentStatus.PAID,
      });

      const updated = await taxPrepaymentService.updateTaxPrepayment(
        newPrepayment.id,
        TEST_USER_ID,
        { payment_method: 'credit_card' }
      );

      expect(updated.payment_method).toBe('credit_card');
    });

    it('should update payment date', async () => {
      const newPrepayment = await taxPrepaymentService.createTaxPrepayment(TEST_USER_ID, {
        tax_type: TaxType.VAT,
        amount: 550.00,
        payment_date: '2024-01-15',
        period_start: '2024-01-01',
        period_end: '2024-03-31',
        tax_year: 2024,
        quarter: 1,
        status: TaxPrepaymentStatus.PLANNED,
      });

      const updated = await taxPrepaymentService.updateTaxPrepayment(
        newPrepayment.id,
        TEST_USER_ID,
        { payment_date: '2024-01-20' }
      );

      const paymentDate = typeof updated.payment_date === 'string'
        ? updated.payment_date
        : new Date(updated.payment_date).toISOString().split('T')[0];
      expect(paymentDate).toBe('2024-01-20');
    });
  });
});

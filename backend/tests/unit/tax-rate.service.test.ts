import { TaxRateService } from '../../src/services/financial/tax-rate.service';
import { TEST_USER_ID } from '../setup';

describe('TaxRateService', () => {
  let taxRateService: TaxRateService;

  beforeAll(async () => {
    taxRateService = new TaxRateService();
  });

  describe('create', () => {
    it('should create a new tax rate', async () => {
      const taxRate = await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'Standard VAT 19%',
        rate: 19.00,
        description: 'German standard VAT rate',
        is_default: false,
        is_active: true,
        country_code: 'DE',
      });

      expect(taxRate).toBeDefined();
      expect(taxRate.id).toBeDefined();
      expect(taxRate.name).toBe('Standard VAT 19%');
      expect(parseFloat(taxRate.rate as any)).toBe(19.00);
      expect(taxRate.country_code).toBe('DE');
      expect(taxRate.is_active).toBe(true);
    });

    it('should create a tax rate with default flag', async () => {
      const taxRate = await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'Reduced VAT 7%',
        rate: 7.00,
        is_default: true,
        is_active: true,
      });

      expect(taxRate).toBeDefined();
      expect(taxRate.is_default).toBe(true);
    });

    it('should unset other defaults when creating with is_default=true', async () => {
      // Create first default
      const firstRate = await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'First Default',
        rate: 10.00,
        is_default: true,
      });

      // Create second default
      const secondRate = await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'Second Default',
        rate: 15.00,
        is_default: true,
      });

      // First should no longer be default
      const firstUpdated = await taxRateService.findById(firstRate.id, TEST_USER_ID);
      expect(firstUpdated?.is_default).toBe(false);
      expect(secondRate.is_default).toBe(true);
    });
  });

  describe('findAllByUser', () => {
    it('should return all tax rates for a user', async () => {
      await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'FindAll Test Rate',
        rate: 5.00,
        is_active: true,
      });

      const rates = await taxRateService.findAllByUser(TEST_USER_ID);

      expect(rates.length).toBeGreaterThanOrEqual(1);
      rates.forEach(rate => {
        expect(rate.user_id).toBe(TEST_USER_ID);
      });
    });

    it('should filter by active status when activeOnly=true', async () => {
      // Create an inactive rate
      await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'Inactive Rate',
        rate: 3.00,
        is_active: false,
      });

      const activeRates = await taxRateService.findAllByUser(TEST_USER_ID, true);

      activeRates.forEach(rate => {
        expect(rate.is_active).toBe(true);
      });
    });

    it('should return empty array for user with no rates', async () => {
      const rates = await taxRateService.findAllByUser('00000000-0000-0000-0000-000000000001');
      expect(rates).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should return a tax rate if found', async () => {
      const created = await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'Find By ID Test',
        rate: 8.00,
      });

      const found = await taxRateService.findById(created.id, TEST_USER_ID);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('Find By ID Test');
    });

    it('should return null if tax rate not found', async () => {
      const found = await taxRateService.findById('00000000-0000-0000-0000-000000000000', TEST_USER_ID);
      expect(found).toBeNull();
    });

    it('should return null for different user', async () => {
      const created = await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'User Isolation Test',
        rate: 9.00,
      });

      const found = await taxRateService.findById(created.id, '00000000-0000-0000-0000-000000000001');
      expect(found).toBeNull();
    });
  });

  describe('findDefaultByUser', () => {
    it('should return the default tax rate', async () => {
      // Ensure we have a default
      await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'Default Rate Test',
        rate: 20.00,
        is_default: true,
        is_active: true,
      });

      const defaultRate = await taxRateService.findDefaultByUser(TEST_USER_ID);

      expect(defaultRate).toBeDefined();
      expect(defaultRate?.is_default).toBe(true);
      expect(defaultRate?.is_active).toBe(true);
    });

    it('should return null if no default rate exists', async () => {
      const defaultRate = await taxRateService.findDefaultByUser('00000000-0000-0000-0000-000000000001');
      expect(defaultRate).toBeNull();
    });
  });

  describe('update', () => {
    it('should update tax rate name', async () => {
      const created = await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'Before Update',
        rate: 12.00,
      });

      const updated = await taxRateService.update(created.id, TEST_USER_ID, {
        name: 'After Update',
      });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('After Update');
    });

    it('should update multiple fields', async () => {
      const created = await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'Multi Update Test',
        rate: 10.00,
        is_active: true,
      });

      const updated = await taxRateService.update(created.id, TEST_USER_ID, {
        rate: 15.00,
        description: 'Updated description',
        country_code: 'AT',
        is_active: false,
      });

      expect(updated).toBeDefined();
      expect(parseFloat(updated?.rate as any)).toBe(15.00);
      expect(updated?.description).toBe('Updated description');
      expect(updated?.country_code).toBe('AT');
      expect(updated?.is_active).toBe(false);
    });

    it('should return existing rate when no changes provided', async () => {
      const created = await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'No Changes Test',
        rate: 11.00,
      });

      const updated = await taxRateService.update(created.id, TEST_USER_ID, {});

      expect(updated).toBeDefined();
      expect(updated?.id).toBe(created.id);
    });

    it('should return null for non-existent ID', async () => {
      const updated = await taxRateService.update(
        '00000000-0000-0000-0000-000000000000',
        TEST_USER_ID,
        { name: 'Updated' }
      );
      expect(updated).toBeNull();
    });

    it('should unset other defaults when updating is_default to true', async () => {
      const first = await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'First Update Default',
        rate: 16.00,
        is_default: true,
      });

      const second = await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'Second Update Default',
        rate: 17.00,
        is_default: false,
      });

      // Set second as default
      await taxRateService.update(second.id, TEST_USER_ID, { is_default: true });

      const firstUpdated = await taxRateService.findById(first.id, TEST_USER_ID);
      expect(firstUpdated?.is_default).toBe(false);
    });
  });

  describe('setAsDefault', () => {
    it('should set a tax rate as default', async () => {
      const created = await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'Set Default Test',
        rate: 18.00,
        is_default: false,
      });

      const result = await taxRateService.setAsDefault(created.id, TEST_USER_ID);

      expect(result).toBeDefined();
      expect(result?.is_default).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete a tax rate', async () => {
      const created = await taxRateService.create({
        user_id: TEST_USER_ID,
        name: 'Delete Test',
        rate: 22.00,
      });

      const result = await taxRateService.delete(created.id, TEST_USER_ID);
      expect(result).toBe(true);

      const found = await taxRateService.findById(created.id, TEST_USER_ID);
      expect(found).toBeNull();
    });

    it('should return false for non-existent ID', async () => {
      const result = await taxRateService.delete('00000000-0000-0000-0000-000000000000', TEST_USER_ID);
      expect(result).toBe(false);
    });
  });
});

import { ClientService } from '../../src/services/business/client.service';
import { CreateClientDto } from '../../src/models/business/client.model';
import { TEST_USER_ID } from '../setup';

describe('ClientService', () => {
  let clientService: ClientService;

  beforeAll(async () => {
    // Service will use real PostgreSQL test database via database.ts
    clientService = new ClientService();
  });

  describe('create', () => {
    it('should create a new client', async () => {
      const clientData: CreateClientDto = {
        user_id: TEST_USER_ID,
        name: 'Test Client',
        email: 'client@test.com',
      };

      const client = await clientService.create(clientData);

      expect(client).toBeDefined();
      expect(client.id).toBeDefined();
      expect(client.user_id).toBe(TEST_USER_ID);
      expect(client.name).toBe('Test Client');
      expect(client.email).toBe('client@test.com');
    });
  });

  describe('findAll', () => {
    it('should return all clients', async () => {
      await clientService.create({ user_id: TEST_USER_ID, name: 'Client A' });
      await clientService.create({ user_id: TEST_USER_ID, name: 'Client B' });

      const clients = await clientService.findAll(TEST_USER_ID);
      // Should have at least 2 clients (may have more from previous test runs)
      expect(clients.length).toBeGreaterThanOrEqual(2);
      // Verify our specific clients exist
      const clientNames = clients.map(c => c.name);
      expect(clientNames).toContain('Client A');
      expect(clientNames).toContain('Client B');
    });
  });

  describe('findById', () => {
    it('should return a client if found', async () => {
      const newClient = await clientService.create({ user_id: TEST_USER_ID, name: 'Find Me' });
      const foundClient = await clientService.findById(newClient.id);
      expect(foundClient).toBeDefined();
      expect(foundClient?.id).toBe(newClient.id);
    });

    it('should return null if client not found', async () => {
      const foundClient = await clientService.findById('00000000-0000-0000-0000-000000000000');
      expect(foundClient).toBeNull();
    });
  });

  describe('update', () => {
    it('should update a client', async () => {
      const newClient = await clientService.create({ user_id: TEST_USER_ID, name: 'To Be Updated' });
      const updatedData = { name: 'Updated Client', status: 'inactive' as const };
      const updatedClient = await clientService.update(newClient.id, updatedData);

      expect(updatedClient).toBeDefined();
      expect(updatedClient?.name).toBe('Updated Client');
      expect(updatedClient?.status).toBe('inactive');
    });
  });

  describe('delete', () => {
    it('should delete a client and return true', async () => {
      const newClient = await clientService.create({ user_id: TEST_USER_ID, name: 'To Be Deleted' });
      const result = await clientService.delete(newClient.id);
      expect(result).toBe(true);

      const foundClient = await clientService.findById(newClient.id);
      expect(foundClient).toBeNull();
    });

    it('should return false if client to delete is not found', async () => {
      const result = await clientService.delete('00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });
  });

  describe('create with all fields', () => {
    it('should create a client with all optional fields', async () => {
      const clientData: CreateClientDto = {
        user_id: TEST_USER_ID,
        name: 'Full Client',
        email: 'full@client.com',
        phone: '+1-555-0123',
        address: '123 Main St, City',
        notes: 'VIP customer',
      };

      const client = await clientService.create(clientData);

      expect(client.name).toBe('Full Client');
      expect(client.email).toBe('full@client.com');
      expect(client.phone).toBe('+1-555-0123');
      expect(client.address).toBe('123 Main St, City');
      expect(client.notes).toBe('VIP customer');
    });

    it('should create a client with billing address', async () => {
      const clientData: CreateClientDto = {
        user_id: TEST_USER_ID,
        name: 'Billing Client',
        email: 'billing@client.com',
        use_separate_billing_address: true,
        billing_contact_person: 'John Billing',
        billing_email: 'billing-dept@client.com',
        billing_phone: '+1-555-0456',
        billing_address: '456 Billing St',
        billing_city: 'Finance City',
        billing_state: 'FC',
        billing_postal_code: '12345',
        billing_country: 'USA',
      };

      const client = await clientService.create(clientData);

      expect(client.use_separate_billing_address).toBe(true);
      expect(client.billing_contact_person).toBe('John Billing');
      expect(client.billing_email).toBe('billing-dept@client.com');
      expect(client.billing_address).toBe('456 Billing St');
      expect(client.billing_city).toBe('Finance City');
      expect(client.billing_country).toBe('USA');
    });
  });

  describe('findAll with filters', () => {
    it('should filter clients by status', async () => {
      // Create an active client
      await clientService.create({
        user_id: TEST_USER_ID,
        name: 'Active Client Status',
      });

      const activeClients = await clientService.findAll(TEST_USER_ID, { status: 'active' });

      activeClients.forEach(client => {
        expect(client.status).toBe('active');
      });
    });

    it('should filter clients by search term in name', async () => {
      // Create a client with distinct name
      await clientService.create({
        user_id: TEST_USER_ID,
        name: 'Unique Searchable Client XYZ123',
        email: 'unique@xyz.com',
      });

      const clients = await clientService.findAll(TEST_USER_ID, { search: 'XYZ123' });

      expect(clients.length).toBeGreaterThanOrEqual(1);
      clients.forEach(client => {
        expect(client.name.toLowerCase() + client.email?.toLowerCase()).toContain('xyz123');
      });
    });

    it('should filter clients by search term in email', async () => {
      await clientService.create({
        user_id: TEST_USER_ID,
        name: 'Email Search Client',
        email: 'searchbyemail99@domain.com',
      });

      const clients = await clientService.findAll(TEST_USER_ID, { search: 'searchbyemail99' });

      expect(clients.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty array for user with no clients', async () => {
      const clients = await clientService.findAll('00000000-0000-0000-0000-000000000099');
      expect(clients).toEqual([]);
    });
  });

  describe('update with more fields', () => {
    it('should update client email', async () => {
      const newClient = await clientService.create({
        user_id: TEST_USER_ID,
        name: 'Email Update Client',
        email: 'old@email.com',
      });

      const updated = await clientService.update(newClient.id, {
        email: 'new@email.com',
      });

      expect(updated?.email).toBe('new@email.com');
    });

    it('should update client phone', async () => {
      const newClient = await clientService.create({
        user_id: TEST_USER_ID,
        name: 'Phone Update Client',
      });

      const updated = await clientService.update(newClient.id, {
        phone: '+1-555-9999',
      });

      expect(updated?.phone).toBe('+1-555-9999');
    });

    it('should update client address', async () => {
      const newClient = await clientService.create({
        user_id: TEST_USER_ID,
        name: 'Address Update Client',
      });

      const updated = await clientService.update(newClient.id, {
        address: '789 New Address Ave',
      });

      expect(updated?.address).toBe('789 New Address Ave');
    });

    it('should update client notes', async () => {
      const newClient = await clientService.create({
        user_id: TEST_USER_ID,
        name: 'Notes Update Client',
      });

      const updated = await clientService.update(newClient.id, {
        notes: 'Important client notes',
      });

      expect(updated?.notes).toBe('Important client notes');
    });

    it('should update billing address fields', async () => {
      const newClient = await clientService.create({
        user_id: TEST_USER_ID,
        name: 'Billing Update Client',
      });

      const updated = await clientService.update(newClient.id, {
        use_separate_billing_address: true,
        billing_contact_person: 'Billing Person',
        billing_email: 'billing@update.com',
        billing_phone: '+1-555-BILL',
        billing_address: '100 Billing Blvd',
        billing_city: 'Billtown',
        billing_state: 'BL',
        billing_postal_code: '54321',
        billing_country: 'CAN',
      });

      expect(updated?.use_separate_billing_address).toBe(true);
      expect(updated?.billing_contact_person).toBe('Billing Person');
      expect(updated?.billing_email).toBe('billing@update.com');
      expect(updated?.billing_city).toBe('Billtown');
      expect(updated?.billing_country).toBe('CAN');
    });

    it('should return null when updating non-existent client', async () => {
      const updated = await clientService.update('00000000-0000-0000-0000-000000000000', {
        name: 'Does Not Exist',
      });

      expect(updated).toBeNull();
    });

    it('should return existing client when no changes provided', async () => {
      const newClient = await clientService.create({
        user_id: TEST_USER_ID,
        name: 'No Change Client',
      });

      const updated = await clientService.update(newClient.id, {});

      expect(updated?.id).toBe(newClient.id);
      expect(updated?.name).toBe('No Change Client');
    });
  });
});

import { getDbClient } from '../../utils/database';
import {
  CreateClientDto,
  UpdateClientDto,
  Client as IClient,
  ClientStatus // Import the type if needed directly
} from '../../models/business/client.model';
import { logger } from '../../utils/logger';

/**
 * Service for managing client-related business logic and database operations.
 * Handles CRUD operations for clients in a multi-tenant environment.
 * 
 * @class ClientService
 */
export class ClientService {

  /**
   * Creates a new client in the database.
   * 
   * @param {CreateClientDto} clientData - The client data to create
   * @returns {Promise<IClient>} The created client with generated ID and timestamps
   * @throws {Error} If the database operation fails or constraints are violated
   * 
   * @example
   * const newClient = await clientService.create({
   *   user_id: '123e4567-e89b-12d3-a456-426614174000',
   *   name: 'Acme Corporation',
   *   email: 'contact@acme.com',
   *   status: 'active'
   * });
   */
  async create(clientData: CreateClientDto): Promise<IClient> {
    const db = getDbClient();
    const queryText = `
      INSERT INTO clients (
        user_id, name, email, phone, address, notes, status,
        use_separate_billing_address, billing_contact_person, billing_email, billing_phone,
        billing_address, billing_city, billing_state, billing_postal_code, billing_country,
        billing_tax_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING
        id, user_id, name, email, phone, address, notes, status,
        use_separate_billing_address, billing_contact_person, billing_email, billing_phone,
        billing_address, billing_city, billing_state, billing_postal_code, billing_country,
        billing_tax_id, created_at, updated_at
    `;
    const values = [
      clientData.user_id,
      clientData.name,
      clientData.email || null,
      clientData.phone || null,
      clientData.address || null,
      clientData.notes || null,
      clientData.status || 'active', // Default to active if not provided
      clientData.use_separate_billing_address || false,
      clientData.billing_contact_person || null,
      clientData.billing_email || null,
      clientData.billing_phone || null,
      clientData.billing_address || null,
      clientData.billing_city || null,
      clientData.billing_state || null,
      clientData.billing_postal_code || null,
      clientData.billing_country || null,
      clientData.billing_tax_id || null,
    ];

    try {
      const result = await db.query(queryText, values);
      return result.rows[0] as IClient;
    } catch (error) {
        logger.error('Error creating client:', error);
        // Handle specific errors like unique constraint violations if necessary
        throw new Error(`Failed to create client: ${(error as any).message}`);
    }
  }

  /**
   * Retrieves all clients from the database, ordered by name.
   * Optionally filters by user_id for multi-tenant scenarios.
   * Supports filtering by status and searching in name/email fields.
   * 
   * @param {string} [userId] - Optional user ID to filter clients
   * @param {Object} [filters] - Optional filter parameters
   * @param {string} [filters.status] - Filter by client status (active/inactive)
   * @param {string} [filters.search] - Search in client name or email (case-insensitive)
   * @returns {Promise<IClient[]>} Array of all clients (filtered by user if provided)
   * @throws {Error} If the database query fails
   * 
   * @example
   * const clients = await clientService.findAll();
   * console.log(`Found ${clients.length} clients`);
   * 
   * // Filter by user
   * const userClients = await clientService.findAll('user-uuid');
   * 
   * // Filter by status and search
   * const activeClients = await clientService.findAll('user-uuid', { status: 'active', search: 'Acme' });
   */
  async findAll(userId: string, filters?: { status?: string; search?: string }): Promise<IClient[]> {
    const db = getDbClient();
    let queryText = `
      SELECT 
        id, user_id, name, email, phone, address, notes, status,
        use_separate_billing_address, billing_contact_person, billing_email, billing_phone,
        billing_address, billing_city, billing_state, billing_postal_code, billing_country,
        billing_tax_id, created_at, updated_at
      FROM clients
    `;
    const values: any[] = [];
    const conditions: string[] = [];
    
    // ALWAYS filter by user_id for multi-tenant isolation
    conditions.push(`user_id = $${values.length + 1}`);
    values.push(userId);
    
    if (filters?.status) {
      conditions.push(`status = $${values.length + 1}`);
      values.push(filters.status);
    }
    
    if (filters?.search) {
      conditions.push(`(name ILIKE $${values.length + 1} OR email ILIKE $${values.length + 1})`);
      values.push(`%${filters.search}%`);
    }
    
    if (conditions.length > 0) {
      queryText += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    queryText += ` ORDER BY name ASC`;
    
    try {
      const result = await db.query(queryText, values);
      return result.rows as IClient[];
    } catch (error) {
        logger.error('Error fetching all clients:', error);
        throw new Error(`Failed to fetch clients: ${(error as any).message}`);
    }
  }

  /**
   * Retrieves a single client by their ID, scoped to its owner.
   * A client belonging to another user reads as "not found".
   *
   * @param {string} id - The UUID of the client to retrieve
   * @param {string} userId - The UUID of the user who must own the client
   * @returns {Promise<IClient | null>} The client if found, null otherwise
   * @throws {Error} If the database query fails
   *
   * @example
   * const client = await clientService.findById('123e4567-e89b-12d3-a456-426614174000', userId);
   * if (client) {
   *   console.log(`Found client: ${client.name}`);
   * }
   */
  async findById(id: string, userId: string): Promise<IClient | null> {
    const db = getDbClient();
    const queryText = `
      SELECT
        id, user_id, name, email, phone, address, notes, status,
        use_separate_billing_address, billing_contact_person, billing_email, billing_phone,
        billing_address, billing_city, billing_state, billing_postal_code, billing_country,
        billing_tax_id, created_at, updated_at
      FROM clients
      WHERE id = $1 AND user_id = $2
    `;
    try {
      const result = await db.query(queryText, [id, userId]);
      if (result.rows.length === 0) return null;
      return result.rows[0] as IClient;
    } catch (error) {
        logger.error('Error fetching client by ID:', error);
        throw new Error(`Failed to fetch client: ${(error as any).message}`);
    }
  }

  /**
   * Updates an existing client's information, scoped to its owner.
   * Only provided fields will be updated; undefined fields are ignored.
   * A client belonging to another user reads as "not found".
   *
   * @param {string} id - The UUID of the client to update
   * @param {string} userId - The UUID of the user who must own the client
   * @param {UpdateClientDto} clientData - The client data to update (partial)
   * @returns {Promise<IClient | null>} The updated client, or null if not found
   * @throws {Error} If the database operation fails
   *
   * @example
   * const updated = await clientService.update('123e4567-e89b-12d3-a456-426614174000', userId, {
   *   email: 'newemail@acme.com',
   *   status: 'inactive'
   * });
   */
  async update(id: string, userId: string, clientData: UpdateClientDto): Promise<IClient | null> {
    const db = getDbClient();
    const setParts = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (clientData.name !== undefined) { setParts.push(`name = $${paramIndex++}`); values.push(clientData.name); }
    if (clientData.email !== undefined) { setParts.push(`email = $${paramIndex++}`); values.push(clientData.email || null); }
    if (clientData.phone !== undefined) { setParts.push(`phone = $${paramIndex++}`); values.push(clientData.phone || null); }
    if (clientData.address !== undefined) { setParts.push(`address = $${paramIndex++}`); values.push(clientData.address || null); }
    if (clientData.notes !== undefined) { setParts.push(`notes = $${paramIndex++}`); values.push(clientData.notes || null); }
    if (clientData.status !== undefined) { setParts.push(`status = $${paramIndex++}`); values.push(clientData.status as ClientStatus); }
    
    // Billing address fields
    if (clientData.use_separate_billing_address !== undefined) { 
      setParts.push(`use_separate_billing_address = $${paramIndex++}`); 
      values.push(clientData.use_separate_billing_address); 
    }
    if (clientData.billing_contact_person !== undefined) { 
      setParts.push(`billing_contact_person = $${paramIndex++}`); 
      values.push(clientData.billing_contact_person || null); 
    }
    if (clientData.billing_email !== undefined) { 
      setParts.push(`billing_email = $${paramIndex++}`); 
      values.push(clientData.billing_email || null); 
    }
    if (clientData.billing_phone !== undefined) { 
      setParts.push(`billing_phone = $${paramIndex++}`); 
      values.push(clientData.billing_phone || null); 
    }
    if (clientData.billing_address !== undefined) { 
      setParts.push(`billing_address = $${paramIndex++}`); 
      values.push(clientData.billing_address || null); 
    }
    if (clientData.billing_city !== undefined) { 
      setParts.push(`billing_city = $${paramIndex++}`); 
      values.push(clientData.billing_city || null); 
    }
    if (clientData.billing_state !== undefined) { 
      setParts.push(`billing_state = $${paramIndex++}`); 
      values.push(clientData.billing_state || null); 
    }
    if (clientData.billing_postal_code !== undefined) { 
      setParts.push(`billing_postal_code = $${paramIndex++}`); 
      values.push(clientData.billing_postal_code || null); 
    }
    if (clientData.billing_country !== undefined) {
      setParts.push(`billing_country = $${paramIndex++}`);
      values.push(clientData.billing_country || null);
    }
    if (clientData.billing_tax_id !== undefined) {
      setParts.push(`billing_tax_id = $${paramIndex++}`);
      values.push(clientData.billing_tax_id || null);
    }

    if (setParts.length === 0) {
      // No fields to update
      return this.findById(id, userId);
    }

    const queryText = `
      UPDATE clients
      SET ${setParts.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
      RETURNING
        id, user_id, name, email, phone, address, notes, status,
        use_separate_billing_address, billing_contact_person, billing_email, billing_phone,
        billing_address, billing_city, billing_state, billing_postal_code, billing_country,
        billing_tax_id, created_at, updated_at
    `;
    values.push(id, userId);

    try {
        const result = await db.query(queryText, values);
        if (result.rows.length === 0) return null; // Client not found or no changes applied
        return result.rows[0] as IClient;
    } catch (error) {
        logger.error('Error updating client:', error);
        throw new Error(`Failed to update client: ${(error as any).message}`);
    }
  }

  /**
   * Deletes a client from the database, scoped to its owner.
   * Will fail if there are associated projects due to foreign key constraints.
   *
   * Documents hanging on the client are removed by the ON DELETE CASCADE on
   * client_documents.client_id, but that only takes the ROWS — the objects
   * behind them would be stranded in storage forever, since nothing sweeps
   * unreferenced objects. So the files are deleted first. A file that cannot be
   * removed is logged and skipped: an unreachable storage backend must not
   * block the owner from deleting their client.
   *
   * @param {string} id - The UUID of the client to delete
   * @param {string} userId - The UUID of the user who must own the client
   * @returns {Promise<boolean>} True if deletion was successful, false if client not found
   * @throws {Error} If the client has associated projects or database operation fails
   *
   * @example
   * try {
   *   const deleted = await clientService.delete('123e4567-e89b-12d3-a456-426614174000', userId);
   *   if (deleted) console.log('Client deleted successfully');
   * } catch (error) {
   *   console.error('Cannot delete client with projects');
   * }
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const db = getDbClient();
    try {
      // Collect the file paths BEFORE the delete (the FK cascade removes the
      // client_documents rows), but only remove the objects AFTER the delete has
      // actually succeeded. Deleting them first would destroy every signed
      // contract even when the delete then fails — and it routinely does:
      // invoices.client_id is ON DELETE RESTRICT, so any client that has ever
      // been invoiced raises 23503 below. There is no storage GC and no way to
      // get those files back.
      const fileUrls = await this.collectClientDocumentFileUrls(id, userId);

      const queryText = `DELETE FROM clients WHERE id = $1 AND user_id = $2`;
      const result = await db.query(queryText, [id, userId]);
      const deleted = (result.rowCount ?? 0) > 0;

      if (deleted) {
        await this.deleteStoredFiles(fileUrls);
      }

      return deleted;
    } catch (error) {
        logger.error('Error deleting client:', error);
        // Handle foreign key constraint violation if a project exists for this client
        if ((error as any).code === '23503') { // PostgreSQL foreign_key_violation code
            throw new Error('Cannot delete client. There are projects associated with it.');
        }
        throw new Error(`Failed to delete client: ${(error as any).message}`);
    }
  }

  /**
   * Reads the storage paths of a client's document files.
   *
   * Best-effort: a database that has not run the client_documents migration yet
   * must still be able to delete a client.
   *
   * @param {string} id - The UUID of the client
   * @param {string} userId - The UUID of the user who must own the client
   * @returns {Promise<string[]>} Stored file paths, empty when none or on error
   */
  private async collectClientDocumentFileUrls(id: string, userId: string): Promise<string[]> {
    const db = getDbClient();
    try {
      const result = await db.query(
        `SELECT d.file_url
         FROM client_documents d
         JOIN clients c ON c.id = d.client_id
         WHERE d.client_id = $1 AND c.user_id = $2 AND d.file_url IS NOT NULL`,
        [id, userId]
      );
      return result.rows.map((row: any) => row.file_url);
    } catch (error) {
      logger.error(`Error collecting document files for client ${id}:`, error);
      return [];
    }
  }

  /**
   * Removes stored objects, one failure never blocking the rest.
   *
   * Called only after the owning rows are gone, so a stranded object is the
   * worst case — never a row pointing at a file that no longer exists.
   *
   * @param {string[]} fileUrls - Stored file paths to remove
   * @returns {Promise<void>}
   */
  private async deleteStoredFiles(fileUrls: string[]): Promise<void> {
    if (fileUrls.length === 0) return;

    try {
      // Import storage service dynamically to avoid circular dependencies
      const { storageService } = await import('../storage/storage.service');

      for (const fileUrl of fileUrls) {
        try {
          await storageService.deleteFileFromPath(fileUrl);
        } catch (error) {
          logger.error(`Error deleting client document file ${fileUrl}:`, error);
          // Don't throw - a stranded object must not block the deletion
        }
      }
    } catch (error) {
      logger.error('Error loading storage service for document cleanup:', error);
    }
  }
}

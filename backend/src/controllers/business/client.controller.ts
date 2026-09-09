import { Request, Response } from 'express';
import { ClientService } from '../../services/business/client.service';
import Joi from 'joi';
import { logger } from '../../utils/logger';

const clientService = new ClientService();

/**
 * Billing address fields shared by the create and update schemas.
 * These mirror the columns written by ClientService — keep the two in sync,
 * since Joi rejects unknown keys and any drift surfaces as a 400.
 * @constant {Record<string, Joi.Schema>}
 */
const billingFields = {
  use_separate_billing_address: Joi.boolean().optional(),
  billing_contact_person: Joi.string().max(255).optional().allow(''),
  billing_email: Joi.string().email().optional().allow(''),
  billing_phone: Joi.string().max(50).optional().allow(''),
  billing_address: Joi.string().max(500).optional().allow(''),
  billing_city: Joi.string().max(100).optional().allow(''),
  billing_state: Joi.string().max(100).optional().allow(''),
  billing_postal_code: Joi.string().max(20).optional().allow(''),
  billing_country: Joi.string().max(100).optional().allow(''),
  billing_tax_id: Joi.string().max(100).optional().allow('')
};

/**
 * Joi validation schema for creating a new client.
 * Validates name (required), email, phone, address, notes, status and the
 * optional separate billing address fields.
 * @constant {Joi.ObjectSchema}
 */
const createClientSchema = Joi.object({
  name: Joi.string().min(1).max(255).required(),
  email: Joi.string().email().optional().allow(''),
  phone: Joi.string().max(50).optional().allow(''),
  address: Joi.string().max(500).optional().allow(''), // Adjusted max for address
  notes: Joi.string().optional().allow(''),
  status: Joi.string().valid('active', 'inactive').default('active'), // Default to active
  ...billingFields
});

/**
 * Joi validation schema for updating an existing client.
 * All fields are optional, but at least one field must be provided.
 * Empty strings are allowed to clear optional fields.
 * @constant {Joi.ObjectSchema}
 */
const updateClientSchema = Joi.object({
  name: Joi.string().min(1).max(255).optional(),
  email: Joi.string().email().optional().allow('').empty(''), // Allow empty string to clear it
  phone: Joi.string().max(50).optional().allow('').empty(''),
  address: Joi.string().max(500).optional().allow('').empty(''),
  notes: Joi.string().optional().allow(''),
  status: Joi.string().valid('active', 'inactive').optional(),
  ...billingFields
}).min(1); // At least one field must be provided for an update

/**
 * Controller for handling HTTP requests related to client management.
 * Provides CRUD operations for clients with input validation and error handling.
 * 
 * @class ClientController
 */
export class ClientController {

  /**
   * Creates a new client in the database.
   * Validates request body against createClientSchema before processing.
   * 
   * @async
   * @param {Request} req - Express request object with client data in body
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 201 with created client or error response
   * 
   * @example
   * POST /api/clients
   * Body: { "name": "Acme Corp", "email": "contact@acme.com", "status": "active" }
   * Response: 201 { id: "uuid", name: "Acme Corp", ... }
   */
  async create(req: Request, res: Response): Promise<void> {
    const { error, value } = createClientSchema.validate(req.body);
    if (error) {
      res.status(400).json({ error: 'Validation failed', details: error.details });
      return;
    }

    try {
      // Add the authenticated user's ID to the client data
      const clientData = {
        ...value,
        user_id: (req as any).user?.id
      };
      
      logger.debug('[DEBUG] Creating client with user_id:', clientData.user_id);
      logger.debug('[DEBUG] Full req.user:', (req as any).user);
      
      if (!clientData.user_id) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }
      
      const client = await clientService.create(clientData);
      res.status(201).json(client);
    } catch (err: any) {
      logger.error('Create client error:', err);
      // Handle specific errors like unique constraint violations if necessary
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  /**
   * Retrieves all clients from the database.
   * Returns clients ordered by name in ascending order.
   * Filters by authenticated user's ID for multi-tenancy.
   * Supports filtering by status and search query parameters.
   * 
   * @async
   * @param {Request} req - Express request object (supports query params: status, search)
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 with array of clients or error response
   * 
   * @example
   * GET /api/clients
   * GET /api/clients?status=active
   * GET /api/clients?search=acme
   * Response: 200 [{ id: "uuid", name: "Acme Corp", ... }, ...]
   */
  async findAll(req: Request, res: Response): Promise<void> {
    try {
      // Filter clients by authenticated user's ID
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      const { status, search } = req.query;
      
      // Build filters object
      const filters: {
        status?: string;
        search?: string;
      } = {};
      
      if (status && typeof status === 'string') {
        filters.status = status;
      }
      
      if (search && typeof search === 'string') {
        filters.search = search;
      }
      
      const clients = await clientService.findAll(userId, filters);
      res.status(200).json(clients);
    } catch (err: any) {
      logger.error('Find all clients error:', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  /**
   * Retrieves a single client by ID.
   * Returns 404 if client is not found.
   * 
   * @async
   * @param {Request} req - Express request object with client ID in params
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 with client, 404 if not found, or error response
   * 
   * @example
   * GET /api/clients/:id
   * Response: 200 { id: "uuid", name: "Acme Corp", ... }
   * Response: 404 { error: "Client not found" }
   */
  async findById(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    if (!id) {
        res.status(400).json({ error: 'Client ID is required.' });
        return;
    }

    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    try {
      const client = await clientService.findById(id, userId);
      if (client) {
        res.status(200).json(client);
      } else {
        res.status(404).json({ error: 'Client not found' });
      }
    } catch (err: any) {
      logger.error('Find client by ID error:', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  /**
   * Updates an existing client with partial data.
   * Validates request body against updateClientSchema.
   * At least one field must be provided for update.
   * 
   * @async
   * @param {Request} req - Express request object with client ID in params and update data in body
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 with updated client, 404 if not found, or error response
   * 
   * @example
   * PUT /api/clients/:id
   * Body: { "status": "inactive" }
   * Response: 200 { id: "uuid", name: "Acme Corp", status: "inactive", ... }
   */
  async update(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    if (!id) {
        res.status(400).json({ error: 'Client ID is required.' });
        return;
    }

    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const { error, value } = updateClientSchema.validate(req.body);
    if (error) {
      // Joi returns an array of errors for update validation
      const details = error.details.map(detail => ({
        message: detail.message,
        path: detail.path.join('.')
      }));
      res.status(400).json({ error: 'Validation failed', details });
      return;
    }

    try {
      const updatedClient = await clientService.update(id, userId, value);
      if (updatedClient) {
        res.status(200).json(updatedClient);
      } else {
        res.status(404).json({ error: 'Client not found' });
      }
    } catch (err: any) {
      logger.error('Update client error:', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  /**
   * Deletes a client from the database.
   * Returns 409 (Conflict) if client has associated projects due to foreign key constraints.
   * Returns 404 if client is not found.
   * 
   * @async
   * @param {Request} req - Express request object with client ID in params
   * @param {Response} res - Express response object
   * @returns {Promise<void>} Sends 200 on success, 404 if not found, 409 if has projects, or error response
   * 
   * @example
   * DELETE /api/clients/:id
   * Response: 200 { message: "Client deleted successfully" }
   * Response: 409 { error: "Cannot delete client. There are projects associated with it." }
   */
  async delete(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    if (!id) {
        res.status(400).json({ error: 'Client ID is required.' });
        return;
    }

    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    try {
      const deleted = await clientService.delete(id, userId);
      if (deleted) {
        res.status(200).json({ message: 'Client deleted successfully' });
      } else {
        res.status(404).json({ error: 'Client not found or already deleted' });
      }
    } catch (err: any) {
        logger.error('Delete client error:', err);
        // If the error is about foreign key constraint, send a specific message
        if(err.message.includes("Cannot delete client. There are projects associated with it.")){
            res.status(409).json({ error: err.message }); // 409 Conflict
        } else {
            res.status(500).json({ error: err.message || 'Internal server error' });
        }
    }
  }
}

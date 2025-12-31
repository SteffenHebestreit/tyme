import { getDbClient } from '../../utils/database';
import {
  CreateProjectDto,
  UpdateProjectDto,
  Project as IProject,
  ProjectStatus  // Import the type if needed directly
} from '../../models/business/project.model';
import { BaseClient } from '../../models/business/client.model'; // Explicitly import BaseClient

const db = getDbClient();

/**
 * Service for managing project-related business logic and database operations.
 * Handles CRUD operations for projects in a multi-tenant environment.
 * Projects are associated with clients and can include billing rates, timelines, and status tracking.
 * 
 * @class ProjectService
 */
export class ProjectService {

  /**
   * Creates a new project in the database.
   * Associates the project with a client and sets default values for optional fields.
   * 
   * @async
   * @param {CreateProjectDto} projectData - The project data to create
   * @returns {Promise<IProject>} The created project with generated ID, timestamps, and client details
   * @throws {Error} If client_id is invalid (foreign key violation)
   * @throws {Error} If the database operation fails
   * 
   * @example
   * const newProject = await projectService.create({
   *   user_id: '123e4567-e89b-12d3-a456-426614174000',
   *   name: 'Website Redesign',
   *   client_id: 'client-uuid',
   *   status: 'active',
   *   hourly_rate: 150,
   *   currency: 'USD'
   * });
   */
  async create(projectData: CreateProjectDto): Promise<IProject> {
    const db = getDbClient();
    const queryText = `
      INSERT INTO projects (user_id, name, description, client_id, status, start_date, end_date, hourly_rate, currency, budget, rate_type, estimated_hours, recurring_payment, tags)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
      RETURNING id, user_id, name, description, client_id, status, start_date, end_date, hourly_rate, currency, budget, rate_type, estimated_hours, recurring_payment, tags, created_at, updated_at
    `;
    const values = [
      projectData.user_id, // Multi-tenant: user who owns the project
      projectData.name,
      projectData.description || null,
      projectData.client_id, // Must be a valid UUID from the clients table
      projectData.status || 'active',
      projectData.start_date || null,
      projectData.end_date || null,
      projectData.hourly_rate || null,
      projectData.currency || 'USD',
      projectData.budget || null,
      projectData.rate_type || null,
      projectData.estimated_hours || null,
      projectData.recurring_payment || false,
      projectData.tags || null,
    ];

    try {
      const result = await db.query(queryText, values);
      // Fetch associated client details
      return await this.getProjectWithClient(result.rows[0]);
    } catch (error) {
        console.error('Error creating project:', error);
        if ((error as any).code === '23503') { // foreign_key_violation for client_id
            throw new Error('Invalid client ID specified.');
        }
        // Handle other specific errors like unique constraint violations if necessary
        throw new Error(`Failed to create project: ${(error as any).message}`);
    }
  }

  /**
   * Retrieves all projects from the database with optional filtering.
   * Returns projects ordered by creation date (newest first).
   * Each project includes full client details if associated with a client.
   * 
   * @async
   * @param {Object} filters - Optional filters for projects
   * @param {string} filters.status - Filter by project status (not_started, active, on_hold, completed)
   * @param {string} filters.client_id - Filter by client UUID
   * @param {string} filters.search - Search in project name or description (case-insensitive)
   * @returns {Promise<IProject[]>} Array of filtered projects with client details
   * @throws {Error} If the query fails
   * 
   * @example
   * const projects = await projectService.findAll();
   * const activeProjects = await projectService.findAll({ status: 'active' });
   * const searchResults = await projectService.findAll({ search: 'website' });
   */
  async findAll(user_id: string, filters?: {
    status?: string;
    client_id?: string;
    search?: string;
  }): Promise<IProject[]> {
    const db = getDbClient();
    
    // Build WHERE clause based on filters
    // ALWAYS filter by user_id for multi-tenant isolation
    const conditions: string[] = [`p.user_id = $1`];
    const values: any[] = [user_id];
    let paramIndex = 2;

    if (filters?.status) {
      conditions.push(`p.status = $${paramIndex++}`);
      values.push(filters.status);
    }
    
    if (filters?.client_id) {
      conditions.push(`p.client_id = $${paramIndex++}`);
      values.push(filters.client_id);
    }
    
    if (filters?.search) {
      conditions.push(`(p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`);
      values.push(`%${filters.search}%`);
      paramIndex++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const queryText = `
      SELECT p.id, p.user_id, p.name, p.description, p.client_id, p.status, p.start_date, p.end_date, 
             p.hourly_rate, p.budget, p.rate_type, p.estimated_hours, p.currency, p.tags, p.recurring_payment, p.created_at, p.updated_at
      FROM projects p
      ${whereClause}
      ORDER BY p.created_at DESC
    `;
    
    try {
      const result = await db.query(queryText, values);
      
      // Process each project to include full client details
      const projectPromises = result.rows.map(async (row: any) => {
        return await this.getProjectWithClient(row);
      });

      // Wait for all projects to be processed with their client details
      const projects: IProject[] = await Promise.all(projectPromises);
      return projects;
    } catch (error) {
        console.error('Error fetching all projects:', error);
        throw new Error(`Failed to fetch projects: ${(error as any).message}`);
    }
  }

  /**
   * Retrieves a single project by its ID.
   * Returns the project with full client details if found.
   * 
   * @async
   * @param {string} id - The UUID of the project to retrieve
   * @returns {Promise<IProject | null>} The project with client details, or null if not found
   * @throws {Error} If the query fails
   * 
   * @example
   * const project = await projectService.findById('project-uuid');
   * if (project) {
   *   console.log(`Project: ${project.name}, Client: ${project.client?.name}`);
   * }
   */
  async findById(id: string): Promise<IProject | null> {
    const db = getDbClient();
    const queryText = `
      SELECT p.id, p.user_id, p.name, p.description, p.client_id, p.status, p.start_date, p.end_date, 
             p.hourly_rate, p.budget, p.rate_type, p.estimated_hours, p.currency, p.tags, p.recurring_payment, p.created_at, p.updated_at
      FROM projects p WHERE id = $1
    `;
    try {
      const result = await db.query(queryText, [id]);
      if (result.rows.length === 0) return null;
      return this.getProjectWithClient(result.rows[0]);
    } catch (error) {
        console.error('Error fetching project by ID:', error);
        throw new Error(`Failed to fetch project: ${(error as any).message}`);
    }
  }

  /**
   * Updates an existing project with partial data.
   * Only provided fields will be updated; undefined fields are ignored.
   * Returns null if the project is not found.
   * 
   * @async
   * @param {string} id - The UUID of the project to update
   * @param {UpdateProjectDto} projectData - The partial project data to update
   * @returns {Promise<IProject | null>} The updated project with client details, or null if not found
   * @throws {Error} If client_id is invalid (foreign key violation)
   * @throws {Error} If the update operation fails
   * 
   * @example
   * const updated = await projectService.update('project-uuid', {
   *   status: 'completed',
   *   end_date: '2024-12-31'
   * });
   */
  async update(id: string, projectData: UpdateProjectDto): Promise<IProject | null> {
    const db = getDbClient();
    const setParts = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (projectData.name !== undefined) { setParts.push(`name = $${paramIndex++}`); values.push(projectData.name); }
    if (projectData.description !== undefined) { setParts.push(`description = $${paramIndex++}`); values.push(projectData.description || null); }
    if (projectData.client_id !== undefined) { 
      setParts.push(`client_id = $${paramIndex++}`); 
      values.push(projectData.client_id);
    }
    if (projectData.status !== undefined) { setParts.push(`status = $${paramIndex++}`); values.push(projectData.status as ProjectStatus); }
    if (projectData.start_date !== undefined) { setParts.push(`start_date = $${paramIndex++}`); values.push(projectData.start_date || null); }
    if (projectData.end_date !== undefined) { setParts.push(`end_date = $${paramIndex++}`); values.push(projectData.end_date || null); }
    if (projectData.hourly_rate !== undefined) { setParts.push(`hourly_rate = $${paramIndex++}`); values.push(projectData.hourly_rate || null); }
    if (projectData.budget !== undefined) { setParts.push(`budget = $${paramIndex++}`); values.push(projectData.budget || null); }
    if (projectData.rate_type !== undefined) { setParts.push(`rate_type = $${paramIndex++}`); values.push(projectData.rate_type || null); }
    if (projectData.estimated_hours !== undefined) { setParts.push(`estimated_hours = $${paramIndex++}`); values.push(projectData.estimated_hours || null); }
    if (projectData.currency !== undefined) { setParts.push(`currency = $${paramIndex++}`); values.push(projectData.currency || 'USD'); }
    if (projectData.tags !== undefined) { setParts.push(`tags = $${paramIndex++}`); values.push(projectData.tags || null); }
    if (projectData.recurring_payment !== undefined) { setParts.push(`recurring_payment = $${paramIndex++}`); values.push(projectData.recurring_payment); }

    if (setParts.length === 0) {
      return this.findById(id);
    }

    const queryText = `
      UPDATE projects 
      SET ${setParts.join(', ')}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $${paramIndex} RETURNING id, user_id, name, description, client_id, status, start_date, end_date, hourly_rate, budget, rate_type, estimated_hours, currency, tags, recurring_payment, created_at, updated_at
    `;
    values.push(id);

    try {
        const result = await db.query(queryText, values);
        if (result.rows.length === 0) return null;
        return this.getProjectWithClient(result.rows[0]);
    } catch (error) {
        console.error('Error updating project:', error);
         if ((error as any).code === '23503') { // foreign_key_violation for client_id
            throw new Error('Invalid client ID specified.');
        }
        throw new Error(`Failed to update project: ${(error as any).message}`);
    }
  }

  /**
   * Deletes a project from the database.
   * Warning: This may fail if there are associated time entries or invoices due to foreign key constraints.
   * 
   * @async
   * @param {string} id - The UUID of the project to delete
   * @returns {Promise<boolean>} True if the project was deleted, false if not found
   * @throws {Error} If the project has associated time entries or invoices
   * @throws {Error} If the deletion fails
   * 
   * @example
   * try {
   *   const deleted = await projectService.delete('project-uuid');
   *   if (deleted) console.log('Project deleted');
   * } catch (error) {
   *   console.error('Cannot delete project with time entries');
   * }
   */
  async delete(id: string): Promise<boolean> {
    const db = getDbClient();
    const queryText = `DELETE FROM projects WHERE id = $1`;
    try {
      const result = await db.query(queryText, [id]);
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
        console.error('Error deleting project:', error);
        throw new Error(`Failed to delete project: ${(error as any).message}`);
    }
  }

  /**
   * Private helper method to enrich a project row with full client details.
   * Fetches the associated client from the database and attaches it to the project.
   * 
   * @private
   * @async
   * @param {any} projectRow - The raw project row from the database
   * @returns {Promise<IProject>} The project with client details attached
   * 
   * @example
   * // Internal use only
   * const enrichedProject = await this.getProjectWithClient(rawProjectRow);
   */
  private async getProjectWithClient(projectRow: any): Promise<IProject> {
    const db = getDbClient();
    // Fetch client details separately
    if (!projectRow.client_id) {
      return {
        ...projectRow,
        client: undefined
      };
    }
    
    const clientQueryText = `SELECT id, name, email, phone, address, notes, status, created_at, updated_at FROM clients WHERE id = $1`;
    const clientResult = await db.query(clientQueryText, [projectRow.client_id]);
    
    let clientDetails;
    if (clientResult.rows.length > 0) {
        clientDetails = clientResult.rows[0] as BaseClient;
    }

    return {
      ...projectRow,
      client: clientDetails
    };
  }
}

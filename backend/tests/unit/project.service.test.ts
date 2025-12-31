import { ProjectService } from '../../src/services/business/project.service';
import { ClientService } from '../../src/services/business/client.service';
import { CreateProjectDto } from '../../src/models/business/project.model';
import { Client } from '../../src/models/business/client.model';
import { TEST_USER_ID } from '../setup';

describe('ProjectService', () => {
  let projectService: ProjectService;
  let clientService: ClientService;
  let testClient: Client;

  beforeAll(async () => {
    projectService = new ProjectService();
    clientService = new ClientService();
    
    // Create a test client for foreign key relationships using global test user
    testClient = await clientService.create({ user_id: TEST_USER_ID, name: 'Test Client' });
  });

  beforeEach(async () => {
    // Database cleanup is handled by global setup
  });

  afterEach(async () => {
    // Database cleanup is handled by global setup
  });

  afterAll(async () => {
    // Database cleanup is handled by global setup
  });

  describe('create', () => {
    it('should create a new project with an associated client', async () => {
      const projectData: CreateProjectDto = {
        user_id: TEST_USER_ID,
        name: 'Test Project',
        client_id: testClient.id,
        status: 'active' as const,
      };

      const project = await projectService.create(projectData);

      expect(project).toBeDefined();
      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.client).toBeDefined();
      expect(project.client?.id).toBe(testClient.id);
    });

    it('should throw an error for an invalid client ID', async () => {
      const projectData: CreateProjectDto = {
        user_id: TEST_USER_ID,
        name: 'Invalid Project',
        client_id: '00000000-0000-0000-0000-000000000000',
      };

      await expect(projectService.create(projectData)).rejects.toThrow('Invalid client ID specified.');
    });
  });

  describe('findAll', () => {
    it('should return all projects with their clients', async () => {
      await projectService.create({ user_id: TEST_USER_ID, name: 'Project A', client_id: testClient.id });
      await projectService.create({ user_id: TEST_USER_ID, name: 'Project B', client_id: testClient.id });

      const projects = await projectService.findAll(TEST_USER_ID);
      // Should have at least 2 projects (may have more from previous test runs)
      expect(projects.length).toBeGreaterThanOrEqual(2);
      // Verify our specific projects exist
      const projectNames = projects.map(p => p.name);
      expect(projectNames).toContain('Project A');
      expect(projectNames).toContain('Project B');
      // Verify client join works
      expect(projects[0].client).toBeDefined();
    });
  });

  describe('findById', () => {
    it('should return a project with its client if found', async () => {
      const newProject = await projectService.create({ user_id: TEST_USER_ID, name: 'Find Me Project', client_id: testClient.id });
      const foundProject = await projectService.findById(newProject.id);
      expect(foundProject).toBeDefined();
      expect(foundProject?.id).toBe(newProject.id);
      expect(foundProject?.client?.id).toBe(testClient.id);
    });
  });

  describe('update', () => {
    it('should update a project', async () => {
      const newProject = await projectService.create({ user_id: TEST_USER_ID, name: 'To Be Updated Project', client_id: testClient.id });
      const updatedData = { name: 'Updated Project', status: 'completed' as const };
      const updatedProject = await projectService.update(newProject.id, updatedData);

      expect(updatedProject).toBeDefined();
      expect(updatedProject?.name).toBe('Updated Project');
      expect(updatedProject?.status).toBe('completed');
    });
  });

  describe('delete', () => {
    it('should delete a project and return true', async () => {
      const newProject = await projectService.create({ user_id: TEST_USER_ID, name: 'To Be Deleted Project', client_id: testClient.id });
      const result = await projectService.delete(newProject.id);
      expect(result).toBe(true);

      const foundProject = await projectService.findById(newProject.id);
      expect(foundProject).toBeNull();
    });

    it('should return false when deleting non-existent project', async () => {
      const result = await projectService.delete('00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });
  });

  describe('create with all fields', () => {
    it('should create a project with all optional fields', async () => {
      const projectData: CreateProjectDto = {
        user_id: TEST_USER_ID,
        name: 'Full Project',
        client_id: testClient.id,
        description: 'A fully detailed project',
        status: 'active',
        start_date: new Date('2024-01-01'),
        end_date: new Date('2024-12-31'),
        hourly_rate: 100.00,
        budget: 50000.00,
        estimated_hours: 500,
        currency: 'EUR',
        tags: ['important', 'priority'],
      };

      const project = await projectService.create(projectData);

      expect(project.name).toBe('Full Project');
      expect(project.description).toBe('A fully detailed project');
      expect(parseFloat(project.hourly_rate as any)).toBe(100);
      expect(parseFloat(project.budget as any)).toBe(50000);
      expect(project.currency).toBe('EUR');
      expect(project.tags).toContain('important');
    });
  });

  describe('findAll with filters', () => {
    it('should filter projects by status', async () => {
      await projectService.create({ 
        user_id: TEST_USER_ID, 
        name: 'Active Filter Project', 
        client_id: testClient.id,
        status: 'active',
      });

      const projects = await projectService.findAll(TEST_USER_ID, { status: 'active' });
      
      projects.forEach(project => {
        expect(project.status).toBe('active');
      });
    });

    it('should filter projects by client_id', async () => {
      const projects = await projectService.findAll(TEST_USER_ID, { client_id: testClient.id });
      
      projects.forEach(project => {
        expect(project.client_id).toBe(testClient.id);
      });
    });

    it('should filter projects by search term', async () => {
      await projectService.create({ 
        user_id: TEST_USER_ID, 
        name: 'Unique Searchable Project XYZ999', 
        client_id: testClient.id,
      });

      const projects = await projectService.findAll(TEST_USER_ID, { search: 'XYZ999' });
      
      expect(projects.length).toBeGreaterThanOrEqual(1);
      expect(projects.some(p => p.name.includes('XYZ999'))).toBe(true);
    });

    it('should return empty array for user with no projects', async () => {
      const projects = await projectService.findAll('00000000-0000-0000-0000-000000000099');
      expect(projects).toEqual([]);
    });
  });

  describe('findById edge cases', () => {
    it('should return null for non-existent project', async () => {
      const project = await projectService.findById('00000000-0000-0000-0000-000000000000');
      expect(project).toBeNull();
    });
  });

  describe('update with more fields', () => {
    it('should update project description', async () => {
      const newProject = await projectService.create({ 
        user_id: TEST_USER_ID, 
        name: 'Description Update Project', 
        client_id: testClient.id 
      });
      
      const updated = await projectService.update(newProject.id, { 
        description: 'Updated description' 
      });
      
      expect(updated?.description).toBe('Updated description');
    });

    it('should update project hourly_rate', async () => {
      const newProject = await projectService.create({ 
        user_id: TEST_USER_ID, 
        name: 'Rate Update Project', 
        client_id: testClient.id,
        hourly_rate: 50.00,
      });
      
      const updated = await projectService.update(newProject.id, { hourly_rate: 75.00 });
      
      expect(parseFloat(updated?.hourly_rate as any)).toBe(75);
    });

    it('should update project budget', async () => {
      const newProject = await projectService.create({ 
        user_id: TEST_USER_ID, 
        name: 'Budget Update Project', 
        client_id: testClient.id,
      });
      
      const updated = await projectService.update(newProject.id, { budget: 25000.00 });
      
      expect(parseFloat(updated?.budget as any)).toBe(25000);
    });

    it('should update project dates', async () => {
      const newProject = await projectService.create({ 
        user_id: TEST_USER_ID, 
        name: 'Date Update Project', 
        client_id: testClient.id,
      });
      
      const updated = await projectService.update(newProject.id, { 
        start_date: new Date('2024-03-01'),
        end_date: new Date('2024-09-30'),
      });
      
      expect(new Date(updated!.start_date!).toISOString().split('T')[0]).toBe('2024-03-01');
      expect(new Date(updated!.end_date!).toISOString().split('T')[0]).toBe('2024-09-30');
    });

    it('should update project tags', async () => {
      const newProject = await projectService.create({ 
        user_id: TEST_USER_ID, 
        name: 'Tags Update Project', 
        client_id: testClient.id,
        tags: ['original'],
      });
      
      const updated = await projectService.update(newProject.id, { 
        tags: ['updated', 'new-tag'] 
      });
      
      expect(updated?.tags).toContain('updated');
      expect(updated?.tags).toContain('new-tag');
    });

    it('should return null when updating non-existent project', async () => {
      const updated = await projectService.update('00000000-0000-0000-0000-000000000000', { 
        name: 'Does Not Exist' 
      });
      
      expect(updated).toBeNull();
    });

    it('should return existing project when no changes provided', async () => {
      const newProject = await projectService.create({ 
        user_id: TEST_USER_ID, 
        name: 'No Change Project', 
        client_id: testClient.id,
      });
      
      const updated = await projectService.update(newProject.id, {});
      
      expect(updated?.id).toBe(newProject.id);
      expect(updated?.name).toBe('No Change Project');
    });
  });
});

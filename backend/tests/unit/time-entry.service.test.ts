import { TimeEntryService } from '../../src/services/business/time-entry.service';
import { ProjectService } from '../../src/services/business/project.service';
import { ClientService } from '../../src/services/business/client.service';
import { CreateTimeEntryDto } from '../../src/models/business/time-entry.model';
import { Client } from '../../src/models/business/client.model';
import { Project } from '../../src/models/business/project.model';
import { TEST_USER_ID } from '../setup';

describe('TimeEntryService', () => {
  let timeEntryService: TimeEntryService;
  let projectService: ProjectService;
  let clientService: ClientService;
  let testClient: Client;
  let testProject: Project;
  let secondProject: Project;

  beforeAll(async () => {
    timeEntryService = new TimeEntryService();
    projectService = new ProjectService();
    clientService = new ClientService();

    // Use global test user
    testClient = await clientService.create({ user_id: TEST_USER_ID, name: 'Test Client for Time Entries' });
    testProject = await projectService.create({ user_id: TEST_USER_ID, name: 'Test Project for Time Entries', client_id: testClient.id });
    secondProject = await projectService.create({ user_id: TEST_USER_ID, name: 'Second Project', client_id: testClient.id });
  });

  describe('create', () => {
    it('should create a new time entry', async () => {
      const timeEntryData: CreateTimeEntryDto = {
        user_id: TEST_USER_ID,
        project_id: testProject.id,
        description: 'Doing some work',
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
        is_billable: true,
        category: 'development',
      };

      const timeEntry = await timeEntryService.create(timeEntryData);

      expect(timeEntry).toBeDefined();
      expect(timeEntry.id).toBeDefined();
      expect(timeEntry.description).toBe('Doing some work');
      expect(parseFloat(timeEntry.duration_hours as any)).toBe(1);
      expect(timeEntry.project).toBeDefined();
      expect(timeEntry.project?.id).toBe(testProject.id);
    });

    it('should create a time entry with all optional fields', async () => {
      const timeEntryData: CreateTimeEntryDto = {
        user_id: TEST_USER_ID,
        project_id: testProject.id,
        description: 'Full entry',
        task_name: 'Task A',
        entry_date: new Date(),
        entry_time: '09:00',
        entry_end_time: '11:30',
        duration_hours: 2.5,
        is_billable: true,
        category: 'development',
        tags: ['frontend', 'react'],
        hourly_rate: 75.00,
      };

      const timeEntry = await timeEntryService.create(timeEntryData);

      expect(timeEntry).toBeDefined();
      expect(timeEntry.task_name).toBe('Task A');
      expect(parseFloat(timeEntry.duration_hours as any)).toBe(2.5);
      expect(timeEntry.tags).toContain('frontend');
    });

    it('should create a non-billable time entry', async () => {
      const timeEntryData: CreateTimeEntryDto = {
        user_id: TEST_USER_ID,
        project_id: testProject.id,
        description: 'Internal meeting',
        entry_date: new Date(),
        entry_time: '14:00',
        duration_hours: 1,
        is_billable: false,
      };

      const timeEntry = await timeEntryService.create(timeEntryData);

      expect(timeEntry).toBeDefined();
      expect(timeEntry.is_billable).toBe(false);
    });

    it('should throw error for invalid project_id', async () => {
      const timeEntryData: CreateTimeEntryDto = {
        user_id: TEST_USER_ID,
        project_id: '00000000-0000-0000-0000-000000000000',
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
      };

      await expect(timeEntryService.create(timeEntryData)).rejects.toThrow();
    });
  });

  describe('findAll', () => {
    it('should find all time entries for a user', async () => {
      await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1
      });

      const entries = await timeEntryService.findAll({ user_id: TEST_USER_ID });
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter by project_id', async () => {
      await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1
      });
      await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: secondProject.id, 
        entry_date: new Date(),
        entry_time: '12:00',
        duration_hours: 1
      });

      const entries = await timeEntryService.findAll({ user_id: TEST_USER_ID, project_id: testProject.id });
      entries.forEach(entry => {
        expect(entry.project_id).toBe(testProject.id);
      });
    });

    it('should filter by date range', async () => {
      const today = new Date();
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 7);
      const endDate = new Date(today);

      await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: today,
        entry_time: '10:00',
        duration_hours: 2
      });

      const entries = await timeEntryService.findAll({ 
        user_id: TEST_USER_ID, 
        start_date: startDate, 
        end_date: endDate 
      });

      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('findById', () => {
    it('should find a time entry by ID', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
        description: 'Find me'
      });

      const foundEntry = await timeEntryService.findById(newEntry.id);
      expect(foundEntry).toBeDefined();
      expect(foundEntry?.id).toBe(newEntry.id);
      expect(foundEntry?.description).toBe('Find me');
    });

    it('should return null for non-existent ID', async () => {
      const foundEntry = await timeEntryService.findById('00000000-0000-0000-0000-000000000000');
      expect(foundEntry).toBeNull();
    });
  });

  describe('update', () => {
    it('should update a time entry description', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
        description: 'Original' 
      });
      
      const updatedEntry = await timeEntryService.update(newEntry.id, { description: 'Updated description' });

      expect(updatedEntry).toBeDefined();
      expect(updatedEntry?.description).toBe('Updated description');
    });

    it('should update multiple fields', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
        is_billable: true
      });
      
      const updatedEntry = await timeEntryService.update(newEntry.id, { 
        duration_hours: 2.5,
        is_billable: false,
        category: 'meeting'
      });

      expect(updatedEntry).toBeDefined();
      expect(parseFloat(updatedEntry?.duration_hours as any)).toBe(2.5);
      expect(updatedEntry?.is_billable).toBe(false);
      expect(updatedEntry?.category).toBe('meeting');
    });

    it('should return existing entry when no changes provided', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1
      });
      
      const updatedEntry = await timeEntryService.update(newEntry.id, {});

      expect(updatedEntry).toBeDefined();
      expect(updatedEntry?.id).toBe(newEntry.id);
    });

    it('should return null for non-existent ID', async () => {
      const updatedEntry = await timeEntryService.update('00000000-0000-0000-0000-000000000000', { 
        description: 'Updated' 
      });

      expect(updatedEntry).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a time entry', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1
      });
      
      const result = await timeEntryService.delete(newEntry.id);
      expect(result).toBe(true);

      const foundEntry = await timeEntryService.findById(newEntry.id);
      expect(foundEntry).toBeNull();
    });

    it('should return false for non-existent ID', async () => {
      const result = await timeEntryService.delete('00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });
  });

  describe('update with more fields', () => {
    it('should update task_name', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
      });
      
      const updated = await timeEntryService.update(newEntry.id, { task_name: 'New Task' });
      expect(updated?.task_name).toBe('New Task');
    });

    it('should update entry_time', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
      });
      
      const updated = await timeEntryService.update(newEntry.id, { entry_time: '14:30' });
      expect(updated?.entry_time).toMatch(/^14:30/);
    });

    it('should update entry_end_time', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 2,
      });
      
      const updated = await timeEntryService.update(newEntry.id, { entry_end_time: '12:00' });
      expect(updated?.entry_end_time).toMatch(/^12:00/);
    });

    it('should update tags', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
        tags: ['original'],
      });
      
      const updated = await timeEntryService.update(newEntry.id, { tags: ['updated', 'new-tag'] });
      expect(updated?.tags).toContain('updated');
      expect(updated?.tags).toContain('new-tag');
    });

    it('should update hourly_rate', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
        hourly_rate: 50.00,
      });
      
      const updated = await timeEntryService.update(newEntry.id, { hourly_rate: 75.00 });
      expect(parseFloat(updated?.hourly_rate as any)).toBe(75.00);
    });

    it('should update entry_date', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date('2024-01-01'),
        entry_time: '10:00',
        duration_hours: 1,
      });
      
      const newDate = new Date('2024-06-15');
      const updated = await timeEntryService.update(newEntry.id, { entry_date: newDate });
      expect(new Date(updated!.entry_date).toISOString().split('T')[0]).toBe('2024-06-15');
    });

    it('should update project_id', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
      });
      
      const updated = await timeEntryService.update(newEntry.id, { project_id: secondProject.id });
      expect(updated?.project_id).toBe(secondProject.id);
    });

    it('should throw error when updating to invalid project_id', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
      });
      
      await expect(
        timeEntryService.update(newEntry.id, { project_id: '00000000-0000-0000-0000-000000000000' })
      ).rejects.toThrow();
    });
  });

  describe('create with different categories', () => {
    it('should create entry with meeting category', async () => {
      const entry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '09:00',
        duration_hours: 1,
        category: 'meeting',
      });
      
      expect(entry.category).toBe('meeting');
    });

    it('should create entry with research category', async () => {
      const entry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '11:00',
        duration_hours: 2,
        category: 'research',
      });
      
      expect(entry.category).toBe('research');
    });
  });

  describe('findAll edge cases', () => {
    it('should return empty array for user with no entries', async () => {
      const entries = await timeEntryService.findAll({ 
        user_id: '00000000-0000-0000-0000-000000000099' 
      });
      expect(entries).toEqual([]);
    });

    it('should combine project and date filters', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const entries = await timeEntryService.findAll({ 
        user_id: TEST_USER_ID,
        project_id: testProject.id,
        start_date: yesterday,
        end_date: today,
      });

      entries.forEach(entry => {
        expect(entry.project_id).toBe(testProject.id);
      });
    });
  });

  describe('delete', () => {
    it('should delete a time entry', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
        description: 'Entry to delete'
      });
      
      const result = await timeEntryService.delete(newEntry.id);
      expect(result).toBe(true);
      
      const foundEntry = await timeEntryService.findById(newEntry.id);
      expect(foundEntry).toBeNull();
    });

    it('should return false for non-existent ID', async () => {
      const result = await timeEntryService.delete('00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });
  });

  describe('create with hourly rate', () => {
    it('should create entry with custom hourly rate', async () => {
      const entry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 2,
        hourly_rate: 120.00,
        is_billable: true,
      });
      
      expect(Number(entry.hourly_rate)).toBe(120);
    });

    it('should create entry with zero hourly rate for non-billable work', async () => {
      const entry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '14:00',
        duration_hours: 1,
        hourly_rate: 0,
        is_billable: false,
      });
      
      expect(Number(entry.hourly_rate)).toBe(0);
    });
  });

  describe('update hourly rate', () => {
    it('should update hourly rate', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
        hourly_rate: 50,
      });
      
      const updated = await timeEntryService.update(newEntry.id, { hourly_rate: 75 });
      expect(Number(updated?.hourly_rate)).toBe(75);
    });
  });

  describe('create with times', () => {
    it('should create entry with start and end time', async () => {
      const entry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '09:00',
        entry_end_time: '12:30',
        duration_hours: 3.5,
      });
      
      expect(entry.entry_time).toContain('09:00');
      expect(entry.entry_end_time).toContain('12:30');
    });
  });

  describe('update tags', () => {
    it('should update tags on entry', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
        tags: ['old-tag'],
      });
      
      const updated = await timeEntryService.update(newEntry.id, { tags: ['new-tag', 'another-tag'] });
      expect(updated?.tags).toContain('new-tag');
      expect(updated?.tags).toContain('another-tag');
    });

    it('should clear tags with empty array', async () => {
      const newEntry = await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '11:00',
        duration_hours: 1,
        tags: ['tag-to-remove'],
      });
      
      const updated = await timeEntryService.update(newEntry.id, { tags: [] });
      expect(updated?.tags).toEqual([]);
    });
  });

  describe('filter entries', () => {
    it('should filter by project for billable entries', async () => {
      await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '10:00',
        duration_hours: 1,
        is_billable: true,
      });

      const entries = await timeEntryService.findAll({ 
        user_id: TEST_USER_ID,
        project_id: testProject.id,
      });

      expect(entries.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter by date range', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      await timeEntryService.create({ 
        user_id: TEST_USER_ID, 
        project_id: testProject.id, 
        entry_date: new Date(),
        entry_time: '15:00',
        duration_hours: 1,
        is_billable: false,
      });

      const entries = await timeEntryService.findAll({ 
        user_id: TEST_USER_ID,
        start_date: yesterday,
        end_date: today,
      });

      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
  });
});

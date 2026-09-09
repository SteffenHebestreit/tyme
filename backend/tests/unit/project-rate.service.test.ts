import { ProjectRateService } from '../../src/services/business/project-rate.service';
import { ProjectService } from '../../src/services/business/project.service';
import { ClientService } from '../../src/services/business/client.service';
import { TimeEntryService } from '../../src/services/business/time-entry.service';
import { getDbClient } from '../../src/utils/database';
import { Client } from '../../src/models/business/client.model';
import { TEST_USER_ID } from '../setup';

/** Local YYYY-MM-DD for a date offset by N days from today. */
function ymd(daysFromToday = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().split('T')[0];
}

const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999';

describe('ProjectRateService', () => {
  let rateService: ProjectRateService;
  let projectService: ProjectService;
  let clientService: ClientService;
  let timeEntryService: TimeEntryService;
  let testClient: Client;
  const db = getDbClient();

  beforeAll(async () => {
    rateService = new ProjectRateService();
    projectService = new ProjectService();
    clientService = new ClientService();
    timeEntryService = new TimeEntryService();

    // Mirrors the startup migration so the test is self-contained regardless of
    // the test container's init.sql vintage.
    await db.query(`
      CREATE TABLE IF NOT EXISTS project_rate_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        hourly_rate NUMERIC(10,2) NOT NULL CHECK (hourly_rate >= 0),
        valid_from DATE NOT NULL,
        note TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_project_rate_history_project_date
        ON project_rate_history(project_id, valid_from);
    `);

    testClient = await clientService.create({ user_id: TEST_USER_ID, name: 'Rate Test Client' });
  });

  /**
   * Creates a project WITHOUT a rate by default, so a test that builds its own
   * timeline starts from an empty one. Creating a project with a rate now opens
   * an initial period automatically, which would otherwise collide with the
   * periods the test adds itself.
   */
  async function makeProject(hourlyRate: number | null = null) {
    return projectService.create({
      user_id: TEST_USER_ID,
      name: 'Rate Test Project',
      client_id: testClient.id,
      status: 'active' as const,
      hourly_rate: hourlyRate ?? undefined,
    });
  }

  describe('getEffectiveRate', () => {
    it('returns the rate whose period covers the given date', async () => {
      const project = await makeProject();
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 100, valid_from: ymd(-60) });
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 150, valid_from: ymd(-10) });

      expect(await rateService.getEffectiveRate(project.id, TEST_USER_ID, ymd(-30))).toBe(100);
      expect(await rateService.getEffectiveRate(project.id, TEST_USER_ID, ymd(-1))).toBe(150);
    });

    it('treats valid_from as inclusive', async () => {
      const project = await makeProject();
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 100, valid_from: ymd(-30) });
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 200, valid_from: ymd(-10) });

      expect(await rateService.getEffectiveRate(project.id, TEST_USER_ID, ymd(-10))).toBe(200);
      expect(await rateService.getEffectiveRate(project.id, TEST_USER_ID, ymd(-11))).toBe(100);
    });

    it('prices work before the first agreed rate at the earliest rate, not today\'s', async () => {
      const project = await makeProject(null);
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 100, valid_from: ymd(-10) });
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 300, valid_from: ymd(-1) });

      // Returning null here would leave the entry unstamped, and invoicing
      // COALESCEs an unstamped entry to the project's CURRENT rate — which is
      // the retroactive pricing this feature exists to prevent.
      expect(await rateService.getEffectiveRate(project.id, TEST_USER_ID, ymd(-20))).toBe(100);
    });

    it('returns null only when the project has no rate at all', async () => {
      const project = await makeProject(null);

      expect(await rateService.getEffectiveRate(project.id, TEST_USER_ID, ymd(-20))).toBeNull();
    });

    it('ignores a future-dated rate when asked for today', async () => {
      const project = await makeProject();
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 100, valid_from: ymd(-5) });
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 999, valid_from: ymd(30) });

      expect(await rateService.getEffectiveRate(project.id, TEST_USER_ID)).toBe(100);
    });

    it('does not leak another tenant rate', async () => {
      const project = await makeProject();
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 100, valid_from: ymd(-5) });

      expect(await rateService.getEffectiveRate(project.id, OTHER_USER_ID)).toBeNull();
    });
  });

  describe('addRate', () => {
    it('syncs projects.hourly_rate when the period has already started', async () => {
      // No rate at creation, so the added period is the only one on the timeline.
      const project = await makeProject();
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 175, valid_from: ymd(-1) });

      const reloaded = await projectService.findById(project.id);
      expect(parseFloat(reloaded?.hourly_rate as any)).toBe(175);
    });

    it('leaves projects.hourly_rate alone for a future period', async () => {
      const project = await makeProject(100);
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 100, valid_from: ymd(-30) });
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 500, valid_from: ymd(60) });

      const reloaded = await projectService.findById(project.id);
      expect(parseFloat(reloaded?.hourly_rate as any)).toBe(100);
    });

    it('rejects a second rate starting on the same date', async () => {
      const project = await makeProject();
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 100, valid_from: ymd(-5) });

      await expect(
        rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 120, valid_from: ymd(-5) })
      ).rejects.toThrow(/already starts on that date/);
    });

    it('returns null for a project owned by someone else', async () => {
      const project = await makeProject();
      const result = await rateService.addRate(project.id, OTHER_USER_ID, {
        hourly_rate: 1,
        valid_from: ymd(0),
      });
      expect(result).toBeNull();
    });
  });

  describe('listRates', () => {
    it('derives valid_until from the next period and flags the current one', async () => {
      const project = await makeProject();
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 100, valid_from: ymd(-60) });
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 150, valid_from: ymd(-10) });
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 200, valid_from: ymd(45) });

      const periods = await rateService.listRates(project.id, TEST_USER_ID);

      expect(periods).toHaveLength(3);
      expect(periods[0].valid_until).toBe(ymd(-10));
      expect(periods[2].valid_until).toBeNull();
      expect(periods.map(p => p.is_current)).toEqual([false, true, false]);
    });

    it('returns nothing for another tenant', async () => {
      const project = await makeProject();
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 100, valid_from: ymd(-5) });

      expect(await rateService.listRates(project.id, OTHER_USER_ID)).toEqual([]);
    });
  });

  describe('updateRate / deleteRate', () => {
    it('updates a period and resyncs the project rate', async () => {
      const project = await makeProject();
      const rate = await rateService.addRate(project.id, TEST_USER_ID, {
        hourly_rate: 100,
        valid_from: ymd(-5),
      });

      const updated = await rateService.updateRate(rate!.id, TEST_USER_ID, { hourly_rate: 133 });
      expect(updated?.hourly_rate).toBe(133);

      const reloaded = await projectService.findById(project.id);
      expect(parseFloat(reloaded?.hourly_rate as any)).toBe(133);
    });

    it('refuses to update another tenant rate', async () => {
      const project = await makeProject();
      const rate = await rateService.addRate(project.id, TEST_USER_ID, {
        hourly_rate: 100,
        valid_from: ymd(-5),
      });

      expect(await rateService.updateRate(rate!.id, OTHER_USER_ID, { hourly_rate: 1 })).toBeNull();
    });

    it('deletes a period', async () => {
      const project = await makeProject();
      const rate = await rateService.addRate(project.id, TEST_USER_ID, {
        hourly_rate: 100,
        valid_from: ymd(-5),
      });

      expect(await rateService.deleteRate(rate!.id, TEST_USER_ID)).toBe(true);
      expect(await rateService.listRates(project.id, TEST_USER_ID)).toHaveLength(0);
    });

    it('refuses to delete another tenant rate', async () => {
      const project = await makeProject();
      const rate = await rateService.addRate(project.id, TEST_USER_ID, {
        hourly_rate: 100,
        valid_from: ymd(-5),
      });

      expect(await rateService.deleteRate(rate!.id, OTHER_USER_ID)).toBe(false);
    });
  });

  // The behaviour the whole feature exists for.
  describe('time entries are priced at the rate agreed when the work happened', () => {
    it('stamps the rate effective on entry_date', async () => {
      const project = await makeProject();
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 100, valid_from: ymd(-60) });
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 150, valid_from: ymd(-10) });

      const older = await timeEntryService.create({
        user_id: TEST_USER_ID,
        project_id: project.id,
        description: 'work before the raise',
        entry_date: ymd(-30) as any,
        entry_time: '09:00:00',
        duration_hours: 2,
        is_billable: true,
      } as any);

      const newer = await timeEntryService.create({
        user_id: TEST_USER_ID,
        project_id: project.id,
        description: 'work after the raise',
        entry_date: ymd(-2) as any,
        entry_time: '09:00:00',
        duration_hours: 2,
        is_billable: true,
      } as any);

      expect(parseFloat(older.hourly_rate as any)).toBe(100);
      expect(parseFloat(newer.hourly_rate as any)).toBe(150);
    });

    it('does not re-price a logged entry when the rate is raised afterwards', async () => {
      const project = await makeProject();
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 100, valid_from: ymd(-30) });

      const entry = await timeEntryService.create({
        user_id: TEST_USER_ID,
        project_id: project.id,
        description: 'already logged',
        entry_date: ymd(-5) as any,
        entry_time: '09:00:00',
        duration_hours: 3,
        is_billable: true,
      } as any);

      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 250, valid_from: ymd(0) });

      const reloaded = await timeEntryService.findById(entry.id);
      expect(parseFloat(reloaded?.hourly_rate as any)).toBe(100);
    });

    it('lets an explicitly supplied rate win, including zero', async () => {
      const project = await makeProject();
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 100, valid_from: ymd(-30) });

      const entry = await timeEntryService.create({
        user_id: TEST_USER_ID,
        project_id: project.id,
        description: 'goodwill, not charged',
        entry_date: ymd(-1) as any,
        entry_time: '09:00:00',
        duration_hours: 1,
        is_billable: true,
        hourly_rate: 0,
      } as any);

      expect(parseFloat(entry.hourly_rate as any)).toBe(0);
    });
  });
  // The project edit form is the most common way a rate gets changed, so it
  // must feed the timeline too — otherwise the displayed rate and the rate new
  // entries are stamped with silently diverge.
  describe('project form edits keep the timeline in sync', () => {
    it('opens a period when a project is created with a rate', async () => {
      const project = await makeProject(90);

      const periods = await rateService.listRates(project.id, TEST_USER_ID);

      expect(periods).toHaveLength(1);
      expect(periods[0].hourly_rate).toBe(90);
    });

    it('opens a new period when the rate is edited on the project', async () => {
      const project = await makeProject(100);
      await projectService.update(project.id, { hourly_rate: 180 });

      expect(await rateService.getEffectiveRate(project.id, TEST_USER_ID)).toBe(180);
    });

    it('does not re-price work logged before the project rate was edited', async () => {
      const project = await makeProject(100);
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 100, valid_from: ymd(-30) });

      const entry = await timeEntryService.create({
        user_id: TEST_USER_ID,
        project_id: project.id,
        description: 'logged before the change',
        entry_date: ymd(-3) as any,
        entry_time: '09:00:00',
        duration_hours: 2,
        is_billable: true,
      } as any);

      await projectService.update(project.id, { hourly_rate: 400 });

      const reloaded = await timeEntryService.findById(entry.id);
      expect(parseFloat(reloaded?.hourly_rate as any)).toBe(100);
      expect(await rateService.getEffectiveRate(project.id, TEST_USER_ID)).toBe(400);
    });
  });
});

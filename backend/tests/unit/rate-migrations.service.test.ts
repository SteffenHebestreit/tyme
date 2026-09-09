import { ensureMigrationLedger, runOnce, hasRun, markAsRun } from '../../src/utils/migrations';
import { repairTimeEntryRates } from '../../src/services/business/time-entry-rate-repair.service';
import { ProjectRateService } from '../../src/services/business/project-rate.service';
import { ProjectService } from '../../src/services/business/project.service';
import { ClientService } from '../../src/services/business/client.service';
import { getDbClient } from '../../src/utils/database';
import { Client } from '../../src/models/business/client.model';
import { TEST_USER_ID } from '../setup';

function ymd(daysFromToday = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().split('T')[0];
}

describe('rate migrations and repair', () => {
  const db = getDbClient();
  let clientService: ClientService;
  let projectService: ProjectService;
  let rateService: ProjectRateService;
  let testClient: Client;

  beforeAll(async () => {
    clientService = new ClientService();
    projectService = new ProjectService();
    rateService = new ProjectRateService();

    // Mirrors the startup migrations so the test is self-contained.
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
      CREATE INDEX IF NOT EXISTS idx_time_entries_unstamped
        ON time_entries(project_id, entry_date) WHERE hourly_rate IS NULL AND project_id IS NOT NULL;
    `);
    await ensureMigrationLedger();
    testClient = await clientService.create({ user_id: TEST_USER_ID, name: 'Migration Test Client' });
  });

  beforeEach(async () => {
    await db.query(`DELETE FROM schema_migrations WHERE name LIKE 'test_%'`);
  });

  describe('runOnce', () => {
    it('runs the work exactly once across two calls', async () => {
      const work = jest.fn(async () => undefined);

      const first = await runOnce('test_once', work);
      const second = await runOnce('test_once', work);

      expect(first).toBe('applied');
      expect(second).toBe('skipped');
      expect(work).toHaveBeenCalledTimes(1);
    });

    it('does not record the migration when the work throws', async () => {
      const outcome = await runOnce('test_failing', async (client) => {
        await client.query(`SELECT 1`);
        throw new Error('boom');
      });

      expect(outcome).toBe('failed');
      // The ledger must never claim work that did not happen, or the migration
      // would be skipped forever without ever having run.
      expect(await hasRun('test_failing')).toBe(false);
    });

    it('rolls back the work when it throws after writing', async () => {
      await runOnce('test_rollback', async (client) => {
        await client.query(
          `INSERT INTO schema_migrations (name) VALUES ('test_probe_row')`
        );
        throw new Error('boom');
      });

      expect(await hasRun('test_probe_row')).toBe(false);
    });

    it('markAsRun adopts work a previous release already did', async () => {
      expect(await markAsRun('test_adopted', { adopted: true })).toBe(true);
      expect(await hasRun('test_adopted')).toBe(true);

      const work = jest.fn(async () => undefined);
      expect(await runOnce('test_adopted', work)).toBe('skipped');
      expect(work).not.toHaveBeenCalled();
    });
  });

  describe('repairTimeEntryRates', () => {
    async function projectWithTimeline() {
      const project = await projectService.create({
        user_id: TEST_USER_ID,
        name: 'Repair Project',
        client_id: testClient.id,
      });
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 100, valid_from: ymd(-60) });
      await rateService.addRate(project.id, TEST_USER_ID, { hourly_rate: 150, valid_from: ymd(-10) });
      return project;
    }

    async function insertUnstamped(projectId: string, entryDate: string) {
      const r = await db.query(
        `INSERT INTO time_entries (user_id, project_id, description, entry_date, entry_time, duration_hours, is_billable, hourly_rate)
         VALUES ($1, $2, 'unstamped', $3, '09:00:00', 2, true, NULL) RETURNING id`,
        [TEST_USER_ID, projectId, entryDate]
      );
      return r.rows[0].id;
    }

    it('stamps from the covering period, never from the current project rate', async () => {
      const project = await projectWithTimeline();
      // A third value on the project: if the repair read it, the test fails.
      await db.query(`UPDATE projects SET hourly_rate = 999 WHERE id = $1`, [project.id]);
      const id = await insertUnstamped(project.id, ymd(-30));

      await repairTimeEntryRates(TEST_USER_ID);

      const row = await db.query(`SELECT hourly_rate FROM time_entries WHERE id = $1`, [id]);
      expect(parseFloat(row.rows[0].hourly_rate)).toBe(100);
    });

    it('stamps work predating the timeline at the earliest rate', async () => {
      const project = await projectWithTimeline();
      const id = await insertUnstamped(project.id, ymd(-90));

      await repairTimeEntryRates(TEST_USER_ID);

      const row = await db.query(`SELECT hourly_rate FROM time_entries WHERE id = $1`, [id]);
      // Not NULL: an unstamped entry gets re-priced at the project's current
      // rate by invoicing, which is what this feature removes.
      expect(parseFloat(row.rows[0].hourly_rate)).toBe(100);
    });

    it('is deterministic when the current project rate changes in between', async () => {
      const project = await projectWithTimeline();
      const id = await insertUnstamped(project.id, ymd(-30));

      await repairTimeEntryRates(TEST_USER_ID);
      const first = (await db.query(`SELECT hourly_rate FROM time_entries WHERE id = $1`, [id])).rows[0].hourly_rate;

      await db.query(`UPDATE projects SET hourly_rate = 777 WHERE id = $1`, [project.id]);
      await repairTimeEntryRates(TEST_USER_ID);
      const second = (await db.query(`SELECT hourly_rate FROM time_entries WHERE id = $1`, [id])).rows[0].hourly_rate;

      expect(second).toBe(first);
    });

    it('leaves an entry unpriceable when its project has no timeline at all', async () => {
      const project = await projectService.create({
        user_id: TEST_USER_ID,
        name: 'No Rate Project',
        client_id: testClient.id,
      });
      const id = await insertUnstamped(project.id, ymd(-5));

      const result = await repairTimeEntryRates(TEST_USER_ID);

      const row = await db.query(`SELECT hourly_rate FROM time_entries WHERE id = $1`, [id]);
      expect(row.rows[0].hourly_rate).toBeNull();
      expect(result.unpriceable).toBeGreaterThan(0);
    });
  });
});

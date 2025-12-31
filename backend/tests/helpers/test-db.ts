/**
 * Test Database Helpers
 * Utility functions for database operations during testing
 */

import { getDbClient } from '../../src/utils/database';

// Test user ID - should match what's used in tests
export const TEST_USER_ID = '123e4567-e89b-12d3-a456-426614174000';

// Tables that contain user data (in order for safe deletion)
const USER_DATA_TABLES = [
  'depreciation_schedules',
  'time_entries',
  'invoice_items', 
  'payments',
  'invoices',
  'expenses',
  'projects',
  'clients',
  'tax_prepayments',
  'settings',
];

/**
 * Get the test database client
 * Uses the main database utility which is configured for test env
 */
export function getTestDbClient() {
  return getDbClient();
}

/**
 * Clean all test data for the test user
 */
export async function cleanTestData(): Promise<void> {
  const db = getDbClient();
  
  for (const table of USER_DATA_TABLES) {
    try {
      await db.query(`DELETE FROM ${table} WHERE user_id = $1`, [TEST_USER_ID]);
    } catch (error: any) {
      // Ignore errors for tables that might not exist or have different structure
      if (!error.message.includes('does not exist') && !error.message.includes('column "user_id"')) {
        console.warn(`Warning cleaning ${table}:`, error.message);
      }
    }
  }
}

/**
 * Truncate all test tables (more aggressive cleanup)
 * Use with caution - this removes ALL data, not just test user data
 */
export async function truncateAllTables(): Promise<void> {
  const db = getDbClient();
  
  try {
    await db.query(`
      TRUNCATE TABLE 
        ${USER_DATA_TABLES.join(', ')}
      RESTART IDENTITY CASCADE
    `);
  } catch (error: any) {
    console.warn('Warning truncating tables:', error.message);
  }
}

/**
 * Verify the test database schema is ready
 */
export async function verifyTestSchema(): Promise<boolean> {
  const db = getDbClient();
  
  try {
    await db.query('SELECT 1 FROM clients LIMIT 1');
    await db.query('SELECT 1 FROM projects LIMIT 1');
    await db.query('SELECT 1 FROM invoices LIMIT 1');
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Create a test client for use in tests
 */
export async function createTestClient(overrides: Record<string, any> = {}) {
  const db = getDbClient();
  
  const defaultClient = {
    user_id: TEST_USER_ID,
    name: 'Test Client',
    email: 'test@example.com',
    status: 'active',
  };
  
  const clientData = { ...defaultClient, ...overrides };
  
  const result = await db.query(`
    INSERT INTO clients (user_id, name, email, status)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [clientData.user_id, clientData.name, clientData.email, clientData.status]);
  
  return result.rows[0];
}

/**
 * Create a test project for use in tests
 */
export async function createTestProject(clientId: string, overrides: Record<string, any> = {}) {
  const db = getDbClient();
  
  const defaultProject = {
    user_id: TEST_USER_ID,
    client_id: clientId,
    name: 'Test Project',
    status: 'active',
  };
  
  const projectData = { ...defaultProject, ...overrides };
  
  const result = await db.query(`
    INSERT INTO projects (user_id, client_id, name, status)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [projectData.user_id, projectData.client_id, projectData.name, projectData.status]);
  
  return result.rows[0];
}

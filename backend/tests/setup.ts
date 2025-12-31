/**
 * Jest Test Setup
 * Configures test environment and database cleanup for each test
 */

// Set NODE_ENV before any imports
process.env.NODE_ENV = 'test';

import dotenv from 'dotenv';
import path from 'path';

// Load test environment variables
const envPath = process.env.DOCKER_ENV 
  ? path.resolve(__dirname, '../.env.test.docker')
  : path.resolve(__dirname, '../.env.test');

dotenv.config({ path: envPath });

import { getDbClient, closeDbConnection } from '../src/utils/database';

// Store test user ID globally - matches the test user in database
export const TEST_USER_ID = '123e4567-e89b-12d3-a456-426614174000';

// Tables to clean in the correct order (respecting foreign keys)
const TABLES_TO_CLEAN = [
  'depreciation_schedules',
  'time_entries',
  'invoice_items',
  'payments',
  'invoices',
  'expenses',
  'projects',
  'clients',
  'tax_prepayments',
  // Don't clean settings as we need it for the test user FK reference
];

/**
 * Ensure test user exists in settings table for foreign key references
 */
async function ensureTestUser(): Promise<void> {
  const db = getDbClient();
  
  // Insert test user into settings if not exists
  // This is required because tax_prepayments has FK to settings(user_id)
  await db.query(`
    INSERT INTO settings (user_id)
    VALUES ($1)
    ON CONFLICT (user_id) DO NOTHING
  `, [TEST_USER_ID]);
}

/**
 * Clean all test data from the database
 */
async function cleanDatabase(): Promise<void> {
  const db = getDbClient();
  
  for (const table of TABLES_TO_CLEAN) {
    try {
      await db.query(`DELETE FROM ${table} WHERE user_id = $1`, [TEST_USER_ID]);
    } catch (error: any) {
      // Table might not exist or have different structure - ignore
      if (!error.message.includes('does not exist') && !error.message.includes('column "user_id"')) {
        console.warn(`Warning cleaning ${table}:`, error.message);
      }
    }
  }
}

// Global setup: Verify database connection and clean once before all tests in this file
beforeAll(async () => {
  console.log('🔧 Setting up test database...');
  
  const db = getDbClient();
  
  // Verify the database is ready by checking for a core table
  try {
    await db.query('SELECT 1 FROM clients LIMIT 1');
    console.log(`✅ Test database ready with test user: ${TEST_USER_ID}`);
  } catch (error: any) {
    console.error('❌ Test database not ready:', error.message);
    throw new Error('Test database schema not initialized. Ensure tyme-test-db container is running with init.sql.');
  }
  
  // Ensure test user exists for foreign key references (e.g., tax_prepayments)
  await ensureTestUser();
  
  // Clean database once at the start of this test file
  await cleanDatabase();
}, 30000);

// NOTE: We don't clean between tests to allow test suites to build on each other
// (e.g., create client in beforeAll, use in tests)
// Each test file starts fresh due to the beforeAll cleanup

// Clean up after all tests in this file
afterAll(async () => {
  await cleanDatabase();
  await closeDbConnection();
});


// Global teardown: Close database connection after all tests
afterAll(async () => {
  await cleanDatabase();
  await closeDbConnection();
});

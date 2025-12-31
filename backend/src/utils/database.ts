import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = process.env.NODE_ENV === 'test' 
  ? '.env.test' 
  : '.env';

dotenv.config({ path: path.resolve(process.cwd(), envFile) });

// Fallback to default .env if test env file doesn't exist
if (!process.env.DATABASE_URL) {
  dotenv.config();
}

// Ensure environment variables are loaded
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('Missing required database environment variable (DATABASE_URL)');
}

/**
 * PostgreSQL connection pool for database operations.
 * Configured via DATABASE_URL environment variable.
 * Automatically uses test database when NODE_ENV=test.
 * 
 * @constant {Pool}
 */
let pool: Pool | null = null;

const getPool = (): Pool => {
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      // ssl: { rejectUnauthorized: false }, // Uncomment if using SSL with self-signed certs
    });
  }
  return pool;
};

/**
 * Tests the database connection by executing a simple query.
 * Should be called during application startup to ensure database connectivity.
 * 
 * @async
 * @returns {Promise<void>} Resolves if connection is successful
 * @throws {Error} If database connection fails
 * 
 * @example
 * await testConnection();
 * console.log('Database is ready');
 */
const testConnection = async (): Promise<void> => {
  try {
    const db = getPool();
    await db.query('SELECT NOW()');
    console.log('✅ Database connection successful.');
  } catch (err) {
    console.error('❌ Database connection failed:', err);
    throw err; // Rethrow to be caught by the caller
  }
};

/**
 * Returns the PostgreSQL connection pool for executing queries.
 * Use this to obtain a database client for running SQL queries.
 * 
 * @returns {Pool} The PostgreSQL connection pool
 * 
 * @example
 * const db = getDbClient();
 * const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
 */
const getDbClient = (): Pool => {
  return getPool();
};

/**
 * Closes the database connection pool.
 * Should be called when shutting down the application or after tests.
 * 
 * @async
 * @returns {Promise<void>}
 */
const closeDbConnection = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('✅ Database connection closed.');
  }
};

export { testConnection, getDbClient, closeDbConnection };

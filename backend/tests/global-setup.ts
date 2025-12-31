/**
 * Jest Global Setup
 * Runs once before all test suites
 * Sets up test environment and verifies database connectivity
 */

import dotenv from 'dotenv';
import path from 'path';
import { Pool } from 'pg';

export default async function globalSetup(): Promise<void> {
  // Set NODE_ENV to test
  process.env.NODE_ENV = 'test';
  
  // Load test environment variables
  const envPath = process.env.DOCKER_ENV 
    ? path.resolve(__dirname, '../.env.test.docker')
    : path.resolve(__dirname, '../.env.test');
  
  dotenv.config({ path: envPath });
  
  console.log('\n🧪 Jest Global Setup');
  console.log(`📁 Environment: ${process.env.NODE_ENV}`);
  console.log(`🗄️  Database: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@')}`);
  
  // Verify test database is accessible
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  
  try {
    const result = await pool.query('SELECT NOW() as time');
    console.log(`✅ Test database connection verified at ${result.rows[0].time}\n`);
  } catch (error: any) {
    console.error('❌ Test database not accessible:', error.message);
    console.error('\n📋 Make sure tyme-test-db container is running:');
    console.error('   docker compose up -d tyme-test-db\n');
    throw new Error('Test database not accessible. Is the tyme-test-db container running?');
  } finally {
    await pool.end();
  }
}

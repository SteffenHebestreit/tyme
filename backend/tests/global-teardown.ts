/**
 * Jest Global Teardown
 * Runs once after all test suites complete
 * Cleans up resources
 */

export default async function globalTeardown(): Promise<void> {
  console.log('\n🧹 Jest Global Teardown');
  console.log('✅ All tests completed\n');
}

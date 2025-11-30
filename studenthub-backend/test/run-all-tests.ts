#!/usr/bin/env ts-node

/**
 * Test runner script
 * Runs all tests and generates coverage report
 */

import { execSync } from 'child_process';
import * as path from 'path';

console.log('🧪 Running all Auth Module tests...\n');

try {
  console.log('📋 Running unit tests...');
  execSync('npm run test', { stdio: 'inherit', cwd: __dirname + '/..' });

  console.log('\n📋 Running E2E tests...');
  execSync('npm run test:e2e', { stdio: 'inherit', cwd: __dirname + '/..' });

  console.log('\n✅ All tests completed successfully!');
} catch (error) {
  console.error('\n❌ Tests failed:', error.message);
  process.exit(1);
}


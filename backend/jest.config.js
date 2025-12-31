module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  globalSetup: '<rootDir>/tests/global-setup.ts',
  globalTeardown: '<rootDir>/tests/global-teardown.ts',
  testTimeout: 15000, // 15 seconds per test
  maxWorkers: 1, // Run tests serially to avoid database conflicts
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    // Exclude external/system services that require external dependencies
    '!src/services/external/**',
    '!src/services/storage/**',
    '!src/services/system/**',
    '!src/services/mcp/**',
    '!src/services/ai/**',
    '!src/services/auth/**',
    '!src/services/analytics/report*.ts',
    '!src/services/analytics/audit*.ts',
    '!src/services/financial/ai-depreciation.service.ts',
    '!src/services/financial/recurring-expense-scheduler.service.ts',
    '!src/services/financial/invoice-text-template.service.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'cobertura'],
  coverageThreshold: {
    // Global threshold - realistic for current state
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
    // Business services - expense.service is complex (1400+ lines) with recurring logic
    // Other business services must meet 50% coverage
    './src/services/business/client.service.ts': {
      branches: 40,
      functions: 90,
      lines: 55,
      statements: 55,
    },
    './src/services/business/project.service.ts': {
      branches: 40,
      functions: 90,
      lines: 60,
      statements: 60,
    },
    './src/services/business/time-entry.service.ts': {
      branches: 50,
      functions: 90,
      lines: 70,
      statements: 70,
    },
    // Financial services must meet 50% coverage
    './src/services/financial/billing-validation.service.ts': {
      branches: 70,
      functions: 70,
      lines: 80,
      statements: 80,
    },
    './src/services/financial/invoice.service.ts': {
      branches: 40,
      functions: 80,
      lines: 50,
      statements: 50,
    },
    './src/services/financial/payment.service.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    './src/services/financial/tax-rate.service.ts': {
      branches: 80,
      functions: 90,
      lines: 80,
      statements: 80,
    },
    // Analytics service must meet high coverage
    './src/services/analytics/analytics.service.ts': {
      branches: 50,
      functions: 70,
      lines: 90,
      statements: 90,
    },
  },
  // Verbose output for CI/CD
  verbose: true,
  // Force exit after tests complete
  forceExit: true,
  // Detect open handles
  detectOpenHandles: true,
  // Jest-junit configuration for CI/CD
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'coverage',
      outputName: 'junit.xml',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}',
      ancestorSeparator: ' › ',
      usePathForSuiteName: true,
    }],
  ],
};

import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/setupEnv.ts'],
  testTimeout: 60000,
  collectCoverageFrom: [
    'src/engines/**/*.ts',
    'src/services/**/*.ts',
    'src/controllers/**/*.ts',
    'src/middleware/**/*.ts',
    'src/utils/**/*.ts',
  ],
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
};

export default config;

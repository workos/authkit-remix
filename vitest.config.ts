import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Automatically clear mock calls, instances, contexts and results before every test
    clearMocks: true,

    // Automatically reset mock state between every test
    mockReset: true,

    // Indicates whether the coverage information should be collected while executing the test
    coverage: {
      enabled: true,
      // Coverage thresholds
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },

    // Indicates whether each individual test should be reported during the run
    reporters: ['verbose'],

    // Define multiple projects similar to Jest's projects configuration
    projects: [
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['**/*.spec.tsx', '**/__tests__/**/*.spec.tsx'],
        },
      },
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['**/*.spec.ts', '**/__tests__/**/*.spec.ts'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});

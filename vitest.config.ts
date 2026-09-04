import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // Ratchet set to the coverage currently produced by the suite so that
      // future changes cannot silently reduce it.
      thresholds: {
        statements: 76,
        branches: 62,
        functions: 88,
        lines: 76,
      },
    },
  },
});

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
        statements: 76.9,
        branches: 62.8,
        functions: 89.2,
        lines: 76.7,
      },
    },
  },
});

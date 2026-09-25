import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000, // real AI provider calls (esp. reasoning models) are much slower than mocked unit tests
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // use describe/test/expect without importing
    include: ['test/**/*.test.js'], // specify your test file pattern
    exclude: ['**/node_modules/**', 'test/integration/**'], // integration tests hit a real AI provider - run via `npm run test:integration`
    environment: 'node', // or 'happy-dom' if you're testing DOM-related code
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.js'],
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,        // use describe/test/expect without importing
    include: ['test/**/*.test.js'], // specify your test file pattern
    environment: 'node',  // or 'happy-dom' if you're testing DOM-related code
  },
});
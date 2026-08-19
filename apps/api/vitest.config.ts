import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure unit tests over the email helpers — no database or SMTP required.
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});

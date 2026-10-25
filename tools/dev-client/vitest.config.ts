import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'dev-client',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});

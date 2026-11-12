import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'language-routing',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'stt',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});

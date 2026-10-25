import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'stt-runner',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});

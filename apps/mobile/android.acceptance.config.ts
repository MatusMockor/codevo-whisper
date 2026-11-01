import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'android-acceptance', environment: 'node', include: ['../server/test/mobile-android.acceptance.ts'], testTimeout: 180_000 },
});

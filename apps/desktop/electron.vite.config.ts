import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { fileURLToPath } from 'node:url';
import { devContentSecurityPolicy } from './vite/dev-content-security-policy';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  main: {},
  preload: {
    build: {
      rolldownOptions: {
        input: { index: source('./src/preload/index.ts'), capture: source('./src/preload/capture.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react(), devContentSecurityPolicy()],
    build: {
      rolldownOptions: {
        input: { index: source('./src/renderer/index.html'), capture: source('./src/renderer/capture/capture.html') },
      },
    },
  },
});

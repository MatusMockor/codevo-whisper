import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { devContentSecurityPolicy } from './vite/dev-content-security-policy';

export default defineConfig({
  main: {},
  preload: {
    build: {
      rolldownOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react(), devContentSecurityPolicy()],
  },
});

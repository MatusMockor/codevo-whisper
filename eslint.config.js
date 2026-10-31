import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['**/node_modules/**', 'apps/mobile/android/**/build/**', 'apps/mobile/android/.gradle/**', 'apps/mobile/android/.kotlin/**', 'apps/mobile/ios/Pods/**', 'apps/mobile/ios/build/**', '**/out/**', '**/dist/**', 'apps/*/release/**', '**/test-results/**', '**/playwright-report/**', 'spikes/**', 'docs/**', 'native/transcribe/work/**', 'native/stt-worker/work/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'IfStatement[alternate]', message: 'Use a guard clause or early return instead of else.' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/*/src/renderer/**/*.{ts,tsx}', 'apps/mobile/src/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['**/*.{js,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  { files: ['apps/mobile/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
);

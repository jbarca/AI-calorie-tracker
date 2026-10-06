// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.expo/**',
      '**/dist/**',
      '**/web-build/**',
      '**/coverage/**',
      'app/ios/**',
      'app/android/**',
      'app/expo-env.d.ts',
      // Maestro flow scripts run in Maestro's JS runtime (globals: http, output, env values).
      'app/.maestro/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Expo app (React Native)
    files: ['app/**/*.{ts,tsx,js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, __DEV__: 'readonly' },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Node-side config files and repo scripts
    files: [
      '**/*.config.{js,mjs,cjs,ts}',
      '**/babel.config.js',
      '**/metro.config.js',
      'scripts/**/*.{js,mjs}',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // Supabase Edge Functions run on Deno
    files: ['supabase/functions/**/*.ts'],
    languageOptions: { globals: { Deno: 'readonly' } },
  },
  prettier,
);

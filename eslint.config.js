// ESLint flat config for the monorepo.
//
// packages/sdk is linted with type information (`strictTypeChecked` and
// `stylisticTypeChecked`) plus the rules below that keep it small, layered and
// runtime-neutral. Everything else (the repo's scripts, and the LEGACY packages
// waiting for their phase of the rewrite) gets the recommended rules.

import js from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import tseslint from 'typescript-eslint';

const SDK = 'packages/sdk';

// Globals that exist only on Node (or only in browsers): the SDK runs on both, and on
// edge runtimes, so it reaches the runtime only through src/core/runtime.ts.
const RUNTIME_GLOBALS = ['process', 'Buffer', 'global', 'require', '__dirname', '__filename', 'window', 'document'].map(
  (name) => ({ name, message: 'Reach the runtime through src/core/runtime.ts.' }),
);

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.local.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // `_`-prefixed parameters and bindings are deliberately unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    // CommonJS configuration (dependency-cruiser reads .cjs).
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', require: 'readonly' } },
  },
  {
    // The repo's own Node scripts (spec sync, generators, smoke checks).
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } },
  },

  // ---------------------------------------------------------------- packages/sdk
  {
    files: [`${SDK}/**/*.ts`],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked, comments.recommended],
    languageOptions: {
      parserOptions: { project: [`${SDK}/tsconfig.test.json`], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
      '@eslint-community/eslint-comments/no-unused-disable': 'error',
      complexity: ['error', 10],
      'max-lines': ['error', { max: 400 }],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    // The shipped sources: no Node-only globals or modules.
    files: [`${SDK}/src/**/*.ts`],
    ignores: [`${SDK}/src/core/runtime.ts`],
    rules: {
      'no-restricted-globals': ['error', ...RUNTIME_GLOBALS],
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*'], message: 'The SDK runs outside Node too: no node: modules.' }] },
      ],
    },
  },
  {
    // Request builders, resources and tools work on typed values from end to end; the
    // one response cast lives in src/core/call.ts.
    files: [`${SDK}/src/requests/**/*.ts`, `${SDK}/src/resources/**/*.ts`, `${SDK}/src/tools/**/*.ts`],
    rules: { '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }] },
  },
  {
    files: [`${SDK}/src/resources/**/*.ts`],
    rules: { 'max-lines': ['error', { max: 250 }] },
  },
  {
    // Tests: a describe block is long by nature, and tables of cases read better whole.
    files: [`${SDK}/tests/**/*.ts`],
    rules: { 'max-lines-per-function': 'off', 'max-lines': ['error', { max: 600 }] },
  },
  {
    // Generated from spec/ by scripts/gen-*.mjs; `check:generated` keeps them right.
    files: [`${SDK}/src/generated/**/*.ts`],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
  },
);

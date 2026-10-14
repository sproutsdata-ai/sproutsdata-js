// ESLint flat config for every workspace. `recommended` rules only, without
// type information: `tsc --noEmit` (strict) already runs per package, so the
// linter stays fast and catches what the compiler does not.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.local.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // `_`-prefixed parameters and bindings are deliberately unused (hook
      // signatures, `for await (const _ of …)` counters).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    // The repo's own Node scripts (spec sync, code generators).
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);

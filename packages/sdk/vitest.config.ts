import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The live suite (`npm run e2e`) calls the local stack; `vitest.e2e.config.ts` runs it.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    // Type-level tests (`*.test-d.ts`) assert what the public types accept and refuse.
    typecheck: { enabled: true, include: ['tests/**/*.test-d.ts'], tsconfig: './tsconfig.test.json' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Generated from spec/: types and data tables, checked by `check:generated`.
      exclude: ['src/generated/**'],
      thresholds: {
        lines: 95,
        branches: 90,
        functions: 95,
        statements: 95,
        // Every call goes through the core; its decisions are the SDK's contract.
        'src/core/**': { lines: 98, branches: 95, functions: 98, statements: 98 },
        'src/core/{retry,errors,call}.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  },
});

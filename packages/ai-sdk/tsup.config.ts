import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // `engines.node` is >=22.12.0: `ai` is ESM-only, so the CommonJS build
  // loads it through require(esm), unflagged from Node 22.12.
  target: 'node22',
  // Keep class and function names as written. Without it the bundler renames
  // a class it has to disambiguate (`APIError` became `_APIError`), which
  // reaches callers through `err.name`, stack traces and `constructor.name`.
  keepNames: true,
});

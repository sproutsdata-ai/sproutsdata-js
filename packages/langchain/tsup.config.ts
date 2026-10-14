import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  // Keep class and function names as written. Without it the bundler renames
  // a class it has to disambiguate (`APIError` became `_APIError`), which
  // reaches callers through `err.name`, stack traces and `constructor.name`.
  keepNames: true,
});

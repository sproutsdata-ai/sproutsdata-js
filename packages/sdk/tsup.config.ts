import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', tools: 'src/tools/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // The package's Node floor (engines: >=22.12.0); every edge runtime it supports
  // understands the same syntax.
  target: 'es2023',
  platform: 'neutral',
  // Keep class and function names as written. Without it the bundler renames a
  // class it has to disambiguate (`APIError` became `_APIError`), which reaches
  // callers through `err.name`, stack traces and `constructor.name`.
  keepNames: true,
  // One shared chunk per format, so `sproutsdata` and `sproutsdata/tools` use the
  // same client and error classes: a client made from one entry passes
  // `instanceof` checks in the other, and so do the errors it throws.
  splitting: true,
});

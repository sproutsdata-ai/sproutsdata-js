/**
 * The built package, not the sources: what `npm install sproutsdata` hands a
 * caller. The bundler renames a class it has to disambiguate (`APIError`
 * became `_APIError`), which reaches every caller through `err.name`, stack
 * traces and `constructor.name` checks. `keepNames` in `tsup.config.ts` is
 * what prevents it; this file is what notices if it goes.
 *
 * The root `npm test` builds `packages/sdk` first. Run on its own, this file
 * needs `npm run build -w packages/sdk` beforehand.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const DIST_FILES = ['index.js', 'index.cjs', 'tools.js', 'tools.cjs'] as const;
const distPath = (file: string): string => fileURLToPath(new URL(`../dist/${file}`, import.meta.url));

const missing = DIST_FILES.filter((file) => !existsSync(distPath(file)));
if (missing.length > 0) {
  throw new Error(
    `packages/sdk/dist is not built (missing ${missing.join(', ')}). These tests check the ` +
      'published bundle: run `npm run build -w packages/sdk` first (the root `npm test` does).',
  );
}

type Module = Record<string, unknown>;
type ErrorClass = new (...args: never[]) => Error;

// Loaded by path at run time, so the type checker does not need a build.
const esm = {
  index: (await import(new URL('../dist/index.js', import.meta.url).href)) as Module,
  tools: (await import(new URL('../dist/tools.js', import.meta.url).href)) as Module,
};
const require = createRequire(import.meta.url);
const cjs = {
  index: require(distPath('index.cjs')) as Module,
  tools: require(distPath('tools.cjs')) as Module,
};

/** Every exported class: a function with its own prototype whose export name starts upper case. */
function exportedClasses(module: Module): Array<[exportName: string, value: { name: string }]> {
  return Object.entries(module).filter(
    (entry): entry is [string, { name: string }] =>
      typeof entry[1] === 'function' && /^[A-Z]/.test(entry[0]) && 'prototype' in entry[1],
  );
}

describe.each([
  ['ESM', esm],
  ['CJS', cjs],
])('the %s build', (_format, build) => {
  it('keeps the names of the classes callers check', () => {
    for (const name of ['SproutsData', 'SproutsDataError', 'ClientValidationError', 'APIError', 'InvalidRequestError']) {
      expect((build.index[name] as { name: string } | undefined)?.name).toBe(name);
    }
    expect((build.tools.Toolset as { name: string } | undefined)?.name).toBe('Toolset');
  });

  it('keeps the name of every exported class, in both entries', () => {
    const classes = [...exportedClasses(build.index), ...exportedClasses(build.tools)];
    expect(classes.length).toBeGreaterThan(20);
    for (const [exportName, value] of classes) expect(value.name, exportName).toBe(exportName);
  });

  it('gives a thrown error its class name', () => {
    const APIError = build.index.APIError as new (
      status: number,
      problem: undefined,
      headers: Record<string, string>,
    ) => Error;
    expect(new APIError(500, undefined, {}).name).toBe('APIError');
    const InvalidRequestError = build.index.InvalidRequestError as typeof APIError;
    expect(new InvalidRequestError(422, undefined, {}).name).toBe('InvalidRequestError');
    const ClientValidationError = build.index.ClientValidationError as new (message: string) => Error;
    expect(new ClientValidationError('refused').name).toBe('ClientValidationError');
  });

  it('builds the error a status maps to under its own name', () => {
    const from = (build.index.APIError as { from: (status: number, problem: undefined, headers: object) => Error })
      .from;
    for (const [status, name] of [
      [401, 'AuthenticationError'],
      [402, 'InsufficientCreditsError'],
      [429, 'RateLimitError'],
      [503, 'ServiceUnavailableError'],
    ] as const) {
      const err = from(status, undefined, {});
      expect(err).toBeInstanceOf(build.index[name] as ErrorClass);
      expect(err.name).toBe(name);
    }
  });
});

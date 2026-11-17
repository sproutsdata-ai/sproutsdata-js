/**
 * The cross-language tool fixtures (`spec/tools/fixtures/`). Each case's canned answer is held
 * to the OpenAPI first (`respond`), its request to the one expected, and its result's canonical
 * JSON to the expected text, byte for byte. The Python SDK runs the same files.
 */

import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { toJson, type ToolsetOptions } from '../../src/tools/index.js';
import { respond } from '../support/answers.js';
import type { Scripted } from '../support/fakes.js';
import { toolset } from './support.js';

const DIR = new URL('../../../../spec/tools/fixtures/', import.meta.url).pathname;
const OPERATIONS: Readonly<Record<string, string>> = { '/v1/search': 'search', '/v1/similar': 'similar' };

interface Case {
  readonly tool: string;
  /** The Python SDK's option names (`max_results`, `baseline_filters`). */
  readonly options: Readonly<Record<string, unknown>>;
  readonly arguments: unknown;
  readonly response: { readonly status: number; readonly headers?: Record<string, string>; readonly body: unknown } | null;
  readonly expected_request: { readonly method: string; readonly path: string; readonly body: unknown } | null;
  readonly expected_output: unknown;
}

/** A fixture's options under the JS SDK's names. */
const options = (given: Readonly<Record<string, unknown>>): ToolsetOptions =>
  Object.fromEntries(Object.entries(given).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value]));

const operation = (path: string): string => OPERATIONS[path] ?? `entities_${(path.split('/').at(-1) ?? '').replaceAll('-', '_')}`;

function script(fixture: Case): Scripted[] {
  const { response, expected_request: request } = fixture;
  if (response === null || request === null) return [{ status: 500 }];
  return [respond(operation(request.path), response.status, response.body, response.headers ?? {})];
}

const cases = readdirSync(DIR)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => [name.replace(/\.json$/, ''), JSON.parse(readFileSync(DIR + name, 'utf8')) as Case] as const);

describe('spec/tools/fixtures', () => {
  it.each(cases)('%s answers exactly as expected', async (_name, fixture) => {
    const { tools, sent } = toolset(script(fixture), options(fixture.options));

    const result = await tools.run(fixture.tool, fixture.arguments as Record<string, unknown>);

    const request = fixture.expected_request;
    if (request === null) {
      expect(sent).toHaveLength(0);
    } else {
      expect(sent[0]?.method).toBe(request.method);
      expect(sent[0]?.url.pathname.replace(/^\/backend/, '')).toBe(request.path);
      expect(sent[0]?.body).toEqual(request.body);
    }
    expect(toJson(result)).toBe(toJson(fixture.expected_output));
  });
});

/**
 * Every JS name `spec/surface-map.json` gives a built group resolves on the client. `BUILT`
 * lists the groups built so far; from Phase 7 the whole map is checked, both ways.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SproutsData } from '../src/client.js';
import { BASE_URL, TEST_KEY } from './support/fakes.js';

interface Group {
  readonly group: string;
  readonly js: readonly string[];
}

const SURFACE = JSON.parse(readFileSync(new URL('../../../spec/surface-map.json', import.meta.url), 'utf8')) as { readonly groups: readonly Group[] };
const BUILT = new Set(['search', 'similar', 'filter_values', 'document_filter_values', 'sorts', 'coverage', 'entities', 'runs']);
const NAMES = SURFACE.groups.filter((g) => BUILT.has(g.group)).flatMap((g) => g.js);

function resolve(target: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], target);
}

describe('the surface map', () => {
  const client = new SproutsData({ apiKey: TEST_KEY, baseUrl: BASE_URL });

  it.each(NAMES)('%s is on the client', (path) => {
    expect(typeof resolve(client, path)).toBe('function');
  });

  it('names every built group', () => {
    expect([...BUILT].every((name) => SURFACE.groups.some((g) => g.group === name))).toBe(true);
  });
});

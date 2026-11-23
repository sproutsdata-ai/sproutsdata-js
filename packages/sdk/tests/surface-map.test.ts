/** The public surface, both ways: every JS name in `spec/surface-map.json` resolves on the client, and every `absent` one does not. */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SproutsData } from '../src/client.js';
import { BASE_URL, FIXTURE_KEY } from './support/fakes.js';

interface Group {
  readonly group: string;
  readonly js: readonly string[];
}

const SURFACE = JSON.parse(readFileSync(new URL('../../../spec/surface-map.json', import.meta.url), 'utf8')) as {
  readonly groups: readonly Group[];
  readonly absent: { readonly js: readonly string[] };
};
const NAMES = SURFACE.groups.flatMap((g) => g.js);

function resolve(target: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((at, part) => (at === undefined || at === null ? undefined : (at as Record<string, unknown>)[part]), target);
}

describe('the surface map', () => {
  const client = new SproutsData({ apiKey: FIXTURE_KEY, baseUrl: BASE_URL });

  it.each(NAMES)('Z4: %s is on the client', (path) => {
    expect(typeof resolve(client, path)).toBe('function');
  });

  it.each(SURFACE.absent.js)('Z1: %s is absent', (path) => {
    expect(resolve(client, path)).toBeUndefined();
  });

  it('Z4: every public method of every resource is in the map', () => {
    const mapped = new Set(NAMES);
    const names = (target: object): string[] => Object.getOwnPropertyNames(Object.getPrototypeOf(target)).filter((n) => n !== 'constructor' && !n.startsWith('iter'));
    for (const resource of ['entities', 'runs', 'relationships', 'orgChart', 'enrichment', 'lists', 'exports', 'history', 'feedback', 'credits']) {
      const target = resolve(client, resource) as object;
      for (const method of names(target)) expect(mapped.has(`${resource}.${method}`) || resource === 'feedback').toBe(true);
    }
    for (const method of names((resolve(client, 'feedback.votes') as object))) expect(mapped.has(`feedback.votes.${method}`)).toBe(true);
  });
});

/** The client's wiring: settings, lazy resources, and the top-level methods. */

import { describe, expect, it } from 'vitest';

import { SproutsData } from '../src/client.js';
import { ClientValidationError } from '../src/core/errors.js';
import { recorded } from './support/answers.js';
import { BASE_URL, recordingFetch, TEST_KEY } from './support/fakes.js';
import { collect } from './support/rig.js';

function client(script: Parameters<typeof recordingFetch>[0]): { client: SproutsData; sent: ReturnType<typeof recordingFetch>['sent'] } {
  const { fetch, sent } = recordingFetch(script);
  return { client: new SproutsData({ apiKey: TEST_KEY, baseUrl: BASE_URL, fetch, maxRetries: 0 }), sent };
}

describe('SproutsData', () => {
  it('needs a key', () => {
    expect(() => new SproutsData({ baseUrl: BASE_URL })).toThrow(ClientValidationError);
  });

  it('builds each resource once, on first use, and never shows its key', () => {
    const { client: c } = client([]);
    expect(c.runs).toBe(c.runs);
    expect(c.entities).toBe(c.entities);
    expect(JSON.stringify(c)).not.toContain(TEST_KEY);
  });

  it('answers every top-level method through its resource', async () => {
    const { client: c, sent } = client([
      recorded('search', 'company'),
      recorded('search', 'company'),
      recorded('similar', 'company'),
      recorded('similar', 'company'),
      recorded('filter_values', 'industry'),
      recorded('filter_values', 'industry'),
      recorded('document_filter_values', 'patent_offices'),
      recorded('document_filter_values', 'patent_offices'),
      recorded('sorts', 'company'),
      recorded('coverage', 'all'),
    ]);
    await c.search({ query: 'x' });
    await collect(c.iterSearch({ query: 'x', maxResults: 1 }));
    await c.similar({ anchors: ['a.de'] });
    await collect(c.iterSimilar({ anchors: ['a.de'], maxResults: 1 }));
    await c.filterValues('industry');
    await collect(c.iterFilterValues('industry', { maxResults: 1 }));
    await c.documentFilterValues('patent', 'offices');
    await collect(c.iterDocumentFilterValues('patent', 'offices', { maxResults: 1 }));
    await c.sorts('company');
    await c.coverage();
    expect(sent.map((s) => s.url.pathname.replace('/backend', ''))).toEqual([
      '/v1/search',
      '/v1/search',
      '/v1/similar',
      '/v1/similar',
      '/v1/search/filters/industry',
      '/v1/search/filters/industry',
      '/v1/search/filters/patent/offices',
      '/v1/search/filters/patent/offices',
      '/v1/sorts/company',
      '/v1/coverage',
    ]);
  });
});

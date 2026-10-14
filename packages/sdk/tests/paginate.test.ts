import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientValidationError, SproutsData, type AskEnvelope, type SearchHit } from '../src/index';
import { TEST_KEY, envelope, fetchQueue, jsonResponse } from './helpers';

function makeClient(fetchImpl: typeof globalThis.fetch) {
  return new SproutsData({ apiKey: TEST_KEY, baseUrl: 'https://dsp.example.test', fetch: fetchImpl, maxRetries: 0 });
}

function rows(count: number, from = 0): SearchHit[] {
  return Array.from({ length: count }, (_, i) => ({ id: `c_${from + i}`, category: 'company', score: 1 }));
}

/** A search that always has another page: `perPage` rows each, cursors `cur_<n>`. */
function endlessSearch(perPage: number) {
  let page = 0;
  return vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
    page += 1;
    return jsonResponse(
      envelope({ results: rows(perPage, (page - 1) * perPage), has_more: true, next_cursor: `cur_${page}` }),
    );
  });
}

function sentBodies(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
}

function sentHeaders(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, string>> {
  return fetchMock.mock.calls.map((call) => (call[1] as RequestInit).headers as Record<string, string>);
}

let warnings: Array<{ message: string; code: string | undefined }>;

beforeEach(() => {
  warnings = [];
  vi.spyOn(process, 'emitWarning').mockImplementation((warning, options) => {
    const code = typeof options === 'object' && options !== null ? (options as { code?: string }).code : undefined;
    warnings.push({ message: String(warning), code });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the *Pages iterators', () => {
  it('re-send a copy taken before the first request, however the caller edits theirs', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(envelope({ has_more: true, next_cursor: 'cur_2' })),
      jsonResponse(envelope()),
    );
    const client = makeClient(fetchMock);
    const params = { query: 'fintech', category: 'company' as const, filters: { industry: { include: ['A'] } } };
    const pages = client.searchPages(params);
    await pages.next();
    params.query = 'something else';
    params.filters.industry.include.push('B');
    await pages.next();
    const [first, second] = sentBodies(fetchMock);
    expect(second).toEqual({ ...first, cursor: 'cur_2' });
    expect(second!.filters).toEqual({ industry: { include: ['A'] } });
  });

  it('change only cursor and — from page two — options.limit', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(envelope({ has_more: true, next_cursor: 'cur_2' })),
      jsonResponse(envelope({ has_more: true, next_cursor: 'cur_3' })),
      jsonResponse(envelope()),
    );
    const client = makeClient(fetchMock);
    for await (const _ of client.searchPages({ query: 'x', limit: 5 }, { limit: 50 })) {
      // drain
    }
    expect(sentBodies(fetchMock).map((body) => body.limit)).toEqual([5, 50, 50]);
  });

  it("send the caller's request id with the first page only, and every other option with all", async () => {
    const fetchMock = fetchQueue(
      jsonResponse(envelope({ has_more: true, next_cursor: 'cur_2' })),
      jsonResponse(envelope({ has_more: true, next_cursor: 'cur_3' })),
      jsonResponse(envelope()),
    );
    const client = makeClient(fetchMock);
    const options = { requestId: 'export-7', headers: { 'X-Team': 'growth' } };
    for await (const _ of client.searchPages({ query: 'x' }, options)) {
      // drain
    }
    expect(sentHeaders(fetchMock).map((headers) => headers['X-Request-Id'])).toEqual(['export-7', undefined, undefined]);
    expect(sentHeaders(fetchMock).map((headers) => headers['X-Team'])).toEqual(['growth', 'growth', 'growth']);
    expect(options).toEqual({ requestId: 'export-7', headers: { 'X-Team': 'growth' } });
  });

  it('treat a raw X-Request-Id header, in any casing, as the request id', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(envelope({ has_more: true, next_cursor: 'cur_2' })),
      jsonResponse(envelope()),
    );
    const client = makeClient(fetchMock);
    for await (const _ of client.history.listPages({}, { headers: { 'x-request-id': 'audit-1', 'X-Team': 'ops' } })) {
      // drain
    }
    const ids = sentHeaders(fetchMock).map((headers) => headers['x-request-id']);
    expect(ids).toEqual(['audit-1', undefined]);
    expect(sentHeaders(fetchMock)[1]!['X-Team']).toBe('ops');
  });

  it('send the request id with the first page of iterFilterValues only', async () => {
    const fetchMock = fetchQueue(
      jsonResponse({ name: 'industry', values: ['a'], page: 1, has_more: true, meta: envelope().meta }),
      jsonResponse({ name: 'industry', values: ['b'], page: 2, has_more: false, meta: envelope().meta }),
    );
    const client = makeClient(fetchMock);
    const values: string[] = [];
    for await (const value of client.iterFilterValues('industry', {}, { requestId: 'picker-1' })) values.push(value);
    expect(values).toEqual(['a', 'b']);
    expect(sentHeaders(fetchMock).map((headers) => headers['X-Request-Id'])).toEqual(['picker-1', undefined]);
  });

  it('stop at maxResults without fetching a page nobody reads, cutting the last page to fit', async () => {
    const fetchMock = endlessSearch(4);
    const client = makeClient(fetchMock);
    const seen: SearchHit[] = [];
    for await (const page of client.searchPages({ query: 'x' }, { maxResults: 10 })) seen.push(...page.results);
    expect(seen.map((hit) => hit.id)).toEqual(rows(10).map((hit) => hit.id));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never ask for more rows than maxResults still wants (search bills per result)', async () => {
    const fetchMock = endlessSearch(10);
    const client = makeClient(fetchMock);
    let count = 0;
    for await (const page of client.searchPages({ query: 'x', limit: 10 }, { maxResults: 15 })) {
      count += page.results.length;
    }
    expect(count).toBe(15);
    expect(sentBodies(fetchMock).map((body) => body.limit)).toEqual([10, 5]);
  });

  it('state every page size under maxResults, without leaning on the server default', async () => {
    const fetchMock = endlessSearch(10);
    const client = makeClient(fetchMock);
    let count = 0;
    for await (const page of client.searchPages({ query: 'x' }, { maxResults: 15 })) {
      count += page.results.length;
    }
    expect(count).toBe(15);
    expect(sentBodies(fetchMock).map((body) => body.limit)).toEqual([10, 5]);
  });

  it('shrink the first page when maxResults is below the page size', async () => {
    const fetchMock = endlessSearch(3);
    const client = makeClient(fetchMock);
    for await (const _page of client.searchPages({ query: 'x' }, { maxResults: 3 })) {
      // drain
    }
    expect(sentBodies(fetchMock).map((body) => body.limit)).toEqual([3]);
  });

  it('leave the page size to the server when there is no maxResults', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    for await (const _page of client.searchPages({ query: 'x' })) {
      // drain
    }
    expect(sentBodies(fetchMock)[0]).not.toHaveProperty('limit');
  });

  it('stop exactly at a page boundary when maxResults lands on one', async () => {
    const fetchMock = endlessSearch(5);
    const client = makeClient(fetchMock);
    let count = 0;
    for await (const page of client.searchPages({ query: 'x' }, { maxResults: 10 })) count += page.results.length;
    expect(count).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuse a maxResults that is not a positive integer', async () => {
    const client = makeClient(fetchQueue());
    await expect(client.searchPages({ query: 'x' }, { maxResults: 0 }).next()).rejects.toThrow(
      ClientValidationError,
    );
  });

  it('stop at the 10,000-row depth cap with one warning, instead of asking for a refused page', async () => {
    const fetchMock = endlessSearch(100);
    const client = makeClient(fetchMock);
    let count = 0;
    for await (const page of client.searchPages({ query: 'x', limit: 100 })) count += page.results.length;
    expect(count).toBe(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(100);
    const cap = warnings.filter((w) => w.code === 'SPROUTSDATA_DEPTH_CAP');
    expect(cap).toHaveLength(1);
    expect(cap[0]!.message).toMatch(/10,000/);
  });

  it('flag a truncated page and warn once per process', async () => {
    const truncated = envelope({
      degradation: [
        { reason: 'pagination_truncated', detail: 'More exist.', impact: 'recall', source_corpus: 'gtm_index' },
      ],
    });
    const fetchMock = fetchQueue(jsonResponse(truncated), jsonResponse(truncated));
    const client = makeClient(fetchMock);
    for (let i = 0; i < 2; i++) {
      for await (const page of client.searchPages({ query: 'x' })) expect(page.truncated).toBe(true);
    }
    // One warning per process, not per page or per iteration.
    expect(warnings.filter((w) => w.code === 'SPROUTSDATA_TRUNCATED')).toHaveLength(1);
  });

  it('page ask answers by the populated slot, cutting that slot to maxResults', async () => {
    const answer = (cursor: string | null): AskEnvelope => ({
      route: 'relationships',
      reading: { span: 'who', searches: 1, warnings: [] },
      relationships: {
        ...envelope({ has_more: cursor !== null, next_cursor: cursor }),
        results: rows(3) as never,
        institutions: [],
        connection_basis: 'overlapping',
      },
      reach: null,
      institutions: null,
      compare: null,
      fan_out: null,
    });
    const fetchMock = fetchQueue(jsonResponse(answer('cur_2')), jsonResponse(answer(null)));
    const client = makeClient(fetchMock);
    const counts: number[] = [];
    for await (const page of client.relationships.askPages({ query: 'who' }, { maxResults: 5 })) {
      counts.push(page.relationships!.results.length);
      expect(page.relationships!.truncated).toBe(false);
    }
    expect(counts).toEqual([3, 2]);
    expect(sentBodies(fetchMock)[1]!.cursor).toBe('cur_2');
  });
});

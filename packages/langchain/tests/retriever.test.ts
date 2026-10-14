/**
 * `SproutsDataRetriever` over the core client: the request it sends, the
 * documents it returns, and the metadata every document carries.
 */

import { inspect } from 'node:util';

import { Document } from '@langchain/core/documents';
import type { BaseRetrieverInterface } from '@langchain/core/retrievers';
import { AuthenticationError } from 'sproutsdata';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { SproutsDataRetriever, VERSION, type SproutsDataRetrieverFields } from '../src/index';
import {
  BASE_URL,
  TEST_KEY,
  client,
  envelope,
  fetchQueue,
  jsonResponse,
  problemResponse,
  sentBody,
  sentHeaders,
} from './helpers';

function makeRetriever(fields: SproutsDataRetrieverFields = {}, responses = [jsonResponse(envelope())]) {
  const fetchMock = fetchQueue(...responses);
  const retriever = new SproutsDataRetriever({ client: client(fetchMock), ...fields });
  return { retriever, fetchMock };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('a LangChain retriever', () => {
  it('satisfies BaseRetrieverInterface and resolves to Document instances', async () => {
    const { retriever } = makeRetriever();
    expectTypeOf(retriever).toMatchTypeOf<BaseRetrieverInterface>();
    const docs = await retriever.invoke('anything');
    expect(docs).toHaveLength(1);
    expect(docs[0]).toBeInstanceOf(Document);
  });
});

describe('request building', () => {
  it('sends the defaults: category company, mode fast, limit 10', async () => {
    const { retriever, fetchMock } = makeRetriever();
    await retriever.invoke('fintech in Berlin');
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${BASE_URL}/v1/search`);
    expect(sentBody(fetchMock)).toEqual({ query: 'fintech in Berlin', category: 'company', mode: 'fast', limit: 10 });
  });

  it('passes k, category, filters and domain lists through as given', async () => {
    const { retriever, fetchMock } = makeRetriever({
      k: 3,
      category: 'person',
      filters: { seniority: { include: ['VP'] } },
      includeDomains: ['acme.com'],
      excludeDomains: ['spam.example'],
    });
    await retriever.invoke('marketing leaders');
    expect(sentBody(fetchMock)).toEqual({
      query: 'marketing leaders',
      category: 'person',
      mode: 'fast',
      limit: 3,
      filters: { seniority: { include: ['VP'] } },
      include_domains: ['acme.com'],
      exclude_domains: ['spam.example'],
    });
  });

  it('sends no empty domain list', async () => {
    const { retriever, fetchMock } = makeRetriever({ includeDomains: [], excludeDomains: [] });
    await retriever.invoke('x');
    expect(sentBody(fetchMock)).not.toHaveProperty('include_domains');
    expect(sentBody(fetchMock)).not.toHaveProperty('exclude_domains');
  });

  it('names this package in X-SproutsData-Client, without changing the caller’s client', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const mine = client(fetchMock);
    await new SproutsDataRetriever({ client: mine }).invoke('x');
    expect(sentHeaders(fetchMock)['X-SproutsData-Client']).toBe(`langchain/${VERSION}`);
    expect(mine.integration).toBeUndefined();
  });

  it('throws the SDK’s errors unchanged', async () => {
    const { retriever } = makeRetriever({}, [problemResponse(401, { code: 'auth.invalid_key' })]);
    await expect(retriever.invoke('x')).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe('the key', () => {
  it('is never a field: JSON, toJSON() and inspect do not show it', () => {
    const retriever = new SproutsDataRetriever({ apiKey: TEST_KEY, baseUrl: BASE_URL, k: 5 });
    expect(JSON.stringify(retriever)).not.toContain(TEST_KEY);
    expect(JSON.stringify(retriever.toJSON())).not.toContain(TEST_KEY);
    expect(inspect(retriever, { depth: 10, showHidden: true })).not.toContain(TEST_KEY);
    expect(retriever.k).toBe(5);
  });

  it('missing, throws where the retriever is built', () => {
    vi.stubEnv('SPROUTSDATA_API_KEY', '');
    vi.stubEnv('DSP_API_KEY', '');
    expect(() => new SproutsDataRetriever()).toThrow(/Missing API key/);
  });

  it('is refused in a browser-like environment', () => {
    vi.stubGlobal('window', { document: {} });
    expect(() => new SproutsDataRetriever({ apiKey: TEST_KEY })).toThrow(/auth\.browser_origin/);
  });
});

describe('page content', () => {
  it('renders the company one-liner', async () => {
    const { retriever } = makeRetriever({}, [
      jsonResponse(
        envelope({
          results: [
            {
              id: 'acme.com',
              category: 'company',
              score: 0.9,
              account_name: 'Acme',
              industry: 'Software & Technology',
              employee_count: 120,
              location: 'Austin, TX, United States',
              domain: 'acme.com',
            },
          ],
        }),
      ),
    ]);
    const [doc] = await retriever.invoke('dev tools');
    expect(doc?.pageContent).toBe(
      'Acme — Software & Technology, 120 employees, Austin, TX, United States. acme.com',
    );
  });

  it('renders the person one-liner and skips missing segments', async () => {
    const { retriever } = makeRetriever({}, [
      jsonResponse(
        envelope({
          results: [
            {
              id: 'p_1',
              category: 'person',
              score: 0.8,
              contact_name: 'Jane Doe',
              title: 'VP of Marketing',
              account_name: 'Acme',
              linkedin_url: 'https://linkedin.com/in/janedoe',
            },
            { id: 'p_2', category: 'person', score: 0.7, contact_name: 'Sam Roe' },
          ],
        }),
      ),
    ]);
    const docs = await retriever.invoke('marketing vps');
    expect(docs[0]?.pageContent).toBe(
      'Jane Doe — VP of Marketing at Acme. https://linkedin.com/in/janedoe',
    );
    expect(docs[1]?.pageContent).toBe('Sam Roe.');
  });

  it('contentFields renders field: value lines in the given order', async () => {
    const { retriever } = makeRetriever({ contentFields: ['domain', 'technology', 'missing'] }, [
      jsonResponse(
        envelope({
          results: [
            {
              id: 'acme.com',
              category: 'company',
              score: 0.9,
              domain: 'acme.com',
              technology: ['HubSpot', 'AWS'],
            },
          ],
        }),
      ),
    ]);
    const [doc] = await retriever.invoke('anything');
    expect(doc?.pageContent).toBe('domain: acme.com\ntechnology: HubSpot, AWS');
  });

  it('falls back to raw JSON rather than an empty page_content', async () => {
    const hit = { id: 'x_1', category: 'trend' as const, score: null };
    const { retriever } = makeRetriever({ category: 'trend' }, [
      jsonResponse(envelope({ results: [hit] })),
    ]);
    const [doc] = await retriever.invoke('anything');
    expect(doc?.pageContent).toBe(JSON.stringify(hit));
  });
});

describe('metadata', () => {
  const RICH_HIT = {
    id: 'acme.com',
    category: 'company' as const,
    score: 0.9,
    account_name: 'Acme',
    domain: 'acme.com',
    some_future_field: { nested: true },
  };

  it('metadata.record is the complete raw hit, unknown fields included', async () => {
    const { retriever } = makeRetriever({}, [jsonResponse(envelope({ results: [RICH_HIT] }))]);
    const [doc] = await retriever.invoke('x');
    expect(doc?.metadata.record).toEqual(RICH_HIT);
  });

  it('copies every request-level field onto each document', async () => {
    const resolved = {
      parser_version: 'prism-search-v2',
      mode: 'fast' as const,
      category: 'company' as const,
      query: 'x',
      filters: {},
      filters_source: 'caller' as const,
      semantic_query: null,
      sort: [],
      conflicts: [],
      overrides: [],
    };
    const degradation = [
      {
        reason: 'vector_coverage_incomplete',
        detail: 'company corpus partly embedded',
        impact: 'recall' as const,
        source_corpus: 'company',
      },
    ];
    const { retriever } = makeRetriever({}, [
      jsonResponse(
        envelope({
          results: [RICH_HIT, { ...RICH_HIT, id: 'other.com' }],
          total: 1200,
          total_is_estimate: true,
          resolved_search: resolved,
          degradation,
        }),
      ),
    ]);
    const docs = await retriever.invoke('x');
    expect(docs).toHaveLength(2);
    for (const doc of docs) {
      expect(doc.metadata).toMatchObject({
        category: 'company',
        score: 0.9,
        source: 'acme.com',
        request_id: 'req_test',
        environment: 'test',
        as_of: '2026-08-13T00:00:00Z',
        credential: 'api_key',
        total: 1200,
        total_is_estimate: true,
        resolved_search: resolved,
        degradation,
        attribution: [],
      });
    }
  });

  it('takes the request id from X-Request-Id when the body has no meta', async () => {
    const { meta: _meta, ...withoutMeta } = envelope();
    const { retriever } = makeRetriever({}, [jsonResponse(withoutMeta, 200, { 'x-request-id': 'req_header' })]);
    const [doc] = await retriever.invoke('x');
    expect(doc?.metadata).toMatchObject({ request_id: 'req_header', environment: '', as_of: '', credential: '' });
  });

  it('includeResolvedSearch: false drops only resolved_search', async () => {
    const { retriever } = makeRetriever({ includeResolvedSearch: false });
    const [doc] = await retriever.invoke('x');
    expect(doc && 'resolved_search' in doc.metadata).toBe(false);
    expect(doc?.metadata.request_id).toBe('req_test');
  });

  it('non-empty degradation never raises — documents still come back', async () => {
    const { retriever } = makeRetriever({}, [
      jsonResponse(
        envelope({
          degradation: [
            {
              reason: 'corpus_timeout',
              detail: 'person corpus timed out',
              impact: 'recall',
              source_corpus: 'person',
            },
          ],
        }),
      ),
    ]);
    const docs = await retriever.invoke('x');
    expect(docs).toHaveLength(1);
    expect(docs[0]?.metadata.degradation).toHaveLength(1);
  });
});

describe('zero results', () => {
  it('returns [] — not an error, not a "no results" document', async () => {
    const { retriever } = makeRetriever({}, [
      jsonResponse(envelope({ results: [], total: 0 })),
    ]);
    await expect(retriever.invoke('nothing matches this')).resolves.toEqual([]);
  });

  it('warns once when parser-inferred filters found nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { retriever } = makeRetriever({ mode: 'auto' }, [
      jsonResponse(
        envelope({
          results: [],
          total: 0,
          resolved_search: {
            parser_version: 'prism-search-v2',
            mode: 'auto',
            category: 'company',
            query: 'x',
            filters: { industry: { include: ['Tobacco'] } },
            filters_source: 'parser',
            semantic_query: null,
            sort: [],
            conflicts: [],
            overrides: [],
          },
        }),
      ),
    ]);
    await retriever.invoke('x');
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('Tobacco');
    expect(message).toContain('req_test');
  });

  it('does not warn on empty results the caller filtered themselves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { retriever } = makeRetriever({}, [
      jsonResponse(envelope({ results: [], total: 0 })),
    ]);
    await retriever.invoke('x');
    expect(warn).not.toHaveBeenCalled();
  });
});

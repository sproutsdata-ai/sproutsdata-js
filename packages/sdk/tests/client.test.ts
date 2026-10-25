import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientValidationError, DEFAULT_BASE_URL, SproutsData, VERSION } from '../src/index';
import { TEST_KEY, envelope, fetchQueue, jsonResponse } from './helpers';

function makeClient(fetchImpl: typeof globalThis.fetch, options: Partial<ConstructorParameters<typeof SproutsData>[0]> = {}) {
  return new SproutsData({
    apiKey: TEST_KEY,
    baseUrl: 'https://dsp.example.test/backend',
    fetch: fetchImpl,
    maxRetries: 0,
    ...options,
  });
}

describe('construction', () => {
  // Cleared before (a developer's shell may export them) and after each test.
  const ENV_NAMES = ['SPROUTSDATA_API_KEY', 'SPROUTSDATA_BASE_URL', 'DSP_API_KEY', 'DSP_BASE_URL'];
  const clearEnv = () => {
    for (const name of ENV_NAMES) delete process.env[name];
  };
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it('requires an API key', () => {
    expect(() => new SproutsData({})).toThrow(ClientValidationError);
    expect(() => new SproutsData({})).toThrow(/SPROUTSDATA_API_KEY/);
  });

  it('reads the key and base URL from SPROUTSDATA_API_KEY / SPROUTSDATA_BASE_URL', async () => {
    process.env.SPROUTSDATA_API_KEY = TEST_KEY;
    process.env.SPROUTSDATA_BASE_URL = 'https://env.example.test';
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = new SproutsData({ fetch: fetchMock });
    await client.search({ query: 'fintech' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://env.example.test/v1/search');
    expect((init!.headers as Record<string, string>)['X-API-Key']).toBe(TEST_KEY);
  });

  it('defaults to the production API', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = new SproutsData({ apiKey: TEST_KEY, fetch: fetchMock });
    await client.search({ query: 'fintech' });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${DEFAULT_BASE_URL}/v1/search`);
    expect(DEFAULT_BASE_URL).toBe('https://api.sproutsdata.ai');
  });

  it('accepts a key with another platform prefix and rejects malformed keys', () => {
    expect(() => new SproutsData({ apiKey: 'sk_acme_live_' + 'y'.repeat(22) })).not.toThrow();
    expect(() => new SproutsData({ apiKey: 'sk_dsp_prod_' + 'y'.repeat(22) })).toThrow(
      ClientValidationError,
    );
    expect(() => new SproutsData({ apiKey: 'pk_dsp_live_' + 'y'.repeat(22) })).toThrow(/sk_dsp_/);
    expect(() => new SproutsData({ apiKey: 'sk_dsp_live_' })).toThrow(ClientValidationError);
    expect(() => new SproutsData({ apiKey: TEST_KEY + '\n' })).toThrow(ClientValidationError);
  });

  it('never echoes the key in the invalid-key message', () => {
    const almostKey = 'sk_dsp_prod_' + 'z'.repeat(22);
    expect(() => new SproutsData({ apiKey: almostKey })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('zzzz') }),
    );
  });

  it('rejects a relative baseUrl', () => {
    expect(() => new SproutsData({ apiKey: TEST_KEY, baseUrl: 'dsp.example.test' })).toThrow(
      ClientValidationError,
    );
  });

  it('refuses http:// except for localhost and 127.0.0.1', () => {
    expect(() => new SproutsData({ apiKey: TEST_KEY, baseUrl: 'http://api.example.test' })).toThrow(
      /https:\/\//,
    );
    expect(() => new SproutsData({ apiKey: TEST_KEY, baseUrl: 'ftp://api.example.test' })).toThrow(
      ClientValidationError,
    );
    expect(() => new SproutsData({ apiKey: TEST_KEY, baseUrl: 'http://localhost:8000' })).not.toThrow();
    expect(() => new SproutsData({ apiKey: TEST_KEY, baseUrl: 'http://127.0.0.1:8000' })).not.toThrow();
  });

  describe('deprecated DSP_* fallbacks', () => {
    it('reads DSP_API_KEY / DSP_BASE_URL with one DeprecationWarning each, naming the new variable', async () => {
      vi.resetModules();
      const { SproutsData: FreshClient } = await import('../src/index');
      const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
      try {
        process.env.DSP_API_KEY = TEST_KEY;
        process.env.DSP_BASE_URL = 'https://legacy.example.test';
        const fetchMock = fetchQueue(jsonResponse(envelope()));
        const client = new FreshClient({ fetch: fetchMock });
        new FreshClient({ fetch: fetchMock });
        await client.search({ query: 'fintech' });
        expect(String(fetchMock.mock.calls[0]![0])).toBe('https://legacy.example.test/v1/search');
        expect(warn).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('set SPROUTSDATA_API_KEY instead'),
          'DeprecationWarning',
        );
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('set SPROUTSDATA_BASE_URL instead'),
          'DeprecationWarning',
        );
      } finally {
        warn.mockRestore();
      }
    });

    it('prefers SPROUTSDATA_* and then warns about nothing', async () => {
      vi.resetModules();
      const { SproutsData: FreshClient } = await import('../src/index');
      const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
      try {
        process.env.SPROUTSDATA_API_KEY = TEST_KEY;
        process.env.DSP_API_KEY = 'sk_dsp_live_' + 'q'.repeat(22);
        const fetchMock = fetchQueue(jsonResponse(envelope()));
        await new FreshClient({ fetch: fetchMock }).search({ query: 'fintech' });
        expect((fetchMock.mock.calls[0]![1]!.headers as Record<string, string>)['X-API-Key']).toBe(
          TEST_KEY,
        );
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('browser guard', () => {
    afterEach(() => {
      delete (globalThis as Record<string, unknown>).window;
    });

    it('refuses to construct in a browser-like environment', () => {
      (globalThis as Record<string, unknown>).window = { document: {} };
      expect(() => new SproutsData({ apiKey: TEST_KEY })).toThrow(/auth\.browser_origin/);
    });

    it('allows it with dangerouslyAllowBrowser, and then sends no User-Agent', async () => {
      (globalThis as Record<string, unknown>).window = { document: {} };
      const fetchMock = fetchQueue(jsonResponse(envelope()));
      const client = new SproutsData({
        apiKey: TEST_KEY,
        dangerouslyAllowBrowser: true,
        fetch: fetchMock,
      });
      await client.search({ query: 'fintech' });
      expect(fetchMock.mock.calls[0]![1]!.headers).not.toHaveProperty('User-Agent');
    });
  });
});

describe('search', () => {
  it('POSTs the body to /v1/search with auth headers', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock);

    const page = await client.search({
      query: 'industrial robotics',
      mode: 'auto',
      category: 'company',
      limit: 10,
    });

    expect(page.results[0]!.id).toBe('c_1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/search');
    expect(init!.method).toBe('POST');
    const headers = init!.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe(TEST_KEY);
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['User-Agent']).toBe(
      `sproutsdata-js/${VERSION} (node/${process.versions.node}; ${process.platform})`,
    );
    expect(headers['X-Dsp-Source']).toBe('sdk/js');
    expect(JSON.parse(init!.body as string)).toEqual({
      query: 'industrial robotics',
      mode: 'auto',
      category: 'company',
      limit: 10,
    });
  });

  it('rejects a call with neither query nor filters before any request', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(client.search({})).rejects.toThrow(ClientValidationError);
    await expect(client.search({ filters: {} })).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends no empty optional list or empty filters, as the Python SDK does', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()), jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    await client.search({ query: 'x', sort: [], include_domains: [], exclude_domains: [], filters: {} });
    await client.search({ query: 'x', mode: 'deep', category: 'company', sort: [], filters: {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ query: 'x', category: 'company' });
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      query: 'x',
      mode: 'deep',
      category: 'company',
    });
  });

  it('keeps one wire body across pages when the params carry an empty sort', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(envelope({ has_more: true, next_cursor: 'cur_2' })),
      jsonResponse(envelope()),
    );
    const client = makeClient(fetchMock);
    for await (const _page of client.searchPages({ query: 'x', sort: [] })) {
      // drain
    }
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1]!.body as string));
    expect(bodies).toEqual([
      { query: 'x', category: 'company' },
      { query: 'x', cursor: 'cur_2', category: 'company' },
    ]);
  });

  it('takes the request id from X-Request-Id when the body has no meta', async () => {
    const { meta: _meta, ...withoutMeta } = envelope();
    const fetchMock = fetchQueue(jsonResponse(withoutMeta, 200, { 'x-request-id': 'req_header' }));
    const page = await makeClient(fetchMock).search({ query: 'x' });
    expect(page.meta.request_id).toBe('req_header');
  });

  it('prefers X-Request-Id over the body, and keeps the body id without the header', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(envelope(), 200, { 'x-request-id': 'req_header' }),
      jsonResponse(envelope()),
    );
    const client = makeClient(fetchMock);
    expect((await client.search({ query: 'x' })).meta).toMatchObject({
      request_id: 'req_header',
      environment: 'test',
    });
    expect((await client.search({ query: 'x' })).meta.request_id).toBe('req_test');
  });

  it('leaves limit bounds to the server, which names the field (contract §11)', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    await client.search({ query: 'x', limit: 500 });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).limit).toBe(500);
  });

  it('accepts filters without a query', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    const filters = { industry: { include: ['Software & Technology'] } };
    await client.search({ category: 'company', filters });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      category: 'company',
      filters,
    });
  });

  it('types company/person filters strictly and document filters freely', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()), jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    // @ts-expect-error — `industri` is not a discover filter.
    await client.search({ category: 'company', filters: { industri: { include: ['x'] } } });
    await client.search({ category: 'patent', filters: { patent_office: ['EP'] } });
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).filters).toEqual({
      patent_office: ['EP'],
    });
  });

  it('refuses filters, sort or domains under mode: deep, which the server would ignore on a billed call', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    await expect(
      client.search({
        query: 'x',
        mode: 'deep',
        category: 'company',
        filters: { industry: { include: ['Software & Technology'] } },
      }),
    ).rejects.toThrow(/`mode: 'deep'` takes no `filters`/);
    await expect(
      client.search({ query: 'x', mode: 'deep', category: 'company', sort: [{ field: 'revenue' }] }),
    ).rejects.toThrow(/`sort`/);
    await expect(
      client.search({
        query: 'x',
        mode: 'deep',
        category: 'company',
        include_domains: ['a.com'],
        exclude_domains: ['b.com'],
      }),
    ).rejects.toThrow(/`include_domains`, `exclude_domains`/);
    expect(fetchMock).not.toHaveBeenCalled();
    await client.search({ query: 'x', mode: 'deep', category: 'company' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("`category: 'auto'` sends no category key (server auto-classifies)", async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    await client.search({ query: 'recent payments funding rounds', mode: 'auto', category: 'auto' });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect('category' in body).toBe(false);
    expect(body.mode).toBe('auto');
  });

  it("`category: 'auto'` leaves what else the request may carry to the server", async () => {
    // No local mode or filter rule for `auto`: the server's 422 names the
    // field, and a local copy of its rule would go stale (contract 02 §11).
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    await client.search({
      query: 'payments',
      category: 'auto',
      filters: { industry: { include: ['Software & Technology'] } },
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({
      query: 'payments',
      filters: { industry: { include: ['Software & Technology'] } },
    });
  });

  it("omitting category sends `category: 'company'`, as the Python SDK does", async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()), jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    await client.search({ query: 'recent payments funding rounds', mode: 'auto' });
    await client.search({ filters: { industry: { include: ['Software & Technology'] } } });
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(call[1]!.body as string).category).toBe('company');
    }
  });

  it('searchPages sends the default category on every page', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(envelope({ has_more: true, next_cursor: 'cur_2' })),
      jsonResponse(envelope()),
    );
    const client = makeClient(fetchMock);
    for await (const _ of client.searchPages({ query: 'fintech' })) {
      // drain
    }
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1]!.body as string));
    expect(bodies.map((body) => body.category)).toEqual(['company', 'company']);
  });

  it('serializes typed DiscoverFilters verbatim', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    const filters = {
      industry: { include: ['Software & Technology'] },
      employee_count: { gte: 500, lte: 5000 },
      geo: { places: [{ value: 'Berlin', level: 'city' as const }] },
      keywords: { include: ['robotics'], target_fields: ['description' as const] },
      governance_level: { include: ['Founder', 'Co Founder'] },
      employment_history: {
        groups: [
          {
            company: { include: [{ value: 'Stripe', by: 'name' as const }] },
            role_ended: { preset: 'last_3_years' as const },
            tenure_gte: 2,
          },
        ],
      },
    };
    await client.search({ category: 'company', filters });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      category: 'company',
      filters,
    });
  });

  it('forwards sort verbatim and reads suggestion and columns off the envelope', async () => {
    const suggestion = {
      kind: 'search' as const,
      category: 'person' as const,
      message: 'This reads like a people question — try category: person.',
    };
    const columns = [{ name: 'ml_team_evidence', description: 'Evidence', source: 'agent' }];
    const fetchMock = fetchQueue(jsonResponse(envelope({ suggestion, columns })));
    const client = makeClient(fetchMock);
    const page = await client.search({
      query: 'fintech',
      category: 'company',
      sort: [{ field: 'revenue' }, { field: 'account_name', direction: 'asc' }],
    });
    expect(page.suggestion?.category).toBe('person');
    expect(page.columns?.[0]?.name).toBe('ml_team_evidence');
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).sort).toEqual([
      { field: 'revenue' },
      { field: 'account_name', direction: 'asc' },
    ]);
  });

  it('refuses a sort that is not a list of named clauses before any request', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(
      client.search({ query: 'x', category: 'company', sort: { field: 'revenue' } as unknown as [] }),
    ).rejects.toThrow(/must be an array/);
    await expect(
      client.search({ query: 'x', category: 'company', sort: [{ field: '' }] }),
    ).rejects.toThrow(/`sort\[0\].field` must be a non-empty string/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves sort counts, directions and the category rule to the server', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    const sort = [
      { field: 'a' },
      { field: 'b' },
      { field: 'c' },
      { field: 'd', direction: 'up' as unknown as 'asc' },
    ];
    await client.search({ query: 'x', sort });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).sort).toEqual(sort);
  });

  it('leaves sort vocabulary to the server (document sort names pass through)', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    await client.search({ query: 'x', category: 'patent', sort: [{ field: 'granted_date' }] });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).sort).toEqual([
      { field: 'granted_date' },
    ]);
  });

  it('reads the coverage block off the envelope', async () => {
    const coverage = {
      universe: 1_204,
      universe_is_exact: true,
      enumerated: 1_204,
      enumeration_recall: 1,
      universe_exhausted: true,
      truncated_by: null,
      constraints_unmet: [],
      audited: true,
      criteria: [],
      similarity: [],
      linkage: [],
      linkage_coverage: null,
      linkage_coverage_is_lower_bound: false,
    };
    const fetchMock = fetchQueue(jsonResponse(envelope({ coverage })));
    const client = makeClient(fetchMock);
    const page = await client.search({ query: 'x', mode: 'deep' });
    expect(page.coverage!.universe_exhausted).toBe(true);
    expect(page.coverage!.constraints_unmet).toEqual([]);
  });
});

describe('similar', () => {
  it('POSTs anchors to /v1/similar', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    await client.similar({
      anchors: [{ value: 'acme.com' }, { value: 'Globex', by: 'name', weight: 0.5 }],
      combine: 'or',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/similar');
    expect(JSON.parse(init!.body as string)).toEqual({
      anchors: [{ value: 'acme.com' }, { value: 'Globex', by: 'name', weight: 0.5 }],
      combine: 'or',
    });
  });

  it('forwards typed filters', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    await client.similar({
      anchors: [{ value: 'acme.com' }],
      filters: { geo: { places: [{ value: 'Germany', level: 'country' }] } },
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).filters).toEqual({
      geo: { places: [{ value: 'Germany', level: 'country' }] },
    });
  });

  it('sends no empty filters', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    await makeClient(fetchMock).similar({ anchors: [{ value: 'acme.com' }], filters: {} });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      anchors: [{ value: 'acme.com' }],
    });
  });

  it('validates anchors structurally, leaving counts and weights to the server', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    await expect(client.similar({ anchors: [] })).rejects.toThrow(/at least one anchor/);
    await expect(client.similar({ anchors: [{ value: '' }] })).rejects.toThrow(
      ClientValidationError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    const anchors = Array.from({ length: 11 }, () => ({ value: 'a.com', weight: 1.5 }));
    await client.similar({ anchors });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).anchors).toEqual(anchors);
  });
});

describe('entities', () => {
  function entitiesBody(results: unknown[]) {
    return { ...envelope(), results, total: results.length };
  }

  it('POSTs ids to /v1/entities/companies and returns misses as found: false', async () => {
    const hits = [
      { id: '000006dddc0f7a39', category: 'company', found: true, matches: [{ account_name: 'Acme' }] },
      { id: 'definitely_not_real', category: 'company', found: false, matches: [] },
    ];
    const fetchMock = fetchQueue(jsonResponse(entitiesBody(hits)));
    const client = makeClient(fetchMock);

    const page = await client.entities.companies({
      ids: ['000006dddc0f7a39', 'definitely_not_real'],
      fields: ['account_name'],
    });

    expect(page.results).toHaveLength(2);
    expect(page.results[0]!.matches[0]!.account_name).toBe('Acme');
    expect(page.results[1]!.found).toBe(false);
    expect(page.results[1]!.matches).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/entities/companies');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({
      ids: ['000006dddc0f7a39', 'definitely_not_real'],
      fields: ['account_name'],
    });
  });

  it('sends `by` for raw-identifier resolution', async () => {
    const fetchMock = fetchQueue(jsonResponse(entitiesBody([])));
    const client = makeClient(fetchMock);
    await client.entities.companies({ ids: ['adyen.com'], by: 'domain' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      ids: ['adyen.com'],
      by: 'domain',
    });
  });

  it('routes each document category to its hyphenated path', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(entitiesBody([])),
      jsonResponse(entitiesBody([])),
      jsonResponse(entitiesBody([])),
    );
    const client = makeClient(fetchMock);
    await client.entities.marketReports({ ids: ['m_1'] });
    await client.entities.academicReports({ ids: ['a_1'] });
    await client.entities.jobOpenings({ ids: ['j_1'] });
    const paths = fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);
    expect(paths).toEqual([
      '/backend/v1/entities/market-reports',
      '/backend/v1/entities/academic-reports',
      '/backend/v1/entities/job-openings',
    ]);
  });

  it('validates ids structurally before any request', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(client.entities.companies({ ids: [] })).rejects.toThrow(ClientValidationError);
    await expect(client.entities.companies({ ids: [''] })).rejects.toThrow(ClientValidationError);
    await expect(client.entities.patents({ ids: 'p_1' as unknown as string[] })).rejects.toThrow(
      ClientValidationError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves batch sizes and `by` vocabularies to the server (contract §11)', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(entitiesBody([])),
      jsonResponse(entitiesBody([])),
      jsonResponse(entitiesBody([])),
    );
    const client = makeClient(fetchMock);
    await client.entities.companies({
      ids: Array.from({ length: 51 }, (_, i) => `d${i}.com`),
      by: 'domain',
    });
    await client.entities.patents({ ids: Array.from({ length: 101 }, (_, i) => `p_${i}`) });
    await client.entities.news({ ids: ['n_1'], by: 'title' as unknown as 'id' });
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1]!.body as string));
    expect(bodies[0].ids).toHaveLength(51);
    expect(bodies[1].ids).toHaveLength(101);
    expect(bodies[2].by).toBe('title');
  });

  it('always sends by: "id" on named-document lookups by default', async () => {
    const fetchMock = fetchQueue(jsonResponse(entitiesBody([])), jsonResponse(entitiesBody([])));
    const client = makeClient(fetchMock);
    await client.entities.news({ ids: ['n_1'] });
    await client.entities.fundings({ ids: ['f_1'], fields: ['round_type'] });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      ids: ['n_1'],
      by: 'id',
    });
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      ids: ['f_1'],
      fields: ['round_type'],
      by: 'id',
    });
  });

  it('forwards by: "name" and surfaces multiple matches per input', async () => {
    const hits = [
      {
        id: 'stripe',
        category: 'funding_round',
        found: true,
        matches: [{ round_type: 'Series A' }, { round_type: 'Series B' }],
      },
    ];
    const fetchMock = fetchQueue(jsonResponse(entitiesBody(hits)));
    const client = makeClient(fetchMock);
    const page = await client.entities.fundings({ ids: ['stripe'], by: 'name' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      ids: ['stripe'],
      by: 'name',
    });
    expect(page.results[0]!.matches).toHaveLength(2);
  });

  it('sends no `by` on plain document lookups', async () => {
    const fetchMock = fetchQueue(jsonResponse(entitiesBody([])));
    const client = makeClient(fetchMock);
    await client.entities.patents({ ids: ['p_1'] });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ ids: ['p_1'] });
  });

  it('reads the derived trend groups off a trend record', async () => {
    const trend = {
      trend: 'Quantum Sensing',
      description: { short: 's', long: 'l' },
      topic_type: 'technology',
      summary: null,
      created_at: '2026-01-01',
      connections: [],
      startups: [],
      highlights: [],
      signals: {
        signal_strength: 'strong',
        technology_adoption: 'early',
        hype: 62.5,
        maturity: { percentile: 71, category: 'emerging', value: null },
        magnitude: null,
        trend_age: { value: 1_450, rank: 12, percentile: 88, category: 'young' },
        company_age: null,
        article_age: null,
        company_magnitude: null,
        news_magnitude: null,
        growth: {
          annualized: {
            companies_pct: 14.2,
            news_pct: null,
            funding_pct: null,
            default: { value: 14.2, rank: 3, percentile: 97 },
            default_category: 'fast',
            cagr_category: null,
          },
          over_window: { window: '5y', companies_pct: 80, news_pct: null, trend_pct: null, startups_pct: null, funding_pct: null },
        },
      },
      scale: {
        companies: 412,
        funding: { total: 1.2e9, average: null, rounds: 40, rounds_percentile: null, average_per_round: null, unique_investors: 55, rank_percentile: 90 },
        revenue: null,
        manpower: null,
        patents: null,
        employee_growth: null,
        article_coverage: null,
      },
      market: { size: { amount: 4.1e9, year: '2025', source: ['https://example.test'] }, cagr: null, forecast: null },
      badges: { five_percent: ['funding'], ten_percent: [], fifteen_percent: [] },
      industries: ['Semiconductors'],
      countries: ['United States'],
      features: null,
      biggest_investors: [{ name: 'Fund A', rounds: 3, invested: 1e8, companies_invested_in: [] }],
      similar_tags: [{ name: 'Quantum Computing', count: 30, relation_score: 100, relative_percentage: 12.5 }],
      publications: [],
      graphs: null,
      patent_stats: null,
      search_interest: null,
      snapshot: null,
      distributions: null,
    };
    const hits = [{ id: 'Quantum Sensing', category: 'trend', found: true, matches: [trend] }];
    const fetchMock = fetchQueue(jsonResponse(entitiesBody(hits)));
    const client = makeClient(fetchMock);
    const page = await client.entities.trends({ ids: ['Quantum Sensing'] });
    const record = page.results[0]!.matches[0]!;
    expect(record.signals?.maturity?.percentile).toBe(71);
    expect(record.signals?.growth?.over_window?.window).toBe('5y');
    expect(record.scale?.funding?.unique_investors).toBe(55);
    expect(record.market?.size?.source).toEqual(['https://example.test']);
    expect(record.badges?.five_percent).toEqual(['funding']);
    expect(record.industries).toEqual(['Semiconductors']);
    expect(record.similar_tags[0]?.relative_percentage).toBe(12.5);
    expect(record.features).toBeNull();
  });
});

describe('credits.usage', () => {
  it('GETs /v1/keys/usage with serialized query params', async () => {
    const usageBody = {
      key_id: 'key_1',
      period_from: '2026-07-01T00:00:00Z',
      period_to: '2026-08-01T00:00:00Z',
      granularity: 'month',
      total_requests: 12,
      total_credits: 40,
      buckets: [],
      meta: envelope().meta,
    };
    const fetchMock = fetchQueue(jsonResponse(usageBody));
    const client = makeClient(fetchMock);

    const usage = await client.credits.usage({
      granularity: 'month',
      from: new Date('2026-07-01T00:00:00Z'),
      to: '2026-08-01T00:00:00Z',
    });

    expect(usage.total_credits).toBe(40);
    const [url, init] = fetchMock.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/backend/v1/keys/usage');
    expect(parsed.searchParams.get('granularity')).toBe('month');
    expect(parsed.searchParams.get('from')).toBe('2026-07-01T00:00:00.000Z');
    expect(parsed.searchParams.get('to')).toBe('2026-08-01T00:00:00Z');
    expect(init!.method).toBe('GET');
    expect(init!.body).toBeUndefined();
  });

  it('sends no query params by default', async () => {
    const fetchMock = fetchQueue(jsonResponse({ buckets: [], meta: envelope().meta }));
    const client = makeClient(fetchMock);
    await client.credits.usage();
    expect(new URL(String(fetchMock.mock.calls[0]![0])).search).toBe('');
  });

  it('leaves the granularity vocabulary to the server', async () => {
    const fetchMock = fetchQueue(jsonResponse({}));
    const client = makeClient(fetchMock);
    await client.credits.usage({ granularity: 'week' as unknown as 'day' });
    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('granularity')).toBe('week');
  });
});

describe('pagination', () => {
  it('searchPages follows next_cursor and stops at null', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(envelope({ has_more: true, next_cursor: 'cur_2' })),
      jsonResponse(envelope({ results: [{ id: 'c_2', category: 'company', score: 0.5 }] })),
    );
    const client = makeClient(fetchMock);

    const pages = [];
    for await (const page of client.searchPages({ query: 'fintech', limit: 1 })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(2);
    expect(pages[1]!.results[0]!.id).toBe('c_2');
    const firstBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(firstBody.cursor).toBeUndefined();
    expect(secondBody.cursor).toBe('cur_2');
    expect(secondBody.query).toBe('fintech');
  });

  it('similarPages follows next_cursor', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(envelope({ has_more: true, next_cursor: 'cur_2' })),
      jsonResponse(envelope()),
    );
    const client = makeClient(fetchMock);
    let count = 0;
    for await (const _ of client.similarPages({ anchors: [{ value: 'acme.com' }] })) count++;
    expect(count).toBe(2);
  });

  it('searchPages under mode: "deep" yields exactly one page', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope({ has_more: false, next_cursor: null })));
    const client = makeClient(fetchMock);
    let count = 0;
    for await (const _ of client.searchPages({ query: 'x', mode: 'deep' })) count++;
    expect(count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('credits.retrieve', () => {
  it('reads the allocated credits by source', async () => {
    const body = {
      platform: 'dsp',
      scope: 'platform',
      allocated: {
        granted: 1500,
        remaining: 1400,
        reserved: 0,
        expires_at: '2027-01-20T00:00:00Z',
        sources: [
          { source: 'purchased', remaining: 900, expires_at: null, never_expires: true },
          { source: 'signup', remaining: 500, expires_at: '2027-01-20T00:00:00Z', never_expires: false },
        ],
      },
      shared: { remaining: 0 },
      spendable: 1400,
      as_of: '2026-10-25T00:00:00Z',
      meta: envelope().meta,
    };
    const client = makeClient(fetchQueue(jsonResponse(body)));
    const credits = await client.credits.retrieve();
    const sources = credits.allocated?.sources ?? [];
    expect(sources.map((s) => [s.source, s.remaining, s.expires_at, s.never_expires])).toEqual([
      ['purchased', 900, null, true],
      ['signup', 500, '2027-01-20T00:00:00Z', false],
    ]);
  });

  it('GETs /v1/credits and parses a fallback-scoped balance', async () => {
    const body = {
      platform: 'dsp',
      scope: 'tenant_wide_fallback',
      allocated: null,
      shared: null,
      spendable: 420,
      as_of: '2026-08-26T00:00:00Z',
      meta: envelope().meta,
    };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const credits = await client.credits.retrieve();
    expect(credits.spendable).toBe(420);
    expect(credits.allocated).toBeNull();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/credits');
    expect(init!.method).toBe('GET');
  });
});

describe('coverage', () => {
  it('GETs /v1/coverage with query params', async () => {
    const body = {
      segments: [
        {
          name: 'companies',
          category: 'company',
          total: 12_000_000,
          with_embeddings: 11_600_000,
          with_domain: 10_000_000,
          freshest: '2026-08-25T00:00:00Z',
          stalest: '2025-01-01T00:00:00Z',
        },
      ],
      not_in_index: ['sole proprietorships without a web presence'],
      as_of: '2026-08-26T00:00:00Z',
      degradation: [],
      meta: envelope().meta,
    };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const coverage = await client.coverage({ segment: 'companies', category: 'company' });
    expect(coverage.segments[0]!.total).toBe(12_000_000);
    const parsed = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(parsed.pathname).toBe('/backend/v1/coverage');
    expect(parsed.searchParams.get('segment')).toBe('companies');
    expect(parsed.searchParams.get('category')).toBe('company');
  });
});

describe('filterValues', () => {
  it('GETs /v1/search/filters/{name} with search and page', async () => {
    const body = {
      filter: 'industry',
      values: ['Software & Technology'],
      total: 21,
      page: 2,
      page_size: 20,
      has_more: false,
      items: [],
      meta: envelope().meta,
    };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const values = await client.filterValues('industry', { search: 'soft', page: 2 });
    expect(values.values).toEqual(['Software & Technology']);
    const parsed = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(parsed.pathname).toBe('/backend/v1/search/filters/industry');
    expect(parsed.searchParams.get('search')).toBe('soft');
    expect(parsed.searchParams.get('page')).toBe('2');
  });

  it('leaves search length and page bounds to the server', async () => {
    const fetchMock = fetchQueue(jsonResponse({}));
    const client = makeClient(fetchMock);
    await client.filterValues('industry', { search: 'x'.repeat(201), page: 0 });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get('search')).toHaveLength(201);
    expect(url.searchParams.get('page')).toBe('0');
  });

  it('forwards parent and level for two-level filters', async () => {
    const body = {
      filter: 'department',
      values: ['Engineering'],
      total: 1,
      page: 1,
      page_size: 20,
      has_more: false,
      items: [],
      meta: envelope().meta,
    };
    const fetchMock = fetchQueue(jsonResponse(body), jsonResponse(body));
    const client = makeClient(fetchMock);
    await client.filterValues('department', { level: 'parents' });
    await client.filterValues('department', { parent: 'Engineering', search: 'dat' });
    const first = new URL(String(fetchMock.mock.calls[0]![0]));
    const second = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(first.searchParams.get('level')).toBe('parents');
    expect(first.searchParams.has('parent')).toBe(false);
    expect(second.searchParams.get('parent')).toBe('Engineering');
    expect(second.searchParams.get('search')).toBe('dat');
    expect(second.searchParams.has('level')).toBe(false);
  });

  it('refuses parent beside level, and an empty parent', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(
      client.filterValues('department', { parent: 'Engineering', level: 'children' }),
    ).rejects.toThrow(/not both/);
    await expect(client.filterValues('department', { parent: '' })).rejects.toThrow(
      ClientValidationError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('documentFilterValues', () => {
  it('GETs /v1/search/filters/{category}/{name} with search and page', async () => {
    const body = {
      category: 'patent',
      filter: 'status',
      values: ['granted', 'applied'],
      total: 2,
      page: 1,
      page_size: 20,
      has_more: false,
      meta: envelope().meta,
    };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const values = await client.documentFilterValues('patent', 'status', { search: 'gr', page: 1 });
    expect(values.values).toEqual(['granted', 'applied']);
    expect(values.category).toBe('patent');
    const parsed = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(parsed.pathname).toBe('/backend/v1/search/filters/patent/status');
    expect(parsed.searchParams.get('search')).toBe('gr');
    expect(parsed.searchParams.get('page')).toBe('1');
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('GET');
  });

  it('refuses company/person and an empty name before any request', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(client.documentFilterValues('company', 'industry')).rejects.toThrow(
      /use `filterValues\(name\)`/,
    );
    await expect(client.documentFilterValues('person', 'seniority')).rejects.toThrow(
      ClientValidationError,
    );
    await expect(client.documentFilterValues('patent', '')).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sorts', () => {
  it('GETs /v1/sorts/{category} and reads the catalogue', async () => {
    const body = {
      category: 'person',
      sorts: [
        {
          field: 'tenure',
          label: 'Tenure',
          kind: 'date',
          default_direction: 'desc',
          directions: ['asc', 'desc'],
          applies_to: ['person'],
          definition: 'Time in the current role.',
          direction_labels: { asc: 'Shortest first', desc: 'Longest first' },
          group: 'professional',
        },
      ],
      directions: ['asc', 'desc'],
      total: 1,
      meta: envelope().meta,
    };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const catalogue = await client.sorts('person');
    expect(catalogue.sorts[0]!.direction_labels['desc']).toBe('Longest first');
    expect(catalogue.sorts[0]!.applies_to).toEqual(['person']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/sorts/person');
    expect(init!.method).toBe('GET');
    expect(init!.body).toBeUndefined();
  });

  it('returns an empty catalogue for a category that takes no ordering, and refuses an empty category', async () => {
    const body = { category: 'news_article', sorts: [], directions: ['asc', 'desc'], total: 0, meta: envelope().meta };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const catalogue = await client.sorts('news_article');
    expect(catalogue.sorts).toEqual([]);
    expect(catalogue.total).toBe(0);
    await expect(client.sorts('' as unknown as 'company')).rejects.toThrow(ClientValidationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('iterFilterValues / iterDocumentFilterValues', () => {
  function valuesPage(values: string[], page: number, hasMore: boolean, extra: object = {}) {
    return jsonResponse({
      filter: 'industry',
      values,
      total: 3,
      page,
      page_size: 20,
      has_more: hasMore,
      items: [],
      meta: envelope().meta,
      ...extra,
    });
  }

  it('walks pages from 1 until has_more is false, yielding each value', async () => {
    const fetchMock = fetchQueue(
      valuesPage(['Banking', 'Fintech'], 1, true),
      valuesPage(['Insurance'], 2, false),
    );
    const client = makeClient(fetchMock);
    const seen: string[] = [];
    for await (const value of client.iterFilterValues('industry', { search: 'fin' })) seen.push(value);
    expect(seen).toEqual(['Banking', 'Fintech', 'Insurance']);
    const pages = fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams);
    expect(pages.map((q) => q.get('page'))).toEqual(['1', '2']);
    expect(pages.every((q) => q.get('search') === 'fin')).toBe(true);
  });

  it('stops at an empty page even when has_more claims otherwise', async () => {
    const fetchMock = fetchQueue(valuesPage(['Banking'], 1, true), valuesPage([], 2, true));
    const client = makeClient(fetchMock);
    const seen: string[] = [];
    for await (const value of client.iterFilterValues('industry')) seen.push(value);
    expect(seen).toEqual(['Banking']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('walks a document filter the same way', async () => {
    const fetchMock = fetchQueue(
      valuesPage(['granted'], 1, true, { category: 'patent', filter: 'status' }),
      valuesPage(['applied'], 2, false, { category: 'patent', filter: 'status' }),
    );
    const client = makeClient(fetchMock);
    const seen: string[] = [];
    for await (const value of client.iterDocumentFilterValues('patent', 'status')) seen.push(value);
    expect(seen).toEqual(['granted', 'applied']);
    expect(new URL(String(fetchMock.mock.calls[1]![0])).pathname).toBe(
      '/backend/v1/search/filters/patent/status',
    );
  });

  it('refuses company/person before any request, as documentFilterValues does', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(client.iterDocumentFilterValues('company', 'industry').next()).rejects.toThrow(
      ClientValidationError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('path segments', () => {
  it('are percent-encoded, so a value cannot add path segments or a query', async () => {
    const body = { values: [], has_more: false, sorts: [], meta: envelope().meta };
    const fetchMock = fetchQueue(jsonResponse(body), jsonResponse(body), jsonResponse(body));
    const client = makeClient(fetchMock);
    await client.filterValues('industry/../../keys?x=1' as 'industry');
    await client.documentFilterValues('patent/..' as 'patent', 'status?x');
    await client.sorts('person/../credits' as 'person');
    const paths = fetchMock.mock.calls.map(([url]) => new URL(String(url)));
    expect(paths[0]!.pathname).toBe('/backend/v1/search/filters/industry%2F..%2F..%2Fkeys%3Fx%3D1');
    expect(paths[0]!.search).toBe('');
    expect(paths[1]!.pathname).toBe('/backend/v1/search/filters/patent%2F../status%3Fx');
    expect(paths[2]!.pathname).toBe('/backend/v1/sorts/person%2F..%2Fcredits');
  });

  it.each(['.', '..'])('refuse %s, which a URL would resolve as a path step', async (step) => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    for (const call of [
      () => client.runs.retrieve(step),
      () => client.runs.cancel(step),
      () => client.filterValues(step as 'industry'),
      () => client.sorts(step as 'person'),
    ]) {
      await expect(call()).rejects.toThrow(/would be read as a path step/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the retired prior_company filter', () => {
  const REPLACEMENT = /retired by the server\. Use 'employment_history' instead — for past employers/;
  // Declared `@deprecated` so old code compiles; refused before anything is sent.
  const retired = { prior_company: { include: [{ value: 'Stripe', by: 'name' as const }] } };

  it.each([
    ['search', (c: SproutsData) => c.search({ category: 'person', filters: retired })],
    ["search with category 'auto'", (c: SproutsData) => c.search({ query: 'x', category: 'auto', filters: retired })],
    ['similar', (c: SproutsData) => c.similar({ anchors: [{ value: 'stripe.com' }], filters: retired })],
  ])('is refused in %s filters, naming employment_history', async (_label, call) => {
    const fetchMock = fetchQueue();
    const err = await call(makeClient(fetchMock)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClientValidationError);
    expect((err as Error).message).toMatch(/^`filters\.prior_company` was retired/);
    expect((err as Error).message).toMatch(REPLACEMENT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['filterValues', (c: SproutsData) => c.filterValues('prior_company')],
    ['iterFilterValues', (c: SproutsData) => c.iterFilterValues('prior_company').next()],
    ['documentFilterValues', (c: SproutsData) => c.documentFilterValues('patent', 'prior_company')],
  ])('is refused by %s, naming employment_history', async (_label, call) => {
    const fetchMock = fetchQueue();
    const err = await call(makeClient(fetchMock)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClientValidationError);
    expect((err as Error).message).toMatch(/^The 'prior_company' filter was retired/);
    expect((err as Error).message).toMatch(REPLACEMENT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves employment_history, and a filter named like an Object member, alone', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()), jsonResponse(envelope()));
    const client = makeClient(fetchMock);
    await client.search({
      category: 'person',
      filters: { employment_history: { groups: [{ company: { include: [{ value: 'Stripe', by: 'name' }] } }] } },
    });
    await client.search({ category: 'patent', filters: { constructor: { include: ['x'] } } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('search — keyword_query', () => {
  const tree = { and: ['payments', { or: ['stripe', 'adyen'] }, { not: 'crypto' }] };

  it('sends the tree as given, with the default category', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    await makeClient(fetchMock).search({ keyword_query: tree });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      keyword_query: tree,
      category: 'company',
    });
  });

  it('is enough intent on its own, and combines with filters and sort', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    await makeClient(fetchMock).search({
      keyword_query: 'payments',
      filters: { geo: { places: [{ value: 'US', level: 'country' }] } },
      sort: [{ field: 'global_presence' }],
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.keyword_query).toBe('payments');
    expect(body.sort).toEqual([{ field: 'global_presence' }]);
  });

  it('leaves the grammar to the server', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    await makeClient(fetchMock).search({ query: 'fintech', keyword_query: { and: [] } });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).keyword_query).toEqual({ and: [] });
  });

  it('refuses a value that is not a keyword or a node', async () => {
    const fetchMock = fetchQueue();
    await expect(
      makeClient(fetchMock).search({ keyword_query: ['payments'] as unknown as string }),
    ).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('echoes the tree the server ran on resolved_search', async () => {
    const resolved = {
      parser_version: 'none',
      mode: 'fast' as const,
      category: 'company' as const,
      query: null,
      filters: {},
      filters_source: 'none' as const,
      semantic_query: null,
      keyword_query: tree,
      sort: [],
      conflicts: [],
      overrides: [],
    };
    const fetchMock = fetchQueue(jsonResponse(envelope({ resolved_search: resolved })));
    const page = await makeClient(fetchMock).search({ keyword_query: tree });
    expect(page.resolved_search?.keyword_query).toEqual(tree);
  });
});

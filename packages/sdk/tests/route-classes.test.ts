/**
 * Every operation in `spec/routes.json`, called through its SDK method, is
 * retried exactly as its route class allows. Each call's first attempt fails
 * after the request may have been sent (a connection reset), which is the
 * outcome that tells the classes apart: `safe` and `keyed` repeat it,
 * `billed` and `once` must not. A route in the file with no call here fails
 * the suite, so a newly wrapped route cannot go unclassified.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { RouteClass } from '../src/http';
import { SproutsData } from '../src/index';
import { TEST_KEY, envelope, jsonResponse, networkError, sseResponse } from './helpers';

// Retries wait for nothing here: this suite counts attempts, not delays.
vi.mock('../src/sleep', () => ({ sleep: async () => undefined }));

interface RouteEntry {
  method: 'GET' | 'POST';
  path: string;
  class: RouteClass;
}

const ROUTES = (
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../spec/routes.json', import.meta.url)), 'utf8')) as {
    routes: RouteEntry[];
  }
).routes;

async function drain(stream: AsyncGenerator<unknown, void, undefined>): Promise<void> {
  for await (const _ of stream) {
    // consume
  }
}

/** The SDK call behind each `METHOD path` of routes.json. */
const CALLS: Record<string, (client: SproutsData) => Promise<unknown>> = {
  'GET /v1/agents/runs': (c) => c.runs.list(),
  'POST /v1/agents/runs': (c) => c.runs.create({ query: 'x' }),
  'GET /v1/agents/runs/{run_id}': (c) => c.runs.retrieve('run_1'),
  'POST /v1/agents/runs/{run_id}/cancel': (c) => c.runs.cancel('run_1'),
  'GET /v1/agents/runs/{run_id}/events': (c) => drain(c.runs.events('run_1')),
  'GET /v1/agents/runs/{run_id}/results': (c) => c.runs.results('run_1'),
  'GET /v1/coverage': (c) => c.coverage(),
  'GET /v1/credits': (c) => c.credits.retrieve(),
  'POST /v1/entities/academic-reports': (c) => c.entities.academicReports({ ids: ['a_1'] }),
  'POST /v1/entities/companies': (c) => c.entities.companies({ ids: ['stripe.com'], by: 'domain' }),
  'POST /v1/entities/fundings': (c) => c.entities.fundings({ ids: ['f_1'] }),
  'POST /v1/entities/job-openings': (c) => c.entities.jobOpenings({ ids: ['j_1'] }),
  'POST /v1/entities/market-reports': (c) => c.entities.marketReports({ ids: ['m_1'] }),
  'POST /v1/entities/news': (c) => c.entities.news({ ids: ['n_1'] }),
  'POST /v1/entities/patents': (c) => c.entities.patents({ ids: ['p_1'] }),
  'POST /v1/entities/persons': (c) => c.entities.persons({ ids: ['linkedin.com/in/ada'], by: 'li_url' }),
  'POST /v1/entities/trends': (c) => c.entities.trends({ ids: ['t_1'] }),
  'GET /v1/feedback': (c) => c.feedback.list(),
  'POST /v1/feedback': (c) =>
    c.feedback.create({ subject_ref: { kind: 'request', id: 'req_1' }, target: { kind: 'result_set' } }),
  'GET /v1/feedback/tags': (c) => c.feedback.tags(),
  'GET /v1/feedback/votes': (c) => c.feedback.votes.list('req_1'),
  'PUT /v1/feedback/votes': (c) =>
    c.feedback.votes.cast({ request_id: 'req_1', vote: 'like', entity_category: 'company' }),
  'GET /v1/lists': (c) => c.lists.list(),
  'POST /v1/lists': (c) => c.lists.create('Targets'),
  'PATCH /v1/lists/{list_id}': (c) => c.lists.rename('lst_1', 'Renamed'),
  'DELETE /v1/lists/{list_id}': (c) => c.lists.delete('lst_1'),
  'POST /v1/lists/{list_id}/export': (c) => c.lists.export('lst_1'),
  'GET /v1/lists/{list_id}/items': (c) => c.lists.items('lst_1'),
  'POST /v1/lists/{list_id}/items': (c) =>
    c.lists.addItems('lst_1', [{ entity_category: 'company', entity_id: 'stripe.com' }]),
  'DELETE /v1/lists/{list_id}/items': (c) =>
    c.lists.removeItems('lst_1', [{ entity_category: 'company', entity_id: 'stripe.com' }]),
  'POST /v1/search/export': (c) =>
    c.searchExport({ items: [{ entity_category: 'company', entity_id: 'stripe.com' }] }),
  'GET /v1/keys/usage': (c) => c.credits.usage(),
  'POST /v1/members/resolve': (c) => c.members.resolve('ada@example.test'),
  'POST /v1/org-chart': (c) => c.orgChart.retrieve({ domain: 'stripe.com' }),
  'POST /v1/org-chart/departments': (c) => c.orgChart.departments({ domain: 'stripe.com' }),
  'POST /v1/org-chart/locations': (c) => c.orgChart.locations({ domain: 'stripe.com' }),
  'POST /v1/relationships': (c) => c.relationships.find({ query: 'who at Adyen do we know from Stripe' }),
  'POST /v1/relationships/ask': (c) => c.relationships.ask({ query: 'who?' }),
  'POST /v1/relationships/institutions': (c) =>
    c.relationships.institutions({ companies: [{ value: 'a.com' }, { value: 'b.com' }] }),
  'POST /v1/relationships/reach': (c) =>
    c.relationships.reach({ person: { li_url: 'linkedin.com/in/ada' }, target_company: { value: 'adyen.com' } }),
  'POST /v1/search': (c) => c.search({ query: 'fintech' }),
  'GET /v1/search/filters/{category}/{name}': (c) => c.documentFilterValues('patent', 'status'),
  'GET /v1/search/filters/{name}': (c) => c.filterValues('industry'),
  'POST /v1/similar': (c) => c.similar({ anchors: [{ value: 'stripe.com' }] }),
  'GET /v1/sorts/{category}': (c) => c.sorts('company'),
  'GET /v1/usage/history': (c) => c.history.list(),
  'GET /v1/usage/history/{run_id}': (c) => c.history.retrieve(1),
  'GET /v1/usage/metrics': (c) => c.history.metrics(),
};

/** The `Idempotency-Key` an attempt carried, in whatever casing it was set. */
function idempotencyKeyOf(init: RequestInit | undefined): string | undefined {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const name = Object.keys(headers).find((header) => header.toLowerCase() === 'idempotency-key');
  return name === undefined ? undefined : headers[name];
}

function matches(template: string, pathname: string): boolean {
  return new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(pathname);
}

describe('route classes', () => {
  it('every wrapped route in spec/routes.json has a call here', () => {
    const keys = ROUTES.map((route) => `${route.method} ${route.path}`);
    expect(Object.keys(CALLS).sort()).toEqual([...keys].sort());
  });

  it.each(ROUTES.map((route) => [`${route.method} ${route.path}`, route]))(
    '%s is retried after a possibly-sent failure only if its class allows',
    async (key, route) => {
      const sent: Array<{ method: string; pathname: string }> = [];
      const fetch: typeof globalThis.fetch = async (input, init) => {
        sent.push({ method: init?.method ?? 'GET', pathname: new URL(String(input)).pathname });
        if (sent.length === 1) throw networkError('ECONNRESET');
        return key.endsWith('/events') ? sseResponse('id: 1\nevent: run.done\ndata: {}\n\n') : jsonResponse(envelope());
      };
      const client = new SproutsData({ apiKey: TEST_KEY, baseUrl: 'https://api.test.invalid', fetch, maxRetries: 2 });
      const outcome = await CALLS[key]!(client).then(
        () => 'ok',
        (err: unknown) => err,
      );

      const repeats = route.class === 'safe' || route.class === 'keyed';
      expect(sent).toHaveLength(repeats ? 2 : 1);
      if (repeats) expect(outcome).toBe('ok');
      else expect((outcome as { reachedServer?: boolean }).reachedServer).toBe(true);
      for (const request of sent) {
        expect(request.method).toBe(route.method);
        expect(matches(route.path, request.pathname)).toBe(true);
      }
    },
  );

  it.each(ROUTES.map((route) => [`${route.method} ${route.path}`, route]))(
    '%s sends an Idempotency-Key only if its class needs one, the same on every retry',
    async (key, route) => {
      // A 503 is retried on every class, so each call makes two attempts.
      const keys: Array<string | undefined> = [];
      const fetch: typeof globalThis.fetch = async (_input, init) => {
        keys.push(idempotencyKeyOf(init));
        if (keys.length === 1) return jsonResponse({ status: 503, code: 'service.unavailable' }, 503);
        return key.endsWith('/events') ? sseResponse('id: 1\nevent: run.done\ndata: {}\n\n') : jsonResponse(envelope());
      };
      const client = new SproutsData({ apiKey: TEST_KEY, baseUrl: 'https://api.test.invalid', fetch, maxRetries: 2 });
      await CALLS[key]!(client);

      expect(keys).toHaveLength(2);
      if (route.class === 'billed' || route.class === 'keyed') {
        expect(keys[0]).toMatch(/^sdk-[0-9a-f]{32}$/);
        expect(keys[1]).toBe(keys[0]);
      } else {
        expect(keys).toEqual([undefined, undefined]);
      }
    },
  );
});

describe('the Idempotency-Key of a billed call', () => {
  function recording() {
    const keys: Array<string | undefined> = [];
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      keys.push(idempotencyKeyOf(init));
      return jsonResponse(envelope({ has_more: keys.length < 3, next_cursor: keys.length < 3 ? `cur_${keys.length}` : null }));
    };
    const client = new SproutsData({ apiKey: TEST_KEY, baseUrl: 'https://api.test.invalid', fetch, maxRetries: 0 });
    return { client, keys };
  }

  it('is fresh for each call, and for each page of an iteration', async () => {
    const { client, keys } = recording();
    for await (const _ of client.searchPages({ query: 'fintech' })) {
      // drain
    }
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });

  it("is the caller's when they send one", async () => {
    const { client, keys } = recording();
    await client.search({ query: 'fintech' }, { headers: { 'idempotency-key': 'mine-1' } });
    expect(keys).toEqual(['mine-1']);
  });
});

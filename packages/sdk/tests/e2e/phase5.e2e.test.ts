/**
 * Phase 5 live: search, similar, vocabulary, coverage, entities and runs on the real stack.
 * A local refusal is proved to be the server's by sending the same body with no SDK.
 */

import { describe, expect, it } from 'vitest';

import { APIError, ClientValidationError, PermissionDeniedError } from '../../src/core/errors.js';
import { entityHit, lookupRef, totalFor } from '../../src/resources/helpers.js';
import type { SearchParams } from '../../src/types/index.js';
import { collect } from '../support/rig.js';
import { arm, client, raw, setting, STACK } from './stack.js';

interface Charge {
  readonly kind: string;
  readonly credits: number;
}

async function charges(): Promise<Charge[]> {
  const answer = (await (await raw('GET', '/v1/credits/transactions?limit=100')).json()) as { results: Charge[] };
  return answer.results.filter((row) => row.kind === 'charge');
}

describe.skipIf(STACK === undefined)('phase 5, live', () => {
  it.each(['auto', 'company', 'person', 'patent'] as const)('a %s search pages, and the ledger matches what each page cost', async (category) => {
    const sdk = client();
    const query = category === 'auto' ? 'robotics companies in Germany' : 'robotics';
    const params = { category, query, limit: 2 } as SearchParams;
    const before = (await charges()).length;
    const first = await sdk.search(params);
    const second = await sdk.search({ ...params, cursor: first.next_cursor ?? '' });
    const again = await sdk.search(params);
    const rows = await collect(sdk.iterSearch({ category, query, limit: 2, maxResults: 4 }));
    const after = await charges();
    const spent = -after.slice(0, after.length - before).reduce((sum, row) => sum + row.credits, 0);
    const costs = [first, second, again].map((page) => page.meta.credits_charged ?? 0);
    expect(rows).toHaveLength(4);
    expect(first.meta.credits_charged).toBeGreaterThan(0);
    expect(again.meta.credits_charged).toBe(first.meta.credits_charged);
    expect(spent).toBeGreaterThanOrEqual(costs.reduce((a, b) => a + b, 0) - 1e-9);
  });

  it('a deep search answers one page', async () => {
    const page = await client().search({ query: 'fintechs in Berlin', mode: 'deep', limit: 5 });
    expect(page.results.length).toBeGreaterThan(0);
    expect(page.next_cursor).toBeNull();
  });

  it('similar reads its anchors back', async () => {
    const page = await client().similar({ anchors: ['stripe.com'], limit: 2 });
    expect((page.resolved_search?.filters['anchors'] as { value: string }[])[0]?.value).toBe('stripe.com');
  });

  it('filter values for company and another filter, sorts and coverage', async () => {
    const sdk = client();
    const industry = await sdk.filterValues('industry');
    const company = await sdk.filterValues('company', { search: 'example' });
    const sorts = await sdk.sorts('company');
    const coverage = await sdk.coverage();
    expect(industry.items).toBeNull();
    expect(company.filter).toBe('company');
    expect(sorts.sorts.every((s) => ['asc', 'desc'].includes(s.default_direction))).toBe(true);
    expect(totalFor(coverage, 'person')).toBeGreaterThan(0);
  });

  it('a company lookup projects its fields locally, and a document row looks up by its id', async () => {
    const sdk = client();
    const answer = await sdk.entities.companies({ ids: ['example-1.de'], by: 'domain', fields: ['account_name'] });
    const hit = entityHit(answer, 'example-1.de');
    const patent = (await sdk.search({ category: 'patent', query: 'solid state battery', limit: 1 })).results[0];
    const ref = patent === undefined ? undefined : lookupRef(patent);
    const found = await sdk.entities.patents({ ids: [ref?.value ?? ''] });
    expect(hit?.found).toBe(true);
    expect(hit?.matches.every((m) => Object.keys(m).every((k) => k === 'id' || k === 'account_name'))).toBe(true);
    expect(ref?.value.startsWith('d1_')).toBe(true);
    expect(found.results[0]?.found).toBe(true);
  });

  it.each([
    ['S1 auto takes no filters', '/v1/search', { query: 'x', filters: { industry: { include: ['x'] } } }],
    ['S2 deep takes no filters', '/v1/search', { category: 'company', query: 'x', mode: 'deep', filters: { industry: { include: ['x'] } } }],
    ['S3 query or keyword_query', '/v1/search', { category: 'company', query: 'x', keyword_query: 'y' }],
    ['S4 sort fits the category', '/v1/search', { category: 'person', query: 'x', sort: [{ field: 'revenue' }] }],
    ['S6 documents are not deep', '/v1/search', { category: 'patent', query: 'x', mode: 'deep' }],
    ['S7 a range needs a bound', '/v1/search', { category: 'company', query: 'x', filters: { revenue: {} } }],
    ['N3 fifty values resolved', '/v1/entities/companies', { ids: Array.from({ length: 51 }, (_, i) => `n${String(i)}.de`), by: 'auto' }],
    ['M1 look-alikes are companies', '/v1/similar', { anchors: [{ value: 'stripe.com' }], category: 'person' }],
  ])('%s: refused locally, and by the server', async (_, path, body) => {
    const sdk = client();
    const call =
      path === '/v1/search'
        ? sdk.search({ category: 'auto', ...body } as SearchParams)
        : path === '/v1/similar'
          ? sdk.similar(body as never)
          : sdk.entities.companies(body as never);
    await expect(call).rejects.toBeInstanceOf(ClientValidationError);
    expect((await raw('POST', path, body)).status).toBe(422);
  });

  it('a run from start to rows and events', async () => {
    const sdk = client();
    const handle = await sdk.runs.create({ query: 'fintech companies hiring engineers' });
    const run = await sdk.runs.wait(handle.run_id, { pollIntervalMs: 200, maxWaitMs: 30_000 });
    const rows = await sdk.runs.results(handle.run_id, { limit: 5 });
    const events = await collect(sdk.runs.events(handle.run_id));
    expect(run.status).toBe('completed');
    expect(rows.results.length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
  });

  it('a key with the default scopes cannot start a run', async () => {
    const sdk = client({ key: setting('SPROUTSDATA_E2E_DEFAULT_SCOPES_KEY') });
    await expect(sdk.runs.create({ query: 'x' })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('a 502 on a free read is retried and succeeds; on a billed search it is thrown, not repeated', async () => {
    const proxy = client({ baseUrl: setting('SPROUTSDATA_E2E_FAULT_URL') });
    await arm('/v1/coverage', 502);
    expect((await proxy.coverage()).segments.length).toBeGreaterThan(0);
    await arm('/v1/search', 502);
    const error = await proxy.search({ query: 'robotics', limit: 1 }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).status).toBe(502);
    expect((await proxy.search({ query: 'robotics', limit: 1 })).results.length).toBeGreaterThan(0);
  });
});

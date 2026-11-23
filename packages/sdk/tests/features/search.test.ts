/** `search` and `similar` (S1-S11, M1-M2): bodies, local refusals and pages. */

import { describe, expect, it } from 'vitest';

import { ClientValidationError, CursorExpiredError, PaginationDepthExceededError } from '../../src/core/errors.js';
import { searchBody } from '../../src/requests/search.js';
import { lookupRef } from '../../src/resources/helpers.js';
import { Search } from '../../src/resources/search.js';
import type { SearchEnvelope, SearchParams } from '../../src/types/index.js';
import { assertValidRequest, recorded, recordedBody, respond } from '../support/answers.js';
import { collect, rig } from '../support/rig.js';

const COMPANY = recordedBody<Record<string, unknown> & { results: Record<string, unknown>[] }>('search', 'company');

function page(rows: number, cursor: string | null): Record<string, unknown> {
  const first = COMPANY.results[0];
  return { ...COMPANY, results: Array.from({ length: rows }, (_, i) => ({ ...first, id: `d-${String(i)}.de` })), next_cursor: cursor, has_more: cursor !== null };
}

async function refused(params: unknown, match: RegExp | string): Promise<void> {
  const r = rig([]);
  await expect(new Search(r.transport).search(params as SearchParams)).rejects.toThrow(match);
  await expect(new Search(r.transport).search(params as SearchParams)).rejects.toBeInstanceOf(ClientValidationError);
  expect(r.sent).toHaveLength(0);
}

describe('search', () => {
  it('S1: the category is always sent, company by default', async () => {
    const r = rig([recorded('search', 'company')]);
    await new Search(r.transport).search({ query: 'robotics' });
    expect(r.body()).toEqual({ category: 'company', query: 'robotics' });
    assertValidRequest('search', r.body());
  });

  it('S1: auto takes only query, mode, limit and cursor', async () => {
    const r = rig([recorded('search', 'auto')]);
    const answer = await new Search(r.transport).search({ category: 'auto', query: 'robotics in Germany', limit: 2 });
    expect(r.body()).toEqual({ category: 'auto', query: 'robotics in Germany', limit: 2 });
    expect(answer.resolved_search?.category).toBe('company');
    await refused({ category: 'auto', query: 'x', sort: [] }, "category 'auto' takes only");
    await refused({ category: 'auto', query: 'x', mode: 'fast' }, '`auto` mode only');
  });

  it('S1: a field another category has, or none takes, is refused locally', async () => {
    await refused({ category: 'patent', query: 'x', include_domains: ['a.de'] }, 'include_domains narrow company, person and job_opening');
    await refused({ category: 'company', filters: { nope: {} } }, 'filters.nope: not a field');
    await refused({ category: 'fish', query: 'x' }, 'category must be one of');
    await refused({ category: 'company', query: 'x', limit: 101 }, 'limit: must be at most 100');
  });

  it.each(['company', 'person', 'patent', 'auto'])('S2: deep is refused and says where its work went (%s)', async (category) => {
    await refused({ category, query: 'x', mode: 'deep' }, '`deep` search is no longer offered: start an agent run (`runs.create`)');
  });

  it('S3: query and keyword_query are exclusive, and keywords are company-only', async () => {
    await refused({ query: 'x', keyword_query: 'kubernetes' }, 'not both');
    await refused({ category: 'person', keyword_query: 'kubernetes' }, 'searches company text');
    await refused({ category: 'patent', keyword_query: 'kubernetes' }, 'searches company text');
    await refused({ keyword_query: { or: ['a', '  '] } }, 'a keyword cannot be blank');
    await refused({ category: 'company' }, 'provide `query`, `keyword_query` or `filters`');
  });

  it('S4: sort fields fit the category and appear once', async () => {
    await refused({ query: 'x', sort: [{ field: 'tenure' }] }, 'tenure cannot order a company');
    await refused({ category: 'person', query: 'x', sort: [{ field: 'revenue' }] }, 'revenue cannot order a person');
    await refused({ query: 'x', sort: [{ field: 'revenue' }, { field: 'revenue', direction: 'asc' }] }, 'duplicate field');
    await refused({ category: 'patent', query: 'x', sort: [{ field: 'publication_date' }, { field: 'publication_date' }] }, 'duplicate field');
  });

  it('S5: domains never beside a company filter, and never blank', async () => {
    const company = { company: { include: [{ value: 'a.de', by: 'domain' }] } };
    await refused({ query: 'x', include_domains: ['a.de'], filters: company }, 'two ways to say');
    await refused({ category: 'job_opening', query: 'x', exclude_domains: ['a.de'], filters: company }, 'two ways to say');
    await refused({ query: 'x', exclude_domains: [' '] }, 'cannot be blank');
  });

  it('S6: documents refuse company filters and an empty intent', async () => {
    await refused({ category: 'patent', filters: { industry: { include: ['x'] } } }, 'filters.industry: not a field');
    await refused({ category: 'patent', filters: { status: 'granted' } }, 'or `filters` that narrow the search');
    await refused({ category: 'patent', query: 'x', filters: {} }, 'must contain at least one filter');
    await refused({ category: 'trend', filters: { growth: [] } }, 'or `filters` that narrow the search');
  });

  it('S6: an empty filter beside a value or a query is sent', () => {
    const narrowed = { category: 'trend', filters: { growth: [], topic: 'ai' } } as const;
    const worded = { category: 'trend', query: 'x', filters: { growth: [] } } as const;
    expect(searchBody(narrowed)).toEqual(narrowed);
    expect(searchBody(worded)).toEqual(worded);
  });

  it('S6: job openings take domains, which narrow on their own', async () => {
    const r = rig([respond('search', 200, { ...COMPANY, results: [], next_cursor: null, has_more: false })]);
    await new Search(r.transport).search({ category: 'job_opening', include_domains: ['stripe.com'] });
    expect(r.body()).toEqual({ category: 'job_opening', include_domains: ['stripe.com'] });
    assertValidRequest('search', r.body());
  });

  it('S9: resolved search and suggestion are read, and new enum values kept', async () => {
    const body = { ...COMPANY, resolved_search: { ...(COMPANY['resolved_search'] as object), semantic_scope: 'company' }, suggestion: { kind: 'search', category: 'person', message: 'try people' } };
    const r = rig([respond('search', 200, body)]);
    const answer: SearchEnvelope = await new Search(r.transport).search({ query: 'x' });
    expect(answer.resolved_search?.semantic_scope).toBe('company');
    expect(answer.suggestion).toEqual({ kind: 'search', category: 'person', message: 'try people' });
    const galaxy: SearchEnvelope['results'][number]['category'] = 'galaxy';
    expect(galaxy).toBe('galaxy');
  });

  it('an empty answer reads why, what to leave out, and which filters are thin', async () => {
    // dsp-backend #179 (no_match, relax, sparse filters), #180 (balance), #182 (environment
    // deprecated, and absent from the builds before it).
    const { environment: _dropped, ...meta } = COMPANY['meta'] as Record<string, unknown>;
    const body = {
      ...COMPANY,
      results: [],
      total: 0,
      has_more: false,
      next_cursor: null,
      suggestion: {
        kind: 'relax',
        category: null,
        message: '0 with every filter; 40 without HQ in Iceland.',
        without: [{ filter: 'hq_country', label: 'HQ in Iceland', total: 40 }],
      },
      degradation: [
        { reason: 'no_match', impact: 'recall', detail: 'No company there has 5,000+ staff.' },
        { reason: 'sparse_filter', impact: 'recall', detail: '`revenue` is held by 2.0%.' },
      ],
      resolved_search: {
        ...(COMPANY['resolved_search'] as object),
        sparse_filters: [{ filter: 'revenue', record_type: 'company', populated: 2, of: 100, share: 0.02 }],
      },
      meta: { ...meta, credits_balance: 412.5 },
    };
    const r = rig([respond('search', 200, body)]);
    const answer: SearchEnvelope = await new Search(r.transport).search({ query: 'companies in Iceland with 5,000+ staff' });
    const suggestion = answer.suggestion;
    expect(suggestion?.kind).toBe('relax');
    expect(suggestion?.category).toBeNull();
    expect(suggestion?.without).toEqual([{ filter: 'hq_country', label: 'HQ in Iceland', total: 40 }]);
    expect(answer.degradation.map((d) => d.reason)).toEqual(['no_match', 'sparse_filter']);
    expect(answer.resolved_search?.sparse_filters[0]?.share).toBe(0.02);
    expect(answer.meta.credits_balance).toBe(412.5);
    expect(answer.meta.environment).toBeUndefined();
  });

  it('S10: lookupRef per category', () => {
    const company = recordedBody<SearchEnvelope>('search', 'company').results[0];
    const person = recordedBody<SearchEnvelope>('search', 'person').results[0];
    const patent = recordedBody<SearchEnvelope>('search', 'patent').results[0];
    if (company === undefined || person === undefined || patent === undefined) throw new Error('fixtures have rows');
    // A company row's id is its sealed index id (dsp-backend 5e60c47); the lookup uses its domain.
    expect(lookupRef(company)).toEqual({ category: 'company', by: 'domain', value: company['domain'] });
    expect(lookupRef(person)).toEqual({ category: 'person', by: 'li_url', value: 'https://www.linkedin.com/in/alex-example-0' });
    expect(lookupRef(patent)).toEqual({ category: 'patent', by: undefined, value: patent.id });
    expect(lookupRef({ id: 'd1_abc', category: 'news_article', score: null })).toEqual({ category: 'news_article', by: 'id', value: 'd1_abc' });
    expect(lookupRef({ id: 'c456', category: 'person', score: null })).toBeUndefined();
    expect(lookupRef({ id: '0f7a39dd2e81c6b4', category: 'company', score: null, linkedin_url: 'https://www.linkedin.com/company/x' })).toEqual({ category: 'company', by: 'li_url', value: 'https://www.linkedin.com/company/x' });
    expect(lookupRef({ id: '0f7a39dd2e81c6b4', category: 'company', score: null })).toBeUndefined();
    expect(lookupRef({ id: '0123456789abcdef', category: 'trend', score: null })).toBeUndefined();
  });
});

describe('search pages', () => {
  it('S11: iterSearch follows next_cursor through short pages and stops on null', async () => {
    const r = rig([respond('search', 200, page(2, 'c1')), respond('search', 200, page(0, 'c2')), respond('search', 200, page(1, null))]);
    const rows = await collect(new Search(r.transport).iterSearch({ query: 'x', limit: 2 }));
    expect(rows.map((row) => row.id)).toEqual(['d-0.de', 'd-1.de', 'd-0.de']);
    expect(r.sent.map((s) => (s.body as { cursor?: string }).cursor)).toEqual([undefined, 'c1', 'c2']);
  });

  it('S11: maxResults asks the last page only for the rows still wanted', async () => {
    const r = rig([respond('search', 200, page(4, 'c1')), respond('search', 200, page(1, 'c2'))]);
    const rows = await collect(new Search(r.transport).iterSearch({ query: 'x', limit: 4, maxResults: 5 }));
    expect(rows).toHaveLength(5);
    expect(r.sent.map((s) => (s.body as { limit: number }).limit)).toEqual([4, 1]);
  });

  it('S11: depth past ten thousand is refused locally', async () => {
    const r = rig(Array.from({ length: 100 }, (_, i) => respond('search', 200, page(100, `c${String(i)}`))));
    await expect(collect(new Search(r.transport).iterSearch({ query: 'x', limit: 100 }))).rejects.toBeInstanceOf(PaginationDepthExceededError);
    expect(r.sent).toHaveLength(100);
  });

  it('S11: an expired cursor is its own error, and maxResults is at least one', async () => {
    const problem = { type: 'about:blank', title: 'Cursor expired', status: 422, code: 'pagination.cursor_expired', detail: 'older than 24h', request_id: 'r1' };
    const r = rig([respond('search', 422, problem)]);
    await expect(new Search(r.transport).search({ query: 'x', cursor: 'old' })).rejects.toBeInstanceOf(CursorExpiredError);
    expect(() => new Search(r.transport).iterSearch({ query: 'x', maxResults: 0 })).toThrow('maxResults must be a whole number of at least 1');
  });
});

describe('similar', () => {
  it('M1: similar is companies only and takes bare domains', async () => {
    const r = rig([recorded('similar', 'company')]);
    await new Search(r.transport).similar({ anchors: ['stripe.com', { value: 'Adyen', by: 'name' }] });
    expect(r.body()).toEqual({ anchors: [{ value: 'stripe.com' }, { value: 'Adyen', by: 'name' }] });
    assertValidRequest('similar', r.body());
    await expect(new Search(r.transport).similar({ anchors: ['a.de'], category: 'person' as 'company' })).rejects.toThrow("category must be 'company'");
    await expect(new Search(r.transport).similar({ anchors: 'stripe.com' as unknown as string[] })).rejects.toThrow('anchors must be a list');
  });

  it('M2: resolved filters carry anchors and combine', async () => {
    const r = rig([recorded('similar', 'company'), recorded('similar', 'company')]);
    const answer = await new Search(r.transport).similar({ anchors: ['stripe.com'], combine: 'or', limit: 2 });
    const rows = await collect(new Search(r.transport).iterSimilar({ anchors: ['stripe.com'], maxResults: 1 }));
    expect(answer.resolved_search?.filters['combine']).toBe('and');
    expect(rows).toHaveLength(1);
    expect((r.body(1) as { limit: number }).limit).toBe(1);
  });
});

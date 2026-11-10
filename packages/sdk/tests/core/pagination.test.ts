import { describe, expect, it } from 'vitest';

import { PaginationDepthExceededError } from '../../src/core/errors.js';
import { degraded, firstLimit, nextLimit, Pager, truncated } from '../../src/core/pagination.js';

const body = { style: 'cursor', items: 'results', cursorIn: 'body' } as const;
const query = { style: 'cursor', items: 'results', cursorIn: 'query' } as const;
const bound = { style: 'cursor', items: 'results', cursorIn: 'body', bindsLimit: true } as const;

describe('paging', () => {
  it('resends the frozen body whatever the caller does to theirs', () => {
    const sent = { query: 'fintech', filters: { country: ['DE'] } };
    const pager = new Pager(body, { body: sent });
    sent.filters.country.push('FR');
    expect(pager.nextInput('c1', 10, 25).body).toEqual({ query: 'fintech', filters: { country: ['DE'] }, cursor: 'c1', limit: 25 });
    expect(pager.sent.body).toEqual({ query: 'fintech', filters: { country: ['DE'] } });
  });

  it('puts a query cursor in the query and keeps a bound limit', () => {
    expect(new Pager(query, { query: { limit: 5 } }).nextInput('c', 5).query).toEqual({ limit: 5, cursor: 'c' });
    expect(new Pager(bound, { body: { limit: 5 } }).nextInput('c', 5, 2).body).toEqual({ limit: 5, cursor: 'c' });
    expect(new Pager({ style: 'cursor', items: 'results' }, {}).nextInput('c', 1).body).toEqual({ cursor: 'c' });
  });

  it('knows its page size', () => {
    expect(new Pager(query, { query: { limit: 25 } }).pageSize).toBe(25);
    expect(new Pager(body, { body: {} }).pageSize).toBe(10);
  });

  it('refuses to page past the depth cap', () => {
    const pager = new Pager(body, { body: {} }, 9_990);
    expect(pager.atDepthCap(10)).toBe(true);
    expect(() => pager.nextInput('c', 10)).toThrow(PaginationDepthExceededError);
  });

  it('asks a numbered page for the next number', () => {
    expect(new Pager({ style: 'page_number', items: 'values' }, { query: { q: 'x' } }).nextPageNumber(1).query).toEqual({ q: 'x', page: 2 });
  });

  it('asks only for the rows still wanted', () => {
    expect(nextLimit(10, 15, 20)).toBe(5);
    expect(nextLimit(10, 20, 20)).toBeUndefined();
    expect(nextLimit(10, 5, undefined)).toBeUndefined();
    expect(firstLimit(undefined, 3)).toBe(3);
    expect(firstLimit(50, undefined)).toBe(50);
  });

  it('says when the server stopped paging early', () => {
    const stopped = { has_more: false, degradation: [{ reason: 'pagination_truncated' }] };
    expect([truncated(stopped), degraded(stopped)]).toEqual([true, true]);
    expect(truncated({ has_more: true, degradation: [{ reason: 'pagination_truncated' }] })).toBe(false);
    expect(truncated('x')).toBe(false);
    expect(degraded({ degradation: [] })).toBe(false);
  });
});

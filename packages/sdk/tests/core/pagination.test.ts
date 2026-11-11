import { describe, expect, it } from 'vitest';

import { PaginationDepthExceededError } from '../../src/core/errors.js';
import { degraded, firstLimit, follow, nextLimit, Pager, start, truncated } from '../../src/core/pagination.js';

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

describe('walks', () => {
  const BODY = { style: 'cursor', items: 'results', cursorIn: 'body' } as const;
  const QUERY = { style: 'cursor', items: 'results', cursorIn: 'query' } as const;
  const NUMBERED = { style: 'page_number', items: 'values' } as const;

  it('starts with no more rows than wanted', () => {
    expect(start(BODY, { body: { q: 1, limit: 50 } }, 20).sent.body).toEqual({ q: 1, limit: 20 });
    expect(start(QUERY, { query: {} }, 5).sent.query).toEqual({ limit: 5 });
    expect(start(QUERY, { query: {} }, undefined).sent.query).toEqual({});
    expect(start(BODY, { body: {} }, 0).sent.body).toEqual({});
    expect(start(NUMBERED, { query: { search: 'a' } }, 3).sent.query).toEqual({ search: 'a' });
  });

  it('goes on while there is a cursor, whatever the page size', () => {
    const pager = start(BODY, { body: { q: 1, limit: 10 } }, undefined);
    expect(follow(pager, { results: [], next_cursor: 'c1' }, undefined)?.sent.body).toEqual({ q: 1, limit: 10, cursor: 'c1' });
    expect(follow(pager, { results: [1], next_cursor: null }, undefined)).toBeUndefined();
    expect(follow(pager, { results: [1, 2], next_cursor: 'c1' }, 2)).toBeUndefined();
    expect(follow(pager, 'not a page', undefined)).toBeUndefined();
    expect(follow(pager, { next_cursor: 'c1' }, undefined)?.offset).toBe(0);
  });

  it('goes on by number while has_more says so', () => {
    const pager = start(NUMBERED, { query: { search: 'a' } }, undefined);
    const next = follow(pager, { values: ['x'], has_more: true, page: 1 }, undefined);
    expect(next?.sent.query).toEqual({ search: 'a', page: 2 });
    expect(next?.offset).toBe(1);
    expect(follow(pager, { values: ['x'], has_more: false, page: 1 }, undefined)).toBeUndefined();
  });
});

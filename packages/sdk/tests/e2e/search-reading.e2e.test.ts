/**
 * Live: how a search's words are read in each mode, and the rows meeting part of a search.
 *
 * A search sent without `mode` is read in `auto` (a model turns the words into filters) and billed
 * as `search_auto`; `fast` sets no filter from the words. A company search where few records meet
 * every filter returns, after them, the rows meeting part of it: the stack's fake search service
 * holds 2 companies headquartered in Luxembourg, and 38 more just across the border
 * (sproutsdata-py `e2e/fake_search.py`).
 */

import { describe, expect, it } from 'vitest';

import { ClientValidationError } from '../../src/core/errors.js';
import { Toolset } from '../../src/tools/index.js';
import { client, raw, STACK } from './stack.js';

const EXACT = 2;
const NEAR = 38;
const IN_LUXEMBOURG = { geo: { places: [{ level: 'country', value: 'Luxembourg' }] }, employee_count: { gte: 50 } } as const;

describe.skipIf(STACK === undefined)('how a search is read, live', () => {
  it('a search without a mode is read and billed as auto', async () => {
    const sdk = client();
    const words = 'robotics companies in Germany';
    const unsaid = await sdk.search({ query: words, limit: 2 });
    const fast = await sdk.search({ query: words, mode: 'fast', limit: 2 });
    const autoPrice = await sdk.credits.quote({ operation: 'search_auto', rows: 2 });
    expect([unsaid.resolved_search?.mode, unsaid.resolved_search?.filters_source]).toEqual(['auto', 'parser']);
    expect(unsaid.meta.credits_charged).toBe(autoPrice.credits);
    expect([fast.resolved_search?.filters_source, fast.resolved_search?.parser_version]).toEqual(['none', 'none']);
  });

  it('a partial match follows the exact ones and says what it misses', async () => {
    const page = await client().search({ query: 'payments', mode: 'fast', filters: IN_LUXEMBOURG, limit: 5 });
    const exact = page.results.filter((hit) => !hit.unmet);
    const partial = page.results.filter((hit) => hit.unmet);
    expect([page.total, page.total_exact]).toEqual([EXACT + NEAR, EXACT]);
    expect(page.results.slice(0, exact.length)).toEqual(exact); // the exact rows come first
    expect(exact.every((hit) => hit.match_score === 1)).toBe(true);
    expect(partial.every((hit) => (hit.match_score ?? 1) < 1)).toBe(true);
    expect(new Set(partial.flatMap((hit) => (hit.unmet ?? []).map((u) => `${u.filter}:${u.state}`)))).toEqual(new Set(['geo:near']));
  });

  it('exact matches only, when asked', async () => {
    const page = await client().search({ query: 'payments', mode: 'fast', filters: IN_LUXEMBOURG, partial_matches: false, limit: 5 });
    expect([page.total, page.results.length]).toEqual([EXACT, EXACT]);
    expect(page.results.every((hit) => hit.unmet === null)).toBe(true);
  });

  it('a document search with partial_matches is refused locally and by the server', async () => {
    const body = { category: 'patent', query: 'battery', partial_matches: false };
    await expect(client().search(body as never)).rejects.toThrow(ClientValidationError);
    expect((await raw('POST', '/v1/search', body)).status).toBe(422);
  });

  it('the search tool tells a model which rows are close matches', async () => {
    const result = await new Toolset(client()).run('sprouts_search', { query: 'payments', filters: IN_LUXEMBOURG, limit: 5 });
    if (!('total' in result)) throw new Error(`expected a page, got ${JSON.stringify(result)}`);
    const partial = result.results.filter((row) => 'unmet' in row);
    expect(result.total_exact).toBe(EXACT);
    expect(partial).toHaveLength(result.results.length - EXACT);
    expect(result.caveats[0]).toMatch(/^partial_rows:/);
  });
});

/**
 * Phase 8 live: each tool once through `Toolset`, on the real stack. The tools answer a model
 * in the shape of `spec/tools/`; here that shape meets the real backend, which the parity
 * fixtures only imitate.
 */

import { describe, expect, it } from 'vitest';

import { AuthenticationError } from '../../src/index.js';
import { Toolset, type ToolResult } from '../../src/tools/index.js';
import { arm, client, setting, STACK } from './stack.js';

const rows = (result: ToolResult): readonly Record<string, unknown>[] => {
  if (!('total' in result)) throw new Error(`expected a page, got ${JSON.stringify(result)}`);
  return result.results;
};

describe.skipIf(STACK === undefined)('tools on the stack', () => {
  it('a search answers with rows a lookup can take, and the lookup finds the record', async () => {
    const tools = new Toolset(client());
    const search = await tools.run('sprouts_search', { query: 'robotics', limit: 3 });
    const found = rows(search).find((row) => (row['lookup'] as { by?: string } | undefined)?.by === 'domain');
    expect('interpreted_as' in search && Object.keys(search.interpreted_as).sort()).toEqual(['conflicts', 'filters', 'source']);
    const value = (found?.['lookup'] as { value: string }).value;
    const lookup = await tools.run('sprouts_entity_lookup', { category: 'company', ids: [value], fields: ['account_name'] });
    expect('results' in lookup && lookup.results[0]?.found).toBe(true);
  });

  it('a look-alike names its anchor and leaves it out', async () => {
    const result = await new Toolset(client()).run('sprouts_similar', { anchors: [{ value: 'stripe.com' }], limit: 3 });
    expect(rows(result).every((row) => row['domain'] !== 'stripe.com')).toBe(true);
  });

  it('a gateway answer is retried, and one that persists comes back as data', async () => {
    const tools = new Toolset(client({ baseUrl: setting('SPROUTSDATA_E2E_FAULT_URL') }));
    await arm('/v1/search', 502);
    expect('error' in (await tools.run('sprouts_search', { query: 'robotics', limit: 1 }))).toBe(false);
    await arm('/v1/search', 502, 3); // the first attempt and both retries
    const result = await tools.run('sprouts_search', { query: 'robotics', limit: 1 });
    expect('error' in result && [result.error.code, result.error.retryable]).toEqual(['http.502', false]);
  });

  it('a rejected key is thrown', async () => {
    const tools = new Toolset(client({ key: `sk_dsp_live_${'x'.repeat(43)}` }));
    await expect(tools.run('sprouts_search', { query: 'robotics' })).rejects.toBeInstanceOf(AuthenticationError);
  });
});

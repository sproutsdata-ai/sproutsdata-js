/**
 * The SDK review's JS reproductions (`SDK-REVIEW/evidence/repro/
 * js-findings.test.mjs`, pinned at fb0195a), ported to the current names.
 * Each asserts the corrected behaviour, so each failed on fb0195a and is now
 * that finding's regression guard. No network: `fetch` is scripted.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BASE_URL, FeatureNotAvailableError, InternalServerError, SproutsData } from '../src/index';
import { TEST_KEY, envelope, jsonResponse } from './helpers';

const LIVE_KEY = 'sk_dsp_live_' + 'x'.repeat(22);

const { slept } = vi.hoisted(() => ({ slept: [] as number[] }));
vi.mock('../src/sleep', () => ({
  sleep: vi.fn(async (ms: number) => {
    slept.push(ms);
  }),
}));

afterEach(() => {
  slept.length = 0;
  vi.unstubAllEnvs();
});

describe('review findings', () => {
  it('JS-1 a production key is not sent to a non-production host by default', async () => {
    vi.stubEnv('SPROUTSDATA_BASE_URL', '');
    vi.stubEnv('DSP_BASE_URL', '');
    const hosts: string[] = [];
    const fetch: typeof globalThis.fetch = async (url) => {
      hosts.push(new URL(String(url)).host);
      return jsonResponse(envelope());
    };
    await new SproutsData({ apiKey: LIVE_KEY, fetch }).search({ query: 'fintech companies in Germany' });
    expect(hosts).toEqual([new URL(DEFAULT_BASE_URL).host]);
    expect(hosts[0]).toBe('api.sproutsdata.ai');
  });

  it('JS-2 a billed search is not re-sent after a timeout (the first may have been charged)', async () => {
    let attempts = 0;
    const fetch: typeof globalThis.fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        attempts += 1;
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const client = new SproutsData({ apiKey: TEST_KEY, fetch, timeoutMs: 30, maxRetries: 2 });
    await expect(client.search({ query: 'fintech', mode: 'auto' })).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('JS-3 a Retry-After of nine hours is surfaced, not slept on and retried', async () => {
    let attempts = 0;
    const fetch: typeof globalThis.fetch = async () => {
      attempts += 1;
      return jsonResponse(
        { type: 'x', title: 'Monthly quota exhausted', status: 429, code: 'quota.monthly_exhausted' },
        429,
        { 'retry-after': '32400' },
      );
    };
    const client = new SproutsData({ apiKey: TEST_KEY, fetch, maxRetries: 2 });
    await expect(client.credits.retrieve()).rejects.toThrow();
    expect(attempts).toBe(1);
    expect(slept).toEqual([]);
  });

  it('JS-4 501 not_implemented is not reported as an internal server error', async () => {
    const fetch: typeof globalThis.fetch = async () =>
      jsonResponse({ type: 'x', title: 'Not implemented', status: 501, code: 'not_implemented' }, 501);
    const client = new SproutsData({ apiKey: TEST_KEY, fetch, maxRetries: 0 });
    const err = await client.search({ query: 'x', mode: 'deep', category: 'company' }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(InternalServerError);
    expect(err).toBeInstanceOf(FeatureNotAvailableError);
  });

  it('JS-5 searchPages resends page 1 filters even if the caller mutates their object', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(init!.body as string) as Record<string, unknown>);
      const cursor = bodies.length === 1 ? 'cur2' : null;
      return jsonResponse(
        envelope({
          results: [{ id: `c${bodies.length}`, category: 'company', score: 1 }],
          has_more: cursor !== null,
          next_cursor: cursor,
        }),
      );
    };
    const client = new SproutsData({ apiKey: TEST_KEY, fetch });
    const params = {
      query: 'fintech',
      category: 'company' as const,
      filters: { industry: { include: ['Financial Services'] } },
    };
    for await (const _page of client.searchPages(params)) {
      params.filters.industry.include.push('Insurance'); // e.g. a UI updating its own state
    }
    expect(bodies[1]!.filters).toEqual(bodies[0]!.filters);
    expect(bodies[0]!.filters).toEqual({ industry: { include: ['Financial Services'] } });
  });

  it('JS-6 requestId comes from X-Request-Id when the error body has none', async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html', 'x-request-id': 'req_from_header' },
      });
    const client = new SproutsData({ apiKey: TEST_KEY, fetch, maxRetries: 0 });
    const err = (await client.credits.retrieve().catch((e: unknown) => e)) as { requestId?: string };
    expect(err.requestId).toBe('req_from_header');
  });

  it('JS-7 the key env var is the one the Python SDK reads (SPROUTSDATA_API_KEY)', () => {
    vi.stubEnv('DSP_API_KEY', '');
    vi.stubEnv('SPROUTSDATA_API_KEY', TEST_KEY);
    expect(() => new SproutsData({ fetch: async () => jsonResponse({}) })).not.toThrow();
  });
});

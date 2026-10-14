import { describe, expect, it } from 'vitest';

import {
  APIUserAbortError,
  RunWaitTimeoutError,
  SproutsData,
  ClientValidationError,
} from '../src/index';
import { TEST_KEY, envelope, fetchQueue, jsonResponse, networkError, sseResponse } from './helpers';

function makeClient(fetchImpl: typeof globalThis.fetch, maxRetries = 0) {
  return new SproutsData({
    apiKey: TEST_KEY,
    baseUrl: 'https://dsp.example.test/backend',
    fetch: fetchImpl,
    maxRetries,
  });
}

function runResult(overrides: Record<string, unknown> = {}) {
  return {
    run_id: 'run_1',
    status: 'completed',
    stop_reason: 'universe_exhausted',
    coverage: null,
    degradation: [],
    insights: [],
    insight_sources: [],
    summary: 'Done.',
    exclusions: [],
    credits_charged: 12,
    error: null,
    meta: envelope().meta,
    ...overrides,
  };
}

const handle = { run_id: 'run_1', status: 'pending', meta: envelope().meta };

describe('runs.create', () => {
  it('POSTs the body with the Idempotency-Key header', async () => {
    const fetchMock = fetchQueue(jsonResponse(handle, 202));
    const client = makeClient(fetchMock);

    const created = await client.runs.create(
      {
        query: 'series B fintechs in DACH with an in-house ML team',
        effort: 'high',
        criteria: ['has an in-house ML team'],
      },
      { idempotencyKey: 'intent-7f3a' },
    );

    expect(created.run_id).toBe('run_1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/agents/runs');
    expect(init!.method).toBe('POST');
    const headers = init!.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('intent-7f3a');
    expect(headers['X-API-Key']).toBe(TEST_KEY);
    expect(JSON.parse(init!.body as string)).toEqual({
      query: 'series B fintechs in DACH with an in-house ML team',
      effort: 'high',
      criteria: ['has an in-house ML team'],
    });
  });

  it('a replay (200 instead of 202) resolves normally', async () => {
    const fetchMock = fetchQueue(jsonResponse({ ...handle, status: 'running' }, 200));
    const client = makeClient(fetchMock);
    const replayed = await client.runs.create(
      { query: 'x' },
      { idempotencyKey: 'intent-7f3a' },
    );
    expect(replayed.status).toBe('running');
  });

  it('retries carry the same Idempotency-Key', async () => {
    const fetchMock = fetchQueue(
      new Response(JSON.stringify({ status: 503 }), {
        status: 503,
        headers: { 'content-type': 'application/problem+json', 'retry-after': '0' },
      }),
      jsonResponse(handle, 202),
    );
    const client = makeClient(fetchMock, 1);
    await client.runs.create({ query: 'x' }, { idempotencyKey: 'intent-7f3a' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect((call[1]!.headers as Record<string, string>)['Idempotency-Key']).toBe('intent-7f3a');
    }
  });

  it('generates an sdk- key when none is given, and resends it on every retry', async () => {
    const fetchMock = fetchQueue(networkError('ECONNRESET'), jsonResponse(handle, 202));
    const client = makeClient(fetchMock, 2);
    await client.runs.create({ query: 'x' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map(
      (call) => (call[1]!.headers as Record<string, string>)['Idempotency-Key'],
    );
    expect(keys[0]).toMatch(/^sdk-[0-9a-f]{32}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('generates a fresh key per call', async () => {
    const fetchMock = fetchQueue(jsonResponse(handle, 202), jsonResponse(handle, 202));
    const client = makeClient(fetchMock);
    await client.runs.create({ query: 'x' });
    await client.runs.create({ query: 'x' });
    const [first, second] = fetchMock.mock.calls.map(
      (call) => (call[1]!.headers as Record<string, string>)['Idempotency-Key'],
    );
    expect(first).not.toBe(second);
  });

  it('refuses an empty key or query, and leaves lengths and vocabularies to the server', async () => {
    const fetchMock = fetchQueue(jsonResponse(handle, 202));
    const client = makeClient(fetchMock);
    await expect(client.runs.create({ query: 'x' }, { idempotencyKey: '  ' })).rejects.toThrow(
      /idempotencyKey/,
    );
    await expect(client.runs.create({ query: '' })).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
    await client.runs.create(
      {
        query: 'x'.repeat(4001),
        effort: 'extreme' as unknown as 'high',
        criteria: Array.from({ length: 11 }, () => 'c'),
      },
      { idempotencyKey: 'k'.repeat(256) },
    );
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toHaveLength(256);
    expect(JSON.parse(init.body as string).effort).toBe('extreme');
  });
});

describe('runs lifecycle', () => {
  it('retrieve GETs the run', async () => {
    const fetchMock = fetchQueue(jsonResponse(runResult()));
    const client = makeClient(fetchMock);
    const run = await client.runs.retrieve('run_1');
    expect(run.credits_charged).toBe(12);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/agents/runs/run_1');
    expect(init!.method).toBe('GET');
  });

  it('list passes limit; cancel POSTs; results takes cursor + limit', async () => {
    const fetchMock = fetchQueue(
      jsonResponse({ results: [], meta: envelope().meta }),
      jsonResponse(runResult({ status: 'cancelled' })),
      jsonResponse({ ...envelope(), results: [{ id: 'c_1' }], total: 1 }),
    );
    const client = makeClient(fetchMock);

    await client.runs.list({ limit: 5 });
    await client.runs.cancel('run_1');
    await client.runs.results('run_1', { cursor: 'cur_1', limit: 50 });

    const listUrl = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(listUrl.pathname).toBe('/backend/v1/agents/runs');
    expect(listUrl.searchParams.get('limit')).toBe('5');
    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      'https://dsp.example.test/backend/v1/agents/runs/run_1/cancel',
    );
    expect(fetchMock.mock.calls[1]![1]!.method).toBe('POST');
    const resultsUrl = new URL(String(fetchMock.mock.calls[2]![0]));
    expect(resultsUrl.pathname).toBe('/backend/v1/agents/runs/run_1/results');
    expect(resultsUrl.searchParams.get('cursor')).toBe('cur_1');
    expect(resultsUrl.searchParams.get('limit')).toBe('50');
  });

  it('resultsPages follows next_cursor', async () => {
    const fetchMock = fetchQueue(
      jsonResponse({ ...envelope(), results: [{ id: 'c_1' }], has_more: true, next_cursor: 'cur_2' }),
      jsonResponse({ ...envelope(), results: [{ id: 'c_2' }] }),
    );
    const client = makeClient(fetchMock);
    const rows: string[] = [];
    for await (const page of client.runs.resultsPages('run_1')) {
      for (const row of page.results) rows.push(row.id);
    }
    expect(rows).toEqual(['c_1', 'c_2']);
  });

  it('rejects an empty run id before any request', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(client.runs.retrieve('')).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('percent-encodes the run id in every path', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(runResult()),
      jsonResponse(runResult({ status: 'cancelled' })),
      jsonResponse({ ...envelope(), results: [] }),
      sseResponse('event: run.done\ndata: {}\n\n'),
    );
    const client = makeClient(fetchMock);
    const runId = '../keys/usage?x=1';
    await client.runs.retrieve(runId);
    await client.runs.cancel(runId);
    await client.runs.results(runId);
    for await (const _ of client.runs.events(runId)) break;
    const paths = fetchMock.mock.calls.map(([url]) => new URL(String(url)));
    const encoded = '..%2Fkeys%2Fusage%3Fx%3D1';
    expect(paths.map((url) => url.pathname)).toEqual([
      `/backend/v1/agents/runs/${encoded}`,
      `/backend/v1/agents/runs/${encoded}/cancel`,
      `/backend/v1/agents/runs/${encoded}/results`,
      `/backend/v1/agents/runs/${encoded}/events`,
    ]);
    expect(paths.every((url) => url.search === '')).toBe(true);
  });
});

describe('runs.wait', () => {
  it('polls until a terminal status and returns the settled result', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(runResult({ status: 'pending', credits_charged: null })),
      jsonResponse(runResult({ status: 'running', credits_charged: null })),
      jsonResponse(runResult({ status: 'completed' })),
    );
    const client = makeClient(fetchMock);
    const run = await client.runs.wait('run_1', { pollIntervalMs: 1 });
    expect(run.status).toBe('completed');
    expect(run.credits_charged).toBe(12);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('aborting the signal mid-wait throws APIUserAbortError', async () => {
    const controller = new AbortController();
    const fetchMock = fetchQueue(
      jsonResponse(runResult({ status: 'running', credits_charged: null })),
      () => {
        throw new Error('unreachable: wait should have aborted during the sleep');
      },
    );
    const client = makeClient(fetchMock);
    const wait = client.runs.wait('run_1', {
      pollIntervalMs: 60_000,
      signal: controller.signal,
    });
    queueMicrotask(() => controller.abort());
    await expect(wait).rejects.toThrow(APIUserAbortError);
  });

  it('past its deadline throws RunWaitTimeoutError carrying the last polled run', async () => {
    const running = () => jsonResponse(runResult({ status: 'running', credits_charged: null }));
    const client = makeClient(async () => running());
    const failure = (await client.runs
      .wait('run_1', { timeoutMs: 20 })
      .catch((e: unknown) => e)) as RunWaitTimeoutError;
    expect(failure).toBeInstanceOf(RunWaitTimeoutError);
    expect(failure.run.status).toBe('running');
    expect(failure.timeoutMs).toBe(20);
    expect(failure.message).toContain('run_1');
  });

  it('returns a failed or expired run rather than throwing', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(runResult({ status: 'failed', error: 'budget exhausted' })),
      jsonResponse(runResult({ status: 'expired' })),
    );
    const client = makeClient(fetchMock);
    expect((await client.runs.wait('run_1')).status).toBe('failed');
    expect((await client.runs.wait('run_1')).status).toBe('expired');
  });
});

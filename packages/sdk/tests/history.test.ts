import { describe, expect, it } from 'vitest';

import {
  SproutsData,
  ClientValidationError,
  ErrorCode,
  NotFoundError,
  failureRate,
  type HistoryRunSummary,
  type SnapshotState,
} from '../src/index';
import { TEST_KEY, envelope, fetchQueue, jsonResponse, problemResponse } from './helpers';

function makeClient(fetchImpl: typeof globalThis.fetch) {
  return new SproutsData({
    apiKey: TEST_KEY,
    baseUrl: 'https://dsp.example.test/backend',
    fetch: fetchImpl,
    maxRetries: 0,
  });
}

function historyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    occurred_at: '2026-08-17T10:00:00Z',
    action_type: 'dsp.search.fast',
    actor_type: 'api_key',
    environment: 'test',
    status: 'ok',
    error_code: null,
    query: 'industrial robotics',
    result_count: 25,
    credits_charged: 1,
    latency_ms: 180,
    ...overrides,
  };
}

describe('history.list', () => {
  it('GETs /v1/usage/history with serialized query params', async () => {
    const body = { ...envelope(), results: [historyRow()], total: 1 };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);

    const page = await client.history.list({
      limit: 50,
      action_type: 'dsp.search.fast',
      from: new Date('2026-08-01T00:00:00Z'),
      to: '2026-08-26T00:00:00Z',
    });

    expect(page.results[0]!.credits_charged).toBe(1);
    const parsed = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(parsed.pathname).toBe('/backend/v1/usage/history');
    expect(parsed.searchParams.get('limit')).toBe('50');
    expect(parsed.searchParams.get('action_type')).toBe('dsp.search.fast');
    expect(parsed.searchParams.get('from')).toBe('2026-08-01T00:00:00.000Z');
    expect(parsed.searchParams.get('to')).toBe('2026-08-26T00:00:00Z');
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('GET');
  });

  it('refuses an empty action_type list, and leaves the vocabulary and limit to the server', async () => {
    const fetchMock = fetchQueue(jsonResponse({ ...envelope(), results: [] }));
    const client = makeClient(fetchMock);
    await expect(client.history.list({ action_type: [] })).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
    await client.history.list({ action_type: 'dsp.invented.later', limit: 500 });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get('action_type')).toBe('dsp.invented.later');
    expect(url.searchParams.get('limit')).toBe('500');
  });

  it('reads a pending row as pending, not as a failure', async () => {
    const body = { ...envelope(), results: [historyRow({ status: 'pending', credits_charged: 0 })] };
    const client = makeClient(fetchQueue(jsonResponse(body)));
    const page = await client.history.list();
    const row: HistoryRunSummary = page.results[0]!;
    expect(row.status).toBe('pending');
  });

  it('repeats action_type for an array, and accepts the newer actions', async () => {
    const body = { ...envelope(), results: [historyRow()], total: 1 };
    const fetchMock = fetchQueue(jsonResponse(body), jsonResponse(body));
    const client = makeClient(fetchMock);
    await client.history.list({ action_type: ['dsp.relationships', 'dsp.agent.run.xhigh'] });
    await client.history.list({ action_type: 'dsp.org_chart' });
    const first = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(first.searchParams.getAll('action_type')).toEqual([
      'dsp.relationships',
      'dsp.agent.run.xhigh',
    ]);
    const second = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(second.searchParams.getAll('action_type')).toEqual(['dsp.org_chart']);
  });

  it('listPages follows next_cursor', async () => {
    const fetchMock = fetchQueue(
      jsonResponse({ ...envelope(), results: [historyRow()], has_more: true, next_cursor: 'cur_2' }),
      jsonResponse({ ...envelope(), results: [historyRow({ id: 43 })] }),
    );
    const client = makeClient(fetchMock);
    let count = 0;
    for await (const _ of client.history.listPages()) count++;
    expect(count).toBe(2);
    const second = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(second.searchParams.get('cursor')).toBe('cur_2');
  });
});

describe('history.retrieve', () => {
  it('GETs one run with its snapshot', async () => {
    const detail = {
      ...historyRow(),
      request: { query: 'industrial robotics', limit: 25 },
      resolved_search: null,
      snapshot: { results: [], total: 0 },
      snapshot_state: 'present',
      snapshot_expires_at: '2026-09-17T10:00:00Z',
      meta: envelope().meta,
    };
    const fetchMock = fetchQueue(jsonResponse(detail));
    const client = makeClient(fetchMock);
    const run = await client.history.retrieve(42);
    expect(run.snapshot_state).toBe('present');
    expect(run.request.query).toBe('industrial robotics');
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://dsp.example.test/backend/v1/usage/history/42',
    );
  });

  it("types a later search page's `continuation` snapshot state", async () => {
    // A cursor page is charged and listed like any run, but only a search's
    // first page stores a snapshot; the server says so with this state.
    const state: SnapshotState = 'continuation';
    const fetchMock = fetchQueue(
      jsonResponse({
        ...historyRow(),
        request: { query: 'industrial robotics', cursor: 'cur_2' },
        resolved_search: null,
        snapshot: null,
        snapshot_state: state,
        snapshot_expires_at: null,
        meta: envelope().meta,
      }),
    );
    const run = await makeClient(fetchMock).history.retrieve(43);
    expect(run.snapshot).toBeNull();
    expect(run.snapshot_state).toBe('continuation');
  });

  it('maps a 404 to NotFoundError with code history.not_found', async () => {
    const fetchMock = fetchQueue(
      problemResponse(404, { code: 'history.not_found', title: 'No such run' }),
    );
    const client = makeClient(fetchMock);
    const failure = await client.history.retrieve(999).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(NotFoundError);
    expect((failure as NotFoundError).code).toBe(ErrorCode.HISTORY_NOT_FOUND);
  });

  it('rejects a non-integer run id before any request', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(client.history.retrieve(1.5)).rejects.toThrow(ClientValidationError);
    await expect(client.history.retrieve(0)).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('history.metrics', () => {
  it('GETs /v1/usage/metrics with the window', async () => {
    const body = {
      period_from: '2026-08-01T00:00:00Z',
      period_to: '2026-08-26T00:00:00Z',
      total_requests: 10,
      total_ok: 6,
      total_failed: 2,
      total_pending: 2,
      total_credits: 14,
      buckets: [
        {
          day: '2026-08-17T00:00:00Z',
          action_type: 'dsp.search.fast',
          requests: 10,
          ok: 6,
          failed: 2,
          pending: 2,
          credits: 14,
        },
      ],
      meta: envelope().meta,
    };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const metrics = await client.history.metrics({ from: '2026-08-01T00:00:00Z' });
    expect(metrics.total_credits).toBe(14);
    expect(metrics.total_pending).toBe(2);
    expect(metrics.buckets[0]!.pending).toBe(2);
    const parsed = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(parsed.pathname).toBe('/backend/v1/usage/metrics');
    expect(parsed.searchParams.get('from')).toBe('2026-08-01T00:00:00Z');
  });
});

describe('failureRate', () => {
  it('is failed / (ok + failed): pending runs have not failed', () => {
    expect(failureRate({ total_ok: 6, total_failed: 2 })).toBe(0.25);
    expect(failureRate({ ok: 3, failed: 1 })).toBe(0.25);
  });

  it('is null when nothing has finished, never a misleading 0', () => {
    expect(failureRate({ total_ok: 0, total_failed: 0 })).toBeNull();
    expect(failureRate({ ok: 0, failed: 0 })).toBeNull();
  });
});

describe('usage regression', () => {
  it('flat client.credits.usage() still hits /v1/keys/usage', async () => {
    const fetchMock = fetchQueue(jsonResponse({ buckets: [], meta: envelope().meta }));
    const client = makeClient(fetchMock);
    await client.credits.usage();
    expect(new URL(String(fetchMock.mock.calls[0]![0])).pathname).toBe('/backend/v1/keys/usage');
  });
});

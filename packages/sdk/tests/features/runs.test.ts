/** Agent runs (U1-U6): start, list, wait, events and results. */

import { describe, expect, it } from 'vitest';

import { ClientValidationError, FeatureNotAvailableError, WaitTimeoutError } from '../../src/core/errors.js';
import { Runs } from '../../src/resources/runs.js';
import { EFFORT_NAMES } from '../../src/requests/effort.js';
import type { RunCreateParams, RunResult } from '../../src/types/index.js';
import { assertValidRequest, recorded, recordedBody, respond } from '../support/answers.js';
import { collect, rig } from '../support/rig.js';

const STARTED = recordedBody<RunResult>('runs_retrieve', 'started');
const state = (status: string): Record<string, unknown> => ({ ...STARTED, status });

describe('runs', () => {
  it('U1: list pages by cursor and reads effort and stop_reason', async () => {
    const first = recordedBody<{ results: unknown[]; next_cursor: string }>('runs_list', 'all');
    const last = { ...first, has_more: false, next_cursor: null, results: first.results.slice(0, 1) };
    const r = rig([respond('runs_list', 200, first), respond('runs_list', 200, first), respond('runs_list', 200, last)]);
    const runs = new Runs(r.transport);
    const page = await runs.list({ limit: 25 });
    const rows = await collect(runs.iterList({ limit: 25 }));
    expect([page.results[0]?.effort, page.results[0]?.stop_reason]).toEqual(['basic', null]);
    expect(rows).toHaveLength(first.results.length + 1);
    expect(r.query(2)).toEqual({ limit: '25', cursor: first.next_cursor });
    await expect(runs.list({ limit: 101 })).rejects.toThrow('limit must be an integer between 1 and 100');
  });

  it('U1: a server that cannot list runs throws FeatureNotAvailableError', async () => {
    const problem = { type: 'about:blank', title: 'Not implemented', status: 501, code: 'not_implemented', detail: 'not yet', request_id: 'r' };
    const r = rig([respond('runs_list', 501, problem)]);
    await expect(new Runs(r.transport).list()).rejects.toBeInstanceOf(FeatureNotAvailableError);
    expect(r.sent).toHaveLength(1);
  });

  it('U2: a run has effort_ran and its cost, and no degradation', async () => {
    const r = rig([recorded('runs_retrieve', 'started'), recorded('runs_cancel', 'cancelled')]);
    const runs = new Runs(r.transport);
    const run = await runs.retrieve('run-perf');
    const cancelled = await runs.cancel('run-perf');
    expect([run.effort_ran, run.credits_charged]).toEqual(['standard', 8.5]);
    expect(run).not.toHaveProperty('degradation');
    expect(r.sent[1]?.method).toBe('POST');
    expect(cancelled.run_id).toBe('run-perf');
  });

  it('U3: create always sends an idempotency key and reuses it on retry', async () => {
    const unavailable = { type: 'about:blank', title: 'Unavailable', status: 503, code: 'service.unavailable', detail: 'busy', request_id: 'r' };
    const r = rig([respond('runs_create', 503, unavailable, { 'retry-after': '1' }), recorded('runs_create', 'company')]);
    const handle = await new Runs(r.transport).create({ query: 'fintech companies hiring engineers', category: 'company' });
    const keys = r.sent.map((s) => s.headers.get('idempotency-key'));
    expect(handle.run_id).toBe('run-perf');
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    assertValidRequest('runs_create', r.body());
  });

  it('U3: a caller key is sent as is, and one the API would refuse is refused', async () => {
    const r = rig([recorded('runs_create', 'company')]);
    const runs = new Runs(r.transport);
    await runs.create({ query: 'x' }, { idempotencyKey: 'nightly-2026-11-11' });
    expect(r.sent[0]?.headers.get('idempotency-key')).toBe('nightly-2026-11-11');
    await expect(runs.create({ query: 'x' }, { idempotencyKey: 'k'.repeat(121) })).rejects.toBeInstanceOf(ClientValidationError);
    await expect(runs.create({ query: '' })).rejects.toThrow('query: must be at least 1 characters');
    expect(r.sent).toHaveLength(1);
  });

  it.each(Object.entries(EFFORT_NAMES))('U3: an earlier effort name is sent as its new one: %s', async (earlier, current) => {
    const r = rig([recorded('runs_create', 'company')]);
    await new Runs(r.transport).create({ query: 'x', effort: earlier as NonNullable<RunCreateParams['effort']> });
    expect(r.body()).toEqual({ query: 'x', effort: current });
    assertValidRequest('runs_create', r.body());
  });

  it('U3: a current effort name is sent as is, and an unknown one is refused', async () => {
    const r = rig([recorded('runs_create', 'company')]);
    const runs = new Runs(r.transport);
    await runs.create({ query: 'x', effort: 'standard' });
    expect(r.body()).toEqual({ query: 'x', effort: 'standard' });
    await expect(runs.create({ query: 'x', effort: 'turbo' as NonNullable<RunCreateParams['effort']> })).rejects.toThrow('effort');
    expect(r.sent).toHaveLength(1);
  });

  it('U4: wait polls until the run settles and passes options on', async () => {
    const r = rig([respond('runs_retrieve', 200, state('pending')), respond('runs_retrieve', 200, state('running')), respond('runs_retrieve', 200, state('completed'))]);
    const run = await new Runs(r.transport).wait('run-perf', { pollIntervalMs: 2000 }, { requestId: 'poll-1' });
    expect(run.status).toBe('completed');
    expect(r.clock.sleeps).toEqual([2000, 3000]);
    expect(r.sent.every((s) => s.headers.get('x-request-id') === 'poll-1')).toBe(true);
  });

  it('U4: a failed run is returned, and a slow one times out with the last state', async () => {
    const failed = rig([respond('runs_retrieve', 200, state('failed'))]);
    expect((await new Runs(failed.transport).wait('run-perf')).status).toBe('failed');
    const slow = rig([respond('runs_retrieve', 200, state('running'))]);
    const clock = slow.clock;
    let now = 0;
    clock.now = () => now;
    clock.sleep = (ms) => {
      clock.sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    };
    const error = await new Runs(slow.transport).wait('run-perf', { pollIntervalMs: 10_000, maxWaitMs: 60_000 }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WaitTimeoutError);
    expect((error as WaitTimeoutError).last).toMatchObject({ status: 'running' });
    expect(Math.max(...clock.sleeps)).toBe(15_000);
  });

  it('U4: wait keeps the spec rhythm by default (spec/defaults.json runWait)', async () => {
    const slow = rig([respond('runs_retrieve', 200, state('running'))]);
    let now = 0;
    slow.clock.now = () => now;
    slow.clock.sleep = (ms) => {
      slow.clock.sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    };
    await expect(new Runs(slow.transport).wait('run-perf')).rejects.toBeInstanceOf(WaitTimeoutError);
    expect(slow.clock.sleeps.slice(0, 5)).toEqual([3000, 4500, 6750, 10_125, 15_000]);
    expect(Math.max(...slow.clock.sleeps)).toBe(15_000);
    expect(now).toBeGreaterThan(885_000);
    expect(now).toBeLessThanOrEqual(900_000);
  });

  it('U5: events resume with Last-Event-ID and end when the stream closes', async () => {
    const r = rig([recorded('runs_events', 'stream')]);
    const events = await collect(new Runs(r.transport).events('run-perf', { lastEventId: '0' }));
    expect(events.map((e) => e.event)).toEqual(Array.from({ length: 6 }, () => 'run.progress'));
    expect(events.at(-1)?.id).toBe('6');
    expect(r.sent[0]?.headers.get('last-event-id')).toBe('0');
  });

  it("U5: a person run's preliminary rows carry no preview", async () => {
    const frames = 'id: 1\nevent: rows.preliminary\ndata: {"count": 3, "record_type": "person"}\n\n';
    const r = rig([{ status: 200, raw_body: frames, content_type: 'text/event-stream' }]);
    const [event] = await collect(new Runs(r.transport).events('run-perf'));
    expect(event?.data).toEqual({ count: 3, record_type: 'person' });
  });

  it('U6: results page by cursor, with columns and no resolved search', async () => {
    const first = { ...recordedBody<{ results: unknown[]; next_cursor: string }>('runs_results', 'first_page'), columns: [{ name: 'ceo', description: 'Chief executive', source: 'web' }] };
    const last = { ...first, has_more: false, next_cursor: null };
    const r = rig([respond('runs_results', 200, first), respond('runs_results', 200, first), respond('runs_results', 200, last)]);
    const runs = new Runs(r.transport);
    const page = await runs.results('run-perf', { limit: 25 });
    const rows = await collect(runs.iterResults('run-perf', { maxResults: first.results.length + 1 }));
    expect(page.columns).toEqual([{ name: 'ceo', description: 'Chief executive', source: 'web' }]);
    expect([page.resolved_search, page.suggestion]).toEqual([null, null]);
    expect(rows).toHaveLength(first.results.length + 1);
    expect(r.query(2)['cursor']).toBe(first.next_cursor);
  });
});

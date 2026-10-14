/**
 * `runs.wait`'s schedule: polls 3 s apart, growing 1.5× to a 15 s ceiling,
 * with a 15-minute default deadline. Waits are observed through a mocked
 * `sleep` that moves a fake clock, so the whole 15 minutes runs instantly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RunWaitTimeoutError, SproutsData } from '../src/index';
import { TEST_KEY, envelope, jsonResponse } from './helpers';

const { slept } = vi.hoisted(() => ({ slept: [] as number[] }));
vi.mock('../src/sleep', () => ({
  sleep: vi.fn(async (ms: number) => {
    slept.push(ms);
    vi.setSystemTime(Date.now() + ms);
  }),
}));

function run(status: string) {
  return {
    run_id: 'run_1',
    status,
    stop_reason: null,
    coverage: null,
    degradation: [],
    insights: [],
    insight_sources: [],
    summary: '',
    exclusions: [],
    credits_charged: null,
    error: null,
    meta: envelope().meta,
  };
}

/** A client whose run reports `running` for `polls` reads, then `completed`. */
function clientCompletingAfter(polls: number) {
  let reads = 0;
  const fetch: typeof globalThis.fetch = async () => {
    reads += 1;
    return jsonResponse(run(reads > polls ? 'completed' : 'running'));
  };
  return new SproutsData({ apiKey: TEST_KEY, baseUrl: 'https://dsp.example.test', fetch, maxRetries: 0 });
}

beforeEach(() => {
  slept.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runs.wait schedule', () => {
  it('polls from 3 s, 1.5× per poll, up to 15 s', async () => {
    const result = await clientCompletingAfter(7).runs.wait('run_1');
    expect(result.status).toBe('completed');
    expect(slept).toEqual([3_000, 4_500, 6_750, 10_125, 15_000, 15_000, 15_000]);
  });

  it('gives up after 15 minutes by default, carrying the last run, and never oversleeps the deadline', async () => {
    const failure = (await clientCompletingAfter(Infinity)
      .runs.wait('run_1')
      .catch((e: unknown) => e)) as RunWaitTimeoutError;
    expect(failure).toBeInstanceOf(RunWaitTimeoutError);
    expect(failure.timeoutMs).toBe(900_000);
    expect(failure.run.status).toBe('running');
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBe(900_000);
  });

  it('starts from pollIntervalMs when given, never below 250 ms', async () => {
    await clientCompletingAfter(2).runs.wait('run_1', { pollIntervalMs: 1 });
    expect(slept).toEqual([250, 375]);
  });
});

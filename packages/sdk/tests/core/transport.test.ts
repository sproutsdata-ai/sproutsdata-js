import { describe, expect, it, vi } from 'vitest';

import { OPERATIONS } from '../../src/generated/operations.js';
import { callAnswer, callJson, callPages, callStream, operation } from '../../src/core/call.js';
import { sleep, SYSTEM_CLOCK } from '../../src/core/clock.js';
import {
  APIConnectionError,
  APIResponseValidationError,
  APIUserAbortError,
  ClientValidationError,
  NotFoundError,
  RedirectRefusedError,
} from '../../src/core/errors.js';
import { Transport } from '../../src/core/transport.js';
import { FakeClock, options, recordingFetch, type Scripted } from '../support/fakes.js';

const search = { ...OPERATIONS.search, name: 'search' };
const events = { ...OPERATIONS.runsEvents, name: 'runsEvents' };

function transport(script: readonly Scripted[], changes = {}): { transport: Transport; sent: ReturnType<typeof recordingFetch>['sent']; clock: FakeClock } {
  const { fetch, sent } = recordingFetch(script);
  const clock = new FakeClock();
  return { transport: new Transport(options({ fetch, ...changes }), clock), sent, clock };
}

function streaming(text: string, status = 200): typeof globalThis.fetch {
  return () => Promise.resolve(new Response(status === 200 ? text : JSON.stringify({ code: 'agents.run_not_found' }), { status, headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' } }));
}

describe('the transport', () => {
  it('sends, reports the answer to onResponse, and never shows the key', async () => {
    const { transport: t } = transport([{ status: 200, body: { results: [] }, headers: { 'x-request-id': 'r1' } }]);
    const seen: (string | undefined)[] = [];
    const answer = await t.send(search, { body: { query: 'x' } }, { onResponse: (meta) => seen.push(meta.requestId) });
    expect(answer.kind).toBe('json');
    expect(seen).toEqual(['r1']);
    expect(JSON.stringify(t)).not.toContain('fixture_key');
    expect(JSON.stringify(t)).toContain('sk_dsp_live_***');
  });

  it('stops at the caller\'s abort, before an attempt and while waiting to retry', async () => {
    const before = new AbortController();
    before.abort();
    await expect(transport([{ status: 200, body: {} }]).transport.send(search, {}, { signal: before.signal })).rejects.toBeInstanceOf(APIUserAbortError);
    const during = new AbortController();
    const { fetch } = recordingFetch([{ status: 503, body: {}, headers: { 'retry-after': '0' } }]);
    const real = new Transport(options({ fetch }), { ...SYSTEM_CLOCK, sleep: (ms, signal) => { during.abort(); return sleep(ms, signal); } });
    await expect(real.send(search, {}, { signal: during.signal })).rejects.toBeInstanceOf(APIUserAbortError);
  });

  it('cancels the attempt in flight when the caller aborts', async () => {
    const { transport: t } = transport([{ network: 'read_timeout' }]);
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 1);
    await expect(t.send(search, {}, { signal: controller.signal, timeoutMs: 1_000 })).rejects.toBeInstanceOf(APIUserAbortError);
  });

  it('times an attempt out with its own timer', async () => {
    const { transport: t } = transport([{ network: 'read_timeout' }], { maxRetries: 0 });
    await expect(t.send(search, {}, { timeoutMs: 5 })).rejects.toThrow(/timed out after 5ms/);
  });

  it('refuses a redirect, however the fetch reports it, and never repeats it', async () => {
    const { transport: answered } = transport([{ status: 302, headers: { location: 'https://elsewhere.example' } }]);
    await expect(answered.send(search)).rejects.toThrow(/Redirect refused \(HTTP 302\)/);
    const refused = new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    const fetch = vi.fn(() => Promise.reject(refused));
    const t = new Transport(options({ fetch }), new FakeClock());
    await expect(t.send({ ...OPERATIONS.creditsRetrieve, name: 'creditsRetrieve' })).rejects.toBeInstanceOf(RedirectRefusedError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a body that cannot be JSON before sending anything', async () => {
    const { transport: t, sent } = transport([{ status: 200, body: {} }]);
    await expect(t.send(search, { body: { n: 1n } })).rejects.toBeInstanceOf(ClientValidationError);
    expect(sent).toHaveLength(0);
  });

  it('passes a non-SDK failure through unchanged', async () => {
    const odd = new Transport(options({ fetch: () => Promise.reject(new Error('boom')) }), new FakeClock());
    await expect(odd.send(search, {}, { maxRetries: 0 })).rejects.toBeInstanceOf(APIConnectionError);
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a fetch that rejects with a non-Error must still map
    const thrown = new Transport(options({ fetch: () => Promise.reject('a string') }), new FakeClock());
    await expect(thrown.send(search, {}, { maxRetries: 0 })).rejects.toThrow(/a string/);
  });

  it('streams events, and maps a stream that cannot start', async () => {
    const t = new Transport(options({ fetch: streaming('id: 1\ndata: {"n":1}\n\n') }), new FakeClock());
    const got: unknown[] = [];
    for await (const event of t.stream(events, { path: { run_id: 'r1' } }, { lastEventId: '0' })) got.push(event.data);
    expect(got).toEqual([{ n: 1 }]);
    const missing = new Transport(options({ fetch: streaming('', 404) }), new FakeClock());
    await expect(missing.stream(events, { path: { run_id: 'r1' } }).next()).rejects.toBeInstanceOf(NotFoundError);
    const empty = new Transport(options({ fetch: () => Promise.resolve(new Response(null, { status: 200 })) }), new FakeClock());
    await expect(empty.stream(events, { path: { run_id: 'r1' } }).next()).rejects.toThrow();
  });
});

describe('the typed call', () => {
  it('returns a JSON body, an answer, or a stream', async () => {
    const { transport: t } = transport([{ status: 200, body: { balance: 1 } }]);
    expect((await callJson(t, 'creditsRetrieve')).body).toEqual({ balance: 1 });
    const { transport: raw } = transport([{ status: 204 }]);
    expect((await callAnswer(raw, 'listsDelete', { path: { list_id: 'l1' } })).kind).toBe('empty');
    expect(operation('search')).toMatchObject({ name: 'search', method: 'POST', path: '/v1/search' });
    const s = new Transport(options({ fetch: streaming('data: {"n":2}\n\n') }), new FakeClock());
    const first = await callStream(s, 'runsEvents', { path: { run_id: 'r1' } }).next();
    expect(first.value).toMatchObject({ data: { n: 2 } });
  });

  it('walks the pages of a paged operation, with the request id on the first only', async () => {
    const { transport: t, sent } = transport([
      { status: 200, body: { results: [1], next_cursor: 'c1' } },
      { status: 200, body: { results: [2], next_cursor: null } },
    ]);
    const pages = [];
    for await (const page of callPages(t, 'creditsTransactions', { query: { limit: 1 } }, { requestId: 'mine' })) pages.push(page.body);
    expect(pages).toHaveLength(2);
    expect(sent.map((s) => s.headers.get('x-request-id'))).toEqual(['mine', null]);
    expect(t.clock).toBeDefined();
    await expect(callPages(t, 'coverage', {}).next()).rejects.toThrow('coverage does not page');
  });

  it('refuses an answer that is not the JSON object the operation answers with', async () => {
    const { transport: t } = transport([{ status: 200, body: [1, 2] }]);
    await expect(callJson(t, 'creditsRetrieve')).rejects.toBeInstanceOf(APIResponseValidationError);
  });
});

describe('the clock', () => {
  it('sleeps, and stops sleeping when aborted', async () => {
    await sleep(0);
    const before = new AbortController();
    before.abort();
    await expect(sleep(10, before.signal)).rejects.toBeInstanceOf(APIUserAbortError);
    const during = new AbortController();
    const waiting = sleep(1_000, during.signal);
    during.abort();
    await expect(waiting).rejects.toBeInstanceOf(APIUserAbortError);
    const finishing = new AbortController();
    await sleep(0, finishing.signal);
    expect(SYSTEM_CLOCK.now()).toBeGreaterThan(0);
    expect(SYSTEM_CLOCK.random()).toBeLessThan(1);
  });
});

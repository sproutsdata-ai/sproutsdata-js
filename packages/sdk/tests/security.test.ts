import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { APIConnectionError, ClientValidationError, SproutsData } from '../src/index';
import { TEST_KEY, envelope, fetchQueue, jsonResponse } from './helpers';

/** The part of {@link TEST_KEY} that must never be printed. */
const SECRET = TEST_KEY.slice('sk_dsp_test_'.length);

function makeClient(fetchImpl: typeof globalThis.fetch, options: Record<string, unknown> = {}) {
  return new SproutsData({
    apiKey: TEST_KEY,
    baseUrl: 'https://dsp.example.test/backend',
    fetch: fetchImpl,
    maxRetries: 0,
    ...options,
  });
}

function sentHeaders(fetchMock: ReturnType<typeof fetchQueue>, call = 0): Record<string, string> {
  return fetchMock.mock.calls[call]![1]!.headers as Record<string, string>;
}

/** Every value sent under `name`, whatever casing each copy used. */
function valuesOf(headers: Record<string, string>, name: string): string[] {
  return Object.entries(headers)
    .filter(([key]) => key.toLowerCase() === name.toLowerCase())
    .map(([, value]) => value);
}

describe('redirects', () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });

  function listen(handler: http.RequestListener, host: string): Promise<number> {
    const server = http.createServer(handler);
    servers.push(server);
    return new Promise((resolve) => {
      server.listen(0, host, () => resolve((server.address() as AddressInfo).port));
    });
  }

  /**
   * The scenario from the SDK review: the API origin answers 307 to a second
   * origin. A fetch that followed it would re-send `X-API-Key` there.
   */
  async function redirectingPair() {
    const received: Array<string | undefined> = [];
    let originRequests = 0;
    const targetPort = await listen((req, res) => {
      received.push(req.headers['x-api-key'] as string | undefined);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ platform: 'dsp' }));
    }, 'localhost');
    const originPort = await listen((_req, res) => {
      originRequests++;
      res.writeHead(307, { location: `http://localhost:${targetPort}/v1/credits` });
      res.end();
    }, '127.0.0.1');
    return { received, originRequests: () => originRequests, originPort };
  }

  it('refuses a 307 to another origin, which never receives the key, and does not retry', async () => {
    const pair = await redirectingPair();
    const client = new SproutsData({
      apiKey: TEST_KEY,
      baseUrl: `http://127.0.0.1:${pair.originPort}`,
      maxRetries: 2,
    });

    const failure = await client.credits.retrieve().catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(APIConnectionError);
    expect((failure as Error).message).toMatch(/redirects are refused/i);
    expect((failure as Error).message).not.toContain(SECRET);
    expect(pair.received).toEqual([]);
    expect(pair.originRequests()).toBe(1);
  });

  it('refuses a redirect on the event stream too', async () => {
    const pair = await redirectingPair();
    const client = new SproutsData({
      apiKey: TEST_KEY,
      baseUrl: `http://127.0.0.1:${pair.originPort}`,
      maxRetries: 0,
    });

    const stream = client.runs.events('run_1');
    await expect(stream.next()).rejects.toThrow(/redirects are refused/i);
    expect(pair.received).toEqual([]);
  });

  it('refuses a 3xx that a custom fetch hands back, naming the target', async () => {
    const client = makeClient(
      fetchQueue(new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/' } })),
    );
    await expect(client.credits.retrieve()).rejects.toThrow(
      /redirected to https:\/\/elsewhere\.test\/\. Redirects are refused/,
    );
  });

  it('asks fetch not to follow redirects', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    await makeClient(fetchMock).search({ query: 'x' });
    expect(fetchMock.mock.calls[0]![1]!.redirect).toBe('error');
  });
});

describe('the API key is never printable', () => {
  it('is absent from util.inspect and JSON.stringify of the client, redacted to its prefix', () => {
    const client = makeClient(fetchQueue(), { defaultHeaders: { 'X-Team': 'growth' } });
    const printed = inspect(client, { depth: Infinity, showHidden: true });
    const json = JSON.stringify(client);

    expect(printed).not.toContain(SECRET);
    expect(json).not.toContain(SECRET);
    expect(printed).toContain('sk_dsp_test_***');
    expect(JSON.parse(json)).toEqual({
      baseUrl: 'https://dsp.example.test/backend',
      apiKey: 'sk_dsp_test_***',
      timeoutMs: 60_000,
      maxRetries: 0,
    });
    expect(String(client)).not.toContain(SECRET);
  });

  it('is absent from every resource namespace', () => {
    const client = makeClient(fetchQueue());
    const resources = [
      client.entities,
      client.relationships,
      client.orgChart,
      client.credits,
      client.history,
      client.runs,
      client.feedback,
      client.feedback.votes,
      client.members,
      client.lists,
    ];
    for (const resource of resources) {
      expect(inspect(resource, { depth: Infinity, showHidden: true })).not.toContain(SECRET);
      expect(JSON.stringify(resource)).not.toContain(SECRET);
      // Nothing but nested namespaces (`feedback.votes`), themselves checked here.
      for (const value of Object.values(resource)) expect(resources).toContain(value);
    }
  });

  it('is absent from connection error messages', async () => {
    const client = makeClient(fetchQueue(new TypeError('fetch failed')));
    const failure = await client.credits.retrieve().catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(APIConnectionError);
    expect(inspect(failure)).not.toContain(SECRET);
  });
});

describe('forbidden headers', () => {
  it('refuses Origin and Referer in defaultHeaders, in any casing', () => {
    for (const name of ['Origin', 'origin', 'REFERER', 'Referer']) {
      expect(() => makeClient(fetchQueue(), { defaultHeaders: { [name]: 'https://app.test' } })).toThrow(
        ClientValidationError,
      );
    }
    expect(() => makeClient(fetchQueue(), { defaultHeaders: { origin: 'x' } })).toThrow(
      /auth\.browser_origin/,
    );
  });

  it('refuses Origin and Referer in per-call headers before any request', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(
      client.search({ query: 'x' }, { headers: { referer: 'https://app.test' } }),
    ).rejects.toThrow(ClientValidationError);
    await expect(client.credits.retrieve({ headers: { ORIGIN: 'https://app.test' } })).rejects.toThrow(
      /'ORIGIN' header/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('protected headers', () => {
  it('X-API-Key and User-Agent cannot be overridden in any casing', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock, {
      defaultHeaders: { 'x-api-key': 'sk_dsp_live_' + 'q'.repeat(22), 'user-agent': 'spoofed/1.0' },
    });
    await client.search(
      { query: 'x' },
      { headers: { 'X-Api-Key': 'sk_dsp_live_' + 'r'.repeat(22), 'X-Team': 'growth' } },
    );
    const headers = sentHeaders(fetchMock);
    expect(valuesOf(headers, 'x-api-key')).toEqual([TEST_KEY]);
    expect(valuesOf(headers, 'user-agent')).toHaveLength(1);
    expect(valuesOf(headers, 'user-agent')[0]).toMatch(/^sproutsdata-js\//);
    expect(headers['X-Team']).toBe('growth');
  });

  it('X-Dsp-Source is always sdk/js, whatever a caller sends', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock, { defaultHeaders: { 'x-dsp-source': 'mcp/claude' } });
    await client.search({ query: 'x' }, { headers: { 'X-DSP-SOURCE': 'api' } });
    expect(valuesOf(sentHeaders(fetchMock), 'x-dsp-source')).toEqual(['sdk/js']);
  });

  it('a caller idempotency-key header cannot ride beside the SDK-set Idempotency-Key', async () => {
    const fetchMock = fetchQueue(jsonResponse({ run_id: 'run_1', status: 'pending', meta: envelope().meta }));
    const client = makeClient(fetchMock);
    await client.runs.create(
      { query: 'x' },
      { idempotencyKey: 'intent-1', headers: { 'idempotency-key': 'shadow' } },
    );
    expect(valuesOf(sentHeaders(fetchMock), 'idempotency-key')).toEqual(['intent-1']);
  });

  it('a per-call header replaces a default of the same name case-insensitively', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const client = makeClient(fetchMock, { defaultHeaders: { 'x-team': 'growth' } });
    await client.search({ query: 'x' }, { headers: { 'X-Team': 'sales' } });
    expect(valuesOf(sentHeaders(fetchMock), 'x-team')).toEqual(['sales']);
  });
});

describe('the caller request id', () => {
  it('is sent as X-Request-Id, and wins over a raw header of any casing', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()), jsonResponse(envelope()));
    const client = makeClient(fetchMock, { defaultHeaders: { 'x-request-id': 'from-defaults' } });
    await client.search({ query: 'x' }, { requestId: 'job-42:page.1_a-b' });
    await client.search({ query: 'x' }, { requestId: 'job-43', headers: { 'X-REQUEST-ID': 'raw-1' } });
    expect(valuesOf(sentHeaders(fetchMock, 0), 'x-request-id')).toEqual(['job-42:page.1_a-b']);
    expect(valuesOf(sentHeaders(fetchMock, 1), 'x-request-id')).toEqual(['job-43']);
  });

  it('is sent on every kind of route, GET included', async () => {
    const fetchMock = fetchQueue(jsonResponse({ balance: 1, meta: envelope().meta }));
    await makeClient(fetchMock).credits.retrieve({ requestId: 'balance-check' });
    expect(valuesOf(sentHeaders(fetchMock), 'x-request-id')).toEqual(['balance-check']);
  });

  it.each([
    ['empty', ''],
    ['a space', 'job 42'],
    ['a newline', 'job\n42'],
    ['129 characters', 'r'.repeat(129)],
    ['a slash', 'job/42'],
  ])('refuses one with %s before any request', async (_label, requestId) => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    const err = await client.search({ query: 'x' }, { requestId }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClientValidationError);
    expect((err as Error).message).toMatch(/^`requestId` must be 1-128 characters/);
    expect((err as Error).message).toMatch(/silently replaces anything else/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts exactly 128 characters', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    await makeClient(fetchMock).search({ query: 'x' }, { requestId: 'r'.repeat(128) });
    expect(valuesOf(sentHeaders(fetchMock), 'x-request-id')).toEqual(['r'.repeat(128)]);
  });

  it('holds a raw X-Request-Id header to the same rule, per call and in defaultHeaders', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(client.search({ query: 'x' }, { headers: { 'x-request-id': 'has space' } })).rejects.toThrow(
      /'x-request-id' header \(in `options.headers`\) must be 1-128 characters/,
    );
    expect(() => makeClient(fetchMock, { defaultHeaders: { 'X-Request-Id': 'a'.repeat(200) } })).toThrow(
      ClientValidationError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

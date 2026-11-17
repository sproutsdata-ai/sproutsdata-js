/** Fakes shared by the suite: a recording `fetch`, a clock, and resolved options. No test touches the network. */

import type { Clock } from '../../src/core/clock.js';
import type { ResolvedOptions } from '../../src/core/options.js';

/** Built at run time, with `_` and `-` in the secret, so no source line looks like a leaked key. */
export const FIXTURE_KEY = 'sk_dsp_live_' + 'fixture_key-with_underscores';
export const BASE_URL = 'https://api.test.invalid/backend';
export const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);

/** A clock that never waits: it records each wait and always says it is `NOW`. */
export class FakeClock implements Clock {
  readonly sleeps: number[] = [];
  #seed = 1;

  now(): number {
    return NOW;
  }

  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    return Promise.resolve();
  }

  random(): number {
    this.#seed = (this.#seed * 16_807) % 2_147_483_647;
    return this.#seed / 2_147_483_647;
  }
}

/** One scripted answer, as a conformance case spells it. */
export interface Scripted {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly raw_body?: string;
  readonly content_type?: string;
  readonly network?: string;
}

/** A request as the fake fetch saw it. */
export interface Sent {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: unknown;
}

/** What undici rejects with when a connection fails: a `TypeError` whose cause carries the code. */
export function networkError(code: string): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
}

/** A request as the fake fetch records it. */
function recorded(input: string | URL | Request, init: RequestInit | undefined): Sent {
  const text = typeof init?.body === 'string' ? init.body : undefined;
  return {
    method: init?.method ?? 'GET',
    url: new URL(input instanceof Request ? input.url : input),
    headers: new Headers(init?.headers),
    body: text === undefined ? undefined : (JSON.parse(text) as unknown),
  };
}

/** A `fetch` that replays `script` in order (the last entry repeats) and records each request. */
export function recordingFetch(script: readonly Scripted[]): { fetch: typeof globalThis.fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent.push(recorded(input, init));
    return answer(script[Math.min(sent.length, script.length) - 1] ?? {}, init?.signal ?? undefined);
  };
  return { fetch, sent };
}

function answer(entry: Scripted, signal: AbortSignal | undefined): Promise<Response> {
  switch (entry.network) {
    case 'connect_refused':
      return Promise.reject(networkError('ECONNREFUSED'));
    case 'dns_failure':
      return Promise.reject(networkError('ENOTFOUND'));
    case 'connect_timeout':
      return Promise.reject(networkError('UND_ERR_CONNECT_TIMEOUT'));
    case 'reset_after_send':
      return Promise.reject(networkError('ECONNRESET'));
    case 'read_timeout':
      // Never answers: the attempt's own timer aborts it, as a real stalled server would.
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    case undefined:
      return Promise.resolve(response(entry));
    default:
      throw new Error(`unknown network outcome ${entry.network}`);
  }
}

function response(entry: Scripted): Response {
  const headers = new Headers(entry.headers);
  const status = entry.status ?? 200;
  if (entry.raw_body !== undefined) {
    headers.set('content-type', entry.content_type ?? 'text/plain');
    return new Response(entry.raw_body, { status, headers });
  }
  if (entry.body === undefined || entry.body === null || status === 204) return new Response(null, { status, headers });
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(entry.body), { status, headers });
}

/** Resolved options for the test base URL and key. */
export function options(changes: Partial<ResolvedOptions> = {}): ResolvedOptions {
  return {
    apiKey: FIXTURE_KEY,
    baseUrl: BASE_URL,
    timeoutMs: 25,
    maxRetries: 2,
    defaultHeaders: {},
    fetch: () => Promise.reject(new Error('no fetch given')),
    ...changes,
  };
}

import { vi } from 'vitest';

import type { Problem, SearchEnvelope } from '../src/types';

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function problemResponse(
  status: number,
  problem: Partial<Problem>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ status, ...problem }), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
}

export function envelope(overrides: Partial<SearchEnvelope> = {}): SearchEnvelope {
  return {
    results: [{ id: 'c_1', category: 'company', score: 0.9, name: 'Acme' }],
    total: 1,
    total_is_estimate: false,
    has_more: false,
    next_cursor: null,
    resolved_search: null,
    suggestion: null,
    coverage: null,
    attribution: [],
    degradation: [],
    columns: null,
    truncated: false,
    meta: {
      request_id: 'req_test',
      environment: 'test',
      as_of: '2026-08-13T00:00:00Z',
      credential: 'api_key',
    },
    ...overrides,
  };
}

/**
 * An SSE response whose body enqueues the given chunks one by one — chunk
 * boundaries are the caller's, so frame-split-across-chunks cases are
 * testable.
 */
export function sseResponse(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** A fetch mock that pops queued responses (or errors) in order. */
export function fetchQueue(...queue: Array<Response | Error | (() => Response | Error)>) {
  return vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      const next = queue.shift();
      if (next === undefined) throw new Error('fetchQueue exhausted: unexpected extra request');
      const resolved = typeof next === 'function' ? next() : next;
      if (resolved instanceof Error) throw resolved;
      return resolved;
    },
  );
}

/**
 * What undici rejects with when the connection fails: a `TypeError` whose
 * cause carries the system error code (`ECONNREFUSED`, `ECONNRESET`, …).
 */
export function networkError(code: string): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
}

/**
 * Built at run time so no key-shaped string sits in the repository (secret
 * scanners match the whole pattern, and a copy-pasted fixture should never
 * look like a real credential).
 */
export const TEST_KEY = 'sk_dsp_test_' + 'x'.repeat(22);

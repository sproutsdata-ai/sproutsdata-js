import { readFileSync } from 'node:fs';

import { SproutsData } from 'sproutsdata';
import type { JsonSchema, ToolName } from 'sproutsdata/tools';
import { vi } from 'vitest';

/** Built at run time, so no key-shaped string sits in the repository. */
export const TEST_KEY = 'sk_dsp_test_' + 'x'.repeat(22);
export const BASE_URL = 'https://dsp.example.test/backend';

/** A tool's file in the vendored `spec/tools/`. */
export function specTool(name: ToolName): { description: string; input_schema: JsonSchema } {
  const url = new URL(`../../../spec/tools/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as { description: string; input_schema: JsonSchema };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function problemResponse(status: number, problem: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ type: 'about:blank', status, title: 'Refused', ...problem }), {
    status,
    headers: { 'content-type': 'application/problem+json', 'x-request-id': 'req_1' },
  });
}

/** The body the backend answered `operation` with (`spec/fixtures/responses/`), to change in a test. */
export function recordedBody(operation: string, which: string): Record<string, unknown> {
  const url = new URL(`../../../spec/fixtures/responses/${operation}/${which}.json`, import.meta.url);
  return (JSON.parse(readFileSync(url, 'utf8')) as { body: Record<string, unknown> }).body;
}

/** A search answer: the recorded company page with one company row, unless `overrides` says otherwise. */
export function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const recorded = recordedBody('search', 'company');
  return {
    ...recorded,
    meta: { ...(recorded['meta'] as object), request_id: 'req_test', environment: 'test' },
    results: [{ id: 'acme.com', category: 'company', score: 0.9, account_name: 'Acme', domain: 'acme.com' }],
    total: 1,
    total_is_estimate: false,
    has_more: false,
    next_cursor: null,
    ...overrides,
  };
}

/** A fetch mock that answers with the queued responses, in order. */
export function fetchQueue(...queue: Response[]) {
  return vi.fn(async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const next = queue.shift();
    if (next === undefined) throw new Error('fetchQueue exhausted: unexpected extra request');
    return next;
  });
}

export function client(fetchImpl: typeof globalThis.fetch): SproutsData {
  return new SproutsData({ apiKey: TEST_KEY, baseUrl: BASE_URL, fetch: fetchImpl, maxRetries: 0 });
}

export function sentBody(fetchMock: ReturnType<typeof fetchQueue>, index = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[index]![1]!.body)) as Record<string, unknown>;
}

export function sentHeaders(fetchMock: ReturnType<typeof fetchQueue>, index = 0): Record<string, string> {
  return fetchMock.mock.calls[index]![1]!.headers as Record<string, string>;
}

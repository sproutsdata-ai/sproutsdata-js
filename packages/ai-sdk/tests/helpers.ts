import { readFileSync } from 'node:fs';

import { MockLanguageModelV4 } from 'ai/test';
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
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_1', ...headers },
  });
}

export function problemResponse(status: number, problem: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ status, title: 'Refused', ...problem }), {
    status,
    headers: { 'content-type': 'application/problem+json', 'x-request-id': 'req_1' },
  });
}

/** A search answer with one company row. */
export function searchBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    results: [{ id: 'acme.com', category: 'company', score: 0.9, account_name: 'Acme', domain: 'acme.com' }],
    total: 1,
    total_is_estimate: false,
    has_more: false,
    next_cursor: null,
    resolved_search: { filters: {}, filters_source: 'none', conflicts: [] },
    suggestion: null,
    coverage: null,
    attribution: [],
    degradation: [],
    columns: null,
    meta: { request_id: 'req_1', environment: 'test', as_of: '2026-09-01T00:00:00Z', credential: 'api_key' },
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

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/**
 * The `ai` package's own mock model: the first turn calls `toolName` with
 * `input` (the raw JSON text a provider would send), the second answers.
 */
export function mockModel(toolName: string, input: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: [
      {
        content: [{ type: 'tool-call', toolCallId: 'call_1', toolName, input }],
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: 'text', text: 'done' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });
}

/** What the model was sent back for its tool call, on its second turn. */
export function toolOutputSeen(model: MockLanguageModelV4): unknown {
  const message = model.doGenerateCalls[1]?.prompt.at(-1);
  if (message?.role !== 'tool') throw new Error('the model was not sent a tool result');
  const part = message.content[0];
  if (part?.type !== 'tool-result') throw new Error('the tool message holds no tool result');
  return part.output;
}

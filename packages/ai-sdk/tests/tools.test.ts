/**
 * `@sproutsdata.ai/ai-sdk` against the real `ai` package: the tool
 * definitions are the spec's, and every call goes through `generateText`
 * driven by the `ai` package's own mock model, so what is tested is what an
 * application runs.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inspect } from 'node:util';

import { asSchema, generateText, stepCountIs } from 'ai';
import { AuthenticationError, ClientValidationError, InsufficientCreditsError, PermissionDeniedError } from 'sproutsdata';
import { TOOL_NAMES, definitions, type ToolName } from 'sproutsdata/tools';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VERSION, raiseSproutsDataErrors, sproutsDataTools, type SproutsDataTool } from '../src/index';
import {
  BASE_URL,
  TEST_KEY,
  client,
  fetchQueue,
  jsonResponse,
  mockModel,
  problemResponse,
  searchBody,
  sentBody,
  sentHeaders,
  specTool,
  toolOutputSeen,
} from './helpers';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function schemaOf(tool: SproutsDataTool | undefined): Promise<unknown> {
  return asSchema(tool!.inputSchema).jsonSchema;
}

function run(tools: Record<string, SproutsDataTool>, toolName: string, args: unknown, raise = true) {
  const model = mockModel(toolName, typeof args === 'string' ? args : JSON.stringify(args));
  const stopWhen = raise ? [stepCountIs(3), raiseSproutsDataErrors] : stepCountIs(3);
  return { model, result: generateText({ model, prompt: 'Find companies.', tools, stopWhen }) };
}

describe('the tool definitions', () => {
  it('are keyed by the spec names, with the spec input schemas (one contract per name)', async () => {
    const tools = sproutsDataTools({ client: client(fetchQueue()) });
    expect(Object.keys(tools)).toEqual(TOOL_NAMES);
    for (const name of TOOL_NAMES) {
      expect(await schemaOf(tools[name])).toEqual(specTool(name).input_schema);
    }
  });

  it('carry the toolset descriptions, naming only tools in the set', () => {
    const all = sproutsDataTools({ client: client(fetchQueue()) });
    const some = sproutsDataTools({ client: client(fetchQueue()), include: ['search'] });
    for (const definition of definitions()) expect(all[definition.name]!.description).toBe(definition.description);
    expect(Object.keys(some)).toEqual(['sprouts_search']);
    expect(some.sprouts_search!.description).toBe(definitions({ include: ['search'] })[0]!.description);
    expect(some.sprouts_search!.description).not.toContain('sprouts_entity_lookup');
  });

  it('hide a fixed argument from the model', async () => {
    const tools = sproutsDataTools({
      client: client(fetchQueue()),
      fixed: { sprouts_search: { category: 'person' } },
    });
    const schema = (await schemaOf(tools.sprouts_search)) as { properties: Record<string, unknown> };
    expect(schema.properties).not.toHaveProperty('category');
  });

  it('offer no deep mode and no updated_after, and refuse them as settings', async () => {
    const tools = sproutsDataTools({ client: client(fetchQueue()) });
    const schema = (await schemaOf(tools.sprouts_search)) as {
      properties: Record<string, { enum?: unknown[] }>;
    };
    expect(schema.properties.mode!.enum).toEqual(['fast', 'auto']);
    expect(schema.properties).not.toHaveProperty('updated_after');
    expect(() =>
      sproutsDataTools({ client: client(fetchQueue()), fixed: { sprouts_search: { mode: 'deep' } } }),
    ).toThrow(ClientValidationError);
  });

  it.each([0, 26, 2.5])('refuse maxResults %s: it runs from 1 to 25', (maxResults) => {
    expect(() => sproutsDataTools({ client: client(fetchQueue()), maxResults })).toThrow(/from 1 to 25/);
  });
});

describe('generateText with the ai mock model', () => {
  it('runs a call through the toolset and hands the model its result', async () => {
    const fetchMock = fetchQueue(jsonResponse(searchBody()));
    const tools = sproutsDataTools({ client: client(fetchMock) });
    const { model, result } = run(tools, 'sprouts_search', { query: 'payments companies in Germany' });
    const answer = await result;

    expect(answer.text).toBe('done');
    expect(sentBody(fetchMock)).toEqual({
      category: 'company',
      query: 'payments companies in Germany',
      mode: 'fast',
      limit: 10,
    });
    const output = answer.toolResults[0]!.output as Record<string, unknown>;
    expect(output).toMatchObject({ total: 1, request_id: 'req_1', environment: 'test' });
    expect(output.interpreted_as).toEqual({ filters: {}, source: 'none', conflicts: [] });
    expect(toolOutputSeen(model)).toEqual({ type: 'json', value: output });
  });

  it('names this package in X-SproutsData-Client, without changing the caller’s client', async () => {
    const fetchMock = fetchQueue(jsonResponse(searchBody()));
    const mine = client(fetchMock);
    await run(sproutsDataTools({ client: mine }), 'sprouts_search', { query: 'x' }).result;
    expect(sentHeaders(fetchMock)['X-SproutsData-Client']).toBe(`ai-sdk/${VERSION}`);
    expect(mine.integration).toBeUndefined();
  });

  it('returns invalid arguments to the model as data, every problem named, and sends nothing', async () => {
    const fetchMock = fetchQueue();
    const { model, result } = run(sproutsDataTools({ client: client(fetchMock) }), 'sprouts_search', {
      query: 'x',
      country: 'DE',
      limit: 500,
    });
    expect((await result).text).toBe('done');
    expect(fetchMock).not.toHaveBeenCalled();
    const seen = toolOutputSeen(model) as { value: { error: { code: string; field_errors: string[] } } };
    expect(seen.value.error.code).toBe('invalid_arguments');
    expect(seen.value.error.field_errors).toEqual([
      expect.stringMatching(/^country: /),
      expect.stringMatching(/^limit: /),
    ]);
  });

  it('coerces a representation as the MCP server does', async () => {
    const fetchMock = fetchQueue(jsonResponse(searchBody()));
    await run(sproutsDataTools({ client: client(fetchMock) }), 'sprouts_search', { query: 'x', limit: '5' })
      .result;
    expect(sentBody(fetchMock).limit).toBe(5);
  });

  it('returns a 422 as data the model can act on', async () => {
    const fetchMock = fetchQueue(
      problemResponse(422, {
        code: 'request.invalid',
        detail: 'Unknown industry.',
        extra: { errors: [{ loc: ['body', 'filters', 'industry'], msg: 'unknown value' }] },
      }),
    );
    const { model, result } = run(sproutsDataTools({ client: client(fetchMock) }), 'sprouts_search', {
      query: 'x',
    });
    await result;
    expect(toolOutputSeen(model)).toEqual({
      type: 'json',
      value: {
        error: {
          code: 'request.invalid',
          message: 'Unknown industry.',
          retryable: false,
          retry_after: null,
          field_errors: ['filters.industry: unknown value'],
          request_id: 'req_1',
        },
      },
    });
  });

  it('does not offer a billed call that timed out after sending for retry', async () => {
    const hang = (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const tools = sproutsDataTools({ apiKey: TEST_KEY, baseUrl: BASE_URL, timeoutMs: 5, maxRetries: 0 });
    vi.stubGlobal('fetch', hang);
    const { model, result } = run(tools, 'sprouts_search', { query: 'x' });
    await result;
    const seen = toolOutputSeen(model) as { value: { error: { code: string; retryable: boolean; message: string } } };
    expect(seen.value.error).toMatchObject({ code: 'timeout', retryable: false });
    expect(seen.value.error.message).not.toMatch(/may succeed/);
  });

  it.each([
    [401, 'auth.invalid_key', AuthenticationError],
    [403, 'auth.insufficient_scope', PermissionDeniedError],
    [402, 'credits.insufficient', InsufficientCreditsError],
  ] as const)('rejects the call on a %i with raiseSproutsDataErrors, before the model sees it', async (status, code, ErrorClass) => {
    const fetchMock = fetchQueue(problemResponse(status, { code }));
    const { model, result } = run(sproutsDataTools({ client: client(fetchMock) }), 'sprouts_search', {
      query: 'x',
    });
    await expect(result).rejects.toBeInstanceOf(ErrorClass);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('without raiseSproutsDataErrors, leaves a 401 where the AI SDK puts a thrown error', async () => {
    const fetchMock = fetchQueue(problemResponse(401, { code: 'auth.invalid_key' }));
    const { result } = run(sproutsDataTools({ client: client(fetchMock) }), 'sprouts_search', { query: 'x' }, false);
    const errors = (await result).steps[0]!.content.filter((part) => part.type === 'tool-error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { error: unknown }).error).toBeInstanceOf(AuthenticationError);
  });
});

describe('a client from a second copy of sproutsdata', () => {
  // The application loads the SDK through CommonJS; this package, under
  // vitest, loads it as an ES module. Two copies, two sets of classes.
  const cjs = createRequire(import.meta.url)('sproutsdata') as typeof import('sproutsdata');

  function foreignClient(fetchImpl: typeof globalThis.fetch) {
    return new cjs.SproutsData({ apiKey: TEST_KEY, baseUrl: BASE_URL, fetch: fetchImpl, maxRetries: 0 });
  }

  it('is a different copy', () => {
    expect(cjs.SproutsData).not.toBe(client(fetchQueue()).constructor);
  });

  it('still returns a 422 to the model as data', async () => {
    const fetchMock = fetchQueue(problemResponse(422, { code: 'request.invalid', detail: 'bad' }));
    const { model, result } = run(sproutsDataTools({ client: foreignClient(fetchMock) }), 'sprouts_search', {
      query: 'x',
    });
    await result;
    expect(toolOutputSeen(model)).toMatchObject({ value: { error: { code: 'request.invalid' } } });
  });

  it('still raises a 401 to the application', async () => {
    const fetchMock = fetchQueue(problemResponse(401, { code: 'auth.invalid_key' }));
    const { result } = run(sproutsDataTools({ client: foreignClient(fetchMock) }), 'sprouts_search', {
      query: 'x',
    });
    await expect(result).rejects.toBeInstanceOf(cjs.AuthenticationError);
  });
});

describe('construction', () => {
  it('throws on a missing key where the tools are made, not in the run', () => {
    vi.stubEnv('SPROUTSDATA_API_KEY', '');
    vi.stubEnv('DSP_API_KEY', '');
    expect(() => sproutsDataTools()).toThrow(ClientValidationError);
  });

  it('refuses a browser-like environment', () => {
    vi.stubGlobal('window', { document: {} });
    expect(() => sproutsDataTools({ apiKey: TEST_KEY })).toThrow(/auth\.browser_origin/);
  });

  it('never exposes the API key', () => {
    const tools = sproutsDataTools({ apiKey: TEST_KEY, baseUrl: BASE_URL });
    expect(JSON.stringify(tools)).not.toContain(TEST_KEY);
    expect(inspect(tools, { depth: 10, showHidden: true })).not.toContain(TEST_KEY);
    for (const name of TOOL_NAMES) expect(String(tools[name as ToolName]?.execute)).not.toContain(TEST_KEY);
  });

  it('reports the version package.json declares', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(manifest.version);
  });
});

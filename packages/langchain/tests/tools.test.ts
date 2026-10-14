/**
 * The tools against real `@langchain/core`: their definitions are the
 * spec's, and every call goes through LangChain's own `invoke` — with raw
 * arguments, and with the `ToolCall` a chat model emits — so what is tested
 * is what an agent runs.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inspect } from 'node:util';

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { ToolCall } from '@langchain/core/messages/tool';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import {
  AuthenticationError,
  ClientValidationError,
  InsufficientCreditsError,
  PermissionDeniedError,
} from 'sproutsdata';
import { TOOL_NAMES, Toolset, definitions } from 'sproutsdata/tools';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  SproutsDataEntityLookup,
  SproutsDataSearchResults,
  VERSION,
  sproutsDataTools,
  type SproutsDataTool,
} from '../src/index';
import {
  BASE_URL,
  TEST_KEY,
  client,
  envelope,
  fetchQueue,
  jsonResponse,
  problemResponse,
  sentBody,
  sentHeaders,
  specTool,
} from './helpers';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function search(fetchMock: ReturnType<typeof fetchQueue>): SproutsDataTool {
  return sproutsDataTools({ client: client(fetchMock), include: ['search'] })[0]!;
}

function toolCall(args: Record<string, unknown>, name = 'sprouts_search'): ToolCall {
  return { type: 'tool_call', id: 'call_1', name, args };
}

function errorIn(content: unknown): { code: string; field_errors: string[]; request_id: string | null } {
  return (JSON.parse(String(content)) as { error: { code: string; field_errors: string[]; request_id: string | null } })
    .error;
}

describe('the tool definitions', () => {
  it('are the spec tools, in order, with the spec input schemas (one contract per name)', () => {
    const tools = sproutsDataTools({ client: client(fetchQueue()) });
    expectTypeOf(tools).toMatchTypeOf<StructuredToolInterface[]>();
    expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    for (const tool of tools) {
      const name = tool.name as (typeof TOOL_NAMES)[number];
      expect(tool.schema).toEqual(specTool(name).input_schema);
      // What a model is shown, through LangChain's own conversion.
      expect(convertToOpenAITool(tool).function.parameters).toEqual(specTool(name).input_schema);
    }
  });

  it('carry the toolset descriptions, naming only tools in the set', () => {
    const all = sproutsDataTools({ client: client(fetchQueue()) });
    expect(all.map((tool) => tool.description)).toEqual(definitions().map((entry) => entry.description));
    const [only] = sproutsDataTools({ client: client(fetchQueue()), include: ['search'] });
    expect(only!.description).toBe(definitions({ include: ['search'] })[0]!.description);
    expect(only!.description).not.toContain('sprouts_entity_lookup');
  });

  it('hide a fixed argument from the model', () => {
    const [tool] = sproutsDataTools({
      client: client(fetchQueue()),
      include: ['search'],
      fixed: { sprouts_search: { category: 'person' } },
    });
    expect((tool!.schema as { properties: Record<string, unknown> }).properties).not.toHaveProperty('category');
  });

  it('refuse invalid settings where they are made', () => {
    const connection = { client: client(fetchQueue()) };
    expect(() => sproutsDataTools({ ...connection, maxResults: 26 })).toThrow(/from 1 to 25/);
    expect(() => sproutsDataTools({ ...connection, fixed: { sprouts_search: { mode: 'deep' } } })).toThrow(
      ClientValidationError,
    );
  });

  it('build one class per tool over a toolset that offers it', () => {
    const toolset = new Toolset(client(fetchQueue()), { include: ['search'] });
    expect(new SproutsDataSearchResults({ toolset }).name).toBe('sprouts_search');
    expect(() => new SproutsDataEntityLookup({ toolset })).toThrow(/does not offer sprouts_entity_lookup/);
  });
});

describe('invoke', () => {
  it('runs raw arguments through the toolset to its canonical JSON', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope(), 200, { 'x-request-id': 'req_1' }));
    const content = await search(fetchMock).invoke({ query: 'payments companies in Germany' });
    expect(typeof content).toBe('string');
    expect(JSON.parse(content)).toMatchObject({ total: 1, request_id: 'req_1', environment: 'test' });
    expect(sentBody(fetchMock)).toEqual({
      category: 'company',
      query: 'payments companies in Germany',
      mode: 'fast',
      limit: 10,
    });
  });

  it('answers a ToolCall with a ToolMessage carrying the call id', async () => {
    const message = await search(fetchQueue(jsonResponse(envelope()))).invoke(toolCall({ query: 'x' }));
    expect(message).toBeInstanceOf(ToolMessage);
    expect(message.tool_call_id).toBe('call_1');
    expect(JSON.parse(String(message.content))).toMatchObject({ total: 1 });
  });

  it('names this package in X-SproutsData-Client, without changing the caller’s client', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const mine = client(fetchMock);
    await sproutsDataTools({ client: mine, include: ['search'] })[0]!.invoke({ query: 'x' });
    expect(sentHeaders(fetchMock)['X-SproutsData-Client']).toBe(`langchain/${VERSION}`);
    expect(mine.integration).toBeUndefined();
  });

  it.each([
    [{ query: 'x', country: 'DE' }, /^country: /],
    [{ query: 42 }, /^query: /],
    [{ query: 'x', limit: 500 }, /^limit: /],
  ])('returns invalid arguments to the model as data, never an exception (%#)', async (args, problem) => {
    const fetchMock = fetchQueue();
    const message = await search(fetchMock).invoke(toolCall(args));
    expect(message).toBeInstanceOf(ToolMessage);
    expect(message.tool_call_id).toBe('call_1');
    const error = errorIn(message.content);
    expect(error.code).toBe('invalid_arguments');
    expect(error.field_errors).toEqual([expect.stringMatching(problem)]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a broken tool rule as data, with raw arguments too', async () => {
    const content = await search(fetchQueue()).invoke({ query: 'x', category: 'auto' });
    expect(errorIn(content).code).toBe('invalid_arguments');
  });

  it('coerces a representation LangChain would refuse, as the MCP server does', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const message = await search(fetchMock).invoke(toolCall({ query: 'x', limit: '5' }));
    expect(JSON.parse(String(message.content))).toMatchObject({ total: 1 });
    expect(sentBody(fetchMock).limit).toBe(5);
  });

  it('returns a 422 as data the model can act on', async () => {
    const fetchMock = fetchQueue(problemResponse(422, { code: 'request.invalid', detail: 'Unknown industry.' }));
    const error = errorIn(await search(fetchMock).invoke({ query: 'x' }));
    expect(error).toMatchObject({ code: 'request.invalid', request_id: 'req_1' });
  });

  it.each([
    [401, 'auth.invalid_key', AuthenticationError],
    [403, 'auth.insufficient_scope', PermissionDeniedError],
    [402, 'credits.insufficient', InsufficientCreditsError],
  ] as const)('throws a %i: only the application can fix it', async (status, code, ErrorClass) => {
    const tool = search(fetchQueue(problemResponse(status, { code })));
    await expect(tool.invoke(toolCall({ query: 'x' }))).rejects.toBeInstanceOf(ErrorClass);
  });
});

/** A chat model that replies with the given messages, in order, recording what it was sent. */
class ScriptedChatModel extends BaseChatModel {
  readonly seen: BaseMessage[][] = [];
  readonly #replies: AIMessage[];

  constructor(replies: AIMessage[]) {
    super({});
    this.#replies = replies;
  }

  _llmType(): string {
    return 'scripted';
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.seen.push(messages);
    const message = this.#replies.shift();
    if (message === undefined) throw new Error('the script has no more replies');
    return { generations: [{ text: '', message }] };
  }
}

describe('an agent loop with a fake chat model', () => {
  it('calls sprouts_search with bad arguments and gets an error message back, then a good call runs', async () => {
    const fetchMock = fetchQueue(jsonResponse(envelope()));
    const tools = sproutsDataTools({ client: client(fetchMock) });
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const model = new ScriptedChatModel([
      new AIMessage({ content: '', tool_calls: [{ ...toolCall({ query: 'x', country: 'DE' }), id: 'call_1' }] }),
      new AIMessage({ content: '', tool_calls: [{ ...toolCall({ query: 'x' }), id: 'call_2' }] }),
      new AIMessage({ content: 'done' }),
    ]);

    const messages: BaseMessage[] = [new HumanMessage('Find fintech companies.')];
    for (;;) {
      const reply = await model.invoke(messages);
      messages.push(reply);
      if (!reply.tool_calls?.length) break;
      for (const call of reply.tool_calls) messages.push(await byName.get(call.name)!.invoke(call));
    }

    const answers = messages.filter((message): message is ToolMessage => message instanceof ToolMessage);
    expect(answers.map((message) => message.tool_call_id)).toEqual(['call_1', 'call_2']);
    expect(errorIn(answers[0]!.content).code).toBe('invalid_arguments');
    expect(JSON.parse(String(answers[1]!.content))).toMatchObject({ total: 1 });
    expect(model.seen).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('a client from a second copy of sproutsdata', () => {
  // The application loads the SDK through CommonJS; this package, under
  // vitest, loads it as an ES module. Two copies, two sets of classes.
  const cjs = createRequire(import.meta.url)('sproutsdata') as typeof import('sproutsdata');

  function foreignTool(fetchMock: ReturnType<typeof fetchQueue>): SproutsDataTool {
    const foreign = new cjs.SproutsData({ apiKey: TEST_KEY, baseUrl: BASE_URL, fetch: fetchMock, maxRetries: 0 });
    return sproutsDataTools({ client: foreign, include: ['search'] })[0]!;
  }

  it('still returns a 422 to the model as data', async () => {
    const tool = foreignTool(fetchQueue(problemResponse(422, { code: 'request.invalid', detail: 'bad' })));
    expect(errorIn(await tool.invoke({ query: 'x' })).code).toBe('request.invalid');
  });

  it('still raises a 401 to the application', async () => {
    const tool = foreignTool(fetchQueue(problemResponse(401, { code: 'auth.invalid_key' })));
    await expect(tool.invoke({ query: 'x' })).rejects.toBeInstanceOf(cjs.AuthenticationError);
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
    expect(JSON.stringify(tools.map((tool) => tool.toJSON()))).not.toContain(TEST_KEY);
    expect(inspect(tools, { depth: 10, showHidden: true })).not.toContain(TEST_KEY);
  });

  it('reports the version package.json declares', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(manifest.version);
  });
});

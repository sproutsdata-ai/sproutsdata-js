/**
 * `sproutsdata/tools`: the shared tool specs, the parity fixtures, and the
 * toolset.
 *
 * The fixtures in `spec/tools/fixtures/` are the cross-language contract:
 * the Python SDK's `sproutsdata.tools` runs the same files, and both must
 * produce the same bytes. Everything else here pins behaviour a fixture
 * cannot show on its own — what is thrown rather than returned, how
 * developer settings merge, what each provider helper emits, and the
 * attribution header.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  AuthenticationError,
  ClientValidationError,
  InsufficientCreditsError,
  PermissionDeniedError,
  SproutsData,
  VERSION,
} from '../src/index';
import {
  DEFAULT_INTEGRATION,
  TOOL_NAMES,
  Toolset,
  anthropic,
  definitions,
  openai,
  toJson,
  type JsonSchema,
  type OpenAIChatTool,
  type OpenAIResponsesTool,
  type SearchToolResult,
  type ToolError,
  type ToolResult,
  type ToolsetOptions,
} from '../src/tools/index';
import { TEST_KEY, envelope, fetchQueue, jsonResponse, networkError, problemResponse } from './helpers';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TOOLS_SPEC = join(ROOT, 'spec', 'tools');
const FIXTURE_FILES = readdirSync(join(TOOLS_SPEC, 'fixtures'))
  .filter((name) => name.endsWith('.json'))
  .sort();
const BASE_URL = 'https://dsp.example.test/backend';

/** The live ladder (`dsp-backend/app/schemas/org_chart.py` `SENIORITY_ORDER`). */
const SENIORITIES = ['C-Suite', 'VP', 'Director / Head', 'Manager', 'IC', 'Entry', 'In Training'];

/** The keywords OpenAI strict mode accepts in a schema. */
const STRICT_KEYWORDS = new Set([
  'type',
  'description',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
]);

interface ToolFile {
  name: string;
  description: string;
  description_hints: Record<string, string>;
  input_schema: JsonSchema;
  strict_input_schema: JsonSchema;
}

interface Fixture {
  description: string;
  tool: string;
  options: Record<string, unknown>;
  arguments: Record<string, unknown>;
  response: { status: number; headers: Record<string, string>; body: unknown } | null;
  expected_request: { method: string; path: string; body: unknown } | null;
  expected_output: Record<string, unknown>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function toolFile(name: string): ToolFile {
  return readJson<ToolFile>(join(TOOLS_SPEC, `${name}.json`));
}

/** A fixture's options, from Python spelling to this SDK's. */
function fixtureOptions(options: Record<string, unknown>): ToolsetOptions {
  const names: Record<string, keyof ToolsetOptions> = {
    include: 'include',
    fixed: 'fixed',
    defaults: 'defaults',
    max_results: 'maxResults',
    baseline_filters: 'baselineFilters',
    integration: 'integration',
  };
  return Object.fromEntries(
    Object.entries(options).map(([key, value]) => {
      const mapped = names[key];
      if (mapped === undefined) throw new Error(`fixture option '${key}' has no JS spelling`);
      return [mapped, value];
    }),
  );
}

function client(fetchImpl: typeof globalThis.fetch, options: { integration?: string } = {}): SproutsData {
  return new SproutsData({ apiKey: TEST_KEY, baseUrl: BASE_URL, fetch: fetchImpl, maxRetries: 0, ...options });
}

function toolset(responses: Array<Response | Error>, options: ToolsetOptions = {}) {
  const fetchMock = fetchQueue(...responses);
  return { tools: new Toolset(client(fetchMock), options), fetchMock };
}

function sentBody(fetchMock: ReturnType<typeof fetchQueue>, index = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[index]![1]!.body)) as Record<string, unknown>;
}

function sentHeaders(fetchMock: ReturnType<typeof fetchQueue>, index = 0): Record<string, string> {
  return fetchMock.mock.calls[index]![1]!.headers as Record<string, string>;
}

function errorOf(result: ToolResult): ToolError['error'] {
  expect(result).toHaveProperty('error');
  return (result as ToolError).error;
}

function company(fields: Record<string, unknown> = {}) {
  return { id: 'acme.com', category: 'company' as const, score: 0.9, domain: 'acme.com', ...fields };
}

const searchOk = () => jsonResponse(envelope({ results: [company({ account_name: 'Acme' })] }));

// -- the parity fixtures ----------------------------------------------------------

describe('spec/tools/fixtures (byte-identical with the Python SDK)', () => {
  it.each(FIXTURE_FILES)('%s', async (file) => {
    const fixture = readJson<Fixture>(join(TOOLS_SPEC, 'fixtures', file));
    const fetchMock = fetchQueue(
      ...(fixture.response === null
        ? []
        : [
            new Response(JSON.stringify(fixture.response.body), {
              status: fixture.response.status,
              headers: { 'content-type': 'application/json', ...fixture.response.headers },
            }),
          ]),
    );
    const tools = new Toolset(client(fetchMock), fixtureOptions(fixture.options));

    const result = await tools.run(fixture.tool, fixture.arguments);

    expect(toJson(result)).toBe(toJson(fixture.expected_output));
    const expected = fixture.expected_request;
    if (expected === null) {
      expect(fetchMock).not.toHaveBeenCalled();
      return;
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(init!.method).toBe(expected.method);
    expect(new URL(String(url)).pathname).toBe(`/backend${expected.path}`);
    expect(sentBody(fetchMock)).toEqual(expected.body);
  });

  it('cover every tool and both kinds of error', () => {
    const fixtures = FIXTURE_FILES.map((file) => readJson<Fixture>(join(TOOLS_SPEC, 'fixtures', file)));
    for (const name of TOOL_NAMES) expect(fixtures.map((f) => f.tool)).toContain(name);
    const codes = fixtures.flatMap((f) =>
      'error' in f.expected_output ? [(f.expected_output as unknown as ToolError).error.code] : [],
    );
    expect(codes).toEqual(expect.arrayContaining(['invalid_arguments', 'unknown_tool', 'request.invalid']));
  });
});

// -- canonical JSON ---------------------------------------------------------------

describe('toJson', () => {
  it('is compact, sorted, and writes numbers and non-ASCII as JavaScript does', () => {
    expect(toJson({ b: 1.0, a: [2.5, 'é…'], c: null })).toBe('{"a":[2.5,"é…"],"b":1,"c":null}');
    expect(toJson({ big: 14300000000, neg: -0, nested: { z: true, y: false } })).toBe(
      '{"big":14300000000,"neg":0,"nested":{"y":false,"z":true}}',
    );
  });

  // Each expected string is ECMAScript's Number::toString (ECMA-262
  // §6.1.6.1.20), the same table the Python SDK's `to_json` is pinned to.
  it.each([
    [0, '0'],
    [-0, '0'],
    [7, '7'],
    [-7, '-7'],
    [1.5, '1.5'],
    [-1.5, '-1.5'],
    [100.0, '100'],
    [5000000.0, '5000000'],
    [0.1, '0.1'],
    [0.1 + 0.2, '0.30000000000000004'],
    [4.35, '4.35'],
    [12345.678, '12345.678'],
    [0.001, '0.001'],
    [0.00001, '0.00001'],
    [0.000001, '0.000001'],
    [0.000001234, '0.000001234'],
    [9.99e-7, '9.99e-7'],
    [5e-7, '5e-7'],
    [1e-7, '1e-7'],
    [-1.5e-10, '-1.5e-10'],
    [5e-324, '5e-324'],
    [1e16, '10000000000000000'],
    [2 ** 53, '9007199254740992'],
    [123e18, '123000000000000000000'],
    [1e20, '100000000000000000000'],
    [123456789012345680000, '123456789012345680000'],
    [1e21, '1e+21'],
    [123e20, '1.23e+22'],
    [1.5e300, '1.5e+300'],
    [1.7976931348623157e308, '1.7976931348623157e+308'],
  ])('writes %d as %s', (value, written) => {
    expect(toJson(value)).toBe(written);
    expect(toJson([value])).toBe(`[${written}]`);
  });

  it('sorts keys by code point, as Python does, not by UTF-16 unit or integer-likeness', () => {
    expect(toJson({ '\u{1F600}': 1, '～': 2 })).toBe('{"～":2,"\u{1F600}":1}');
    expect(toJson({ '9': 1, '10': 2, a: 3 })).toBe('{"10":2,"9":1,"a":3}');
  });

  it('escapes control characters the way Python json.dumps does', () => {
    expect(toJson('a"b\\c\n\t\u0001\u007f')).toBe('"a\\"b\\\\c\\n\\t\\u0001\u007f"');
  });

  it('refuses what JSON cannot hold, and leaves out undefined members', () => {
    expect(() => toJson({ x: Number.NaN })).toThrow(RangeError);
    expect(() => toJson({ x: new Date(0) })).toThrow(TypeError);
    expect(() => toJson([undefined])).toThrow(TypeError);
    expect(toJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

// -- the spec files ---------------------------------------------------------------

function* walk(schema: JsonSchema, path = ''): Generator<[string, JsonSchema]> {
  yield [path, schema];
  for (const [name, child] of Object.entries(schema.properties ?? {})) yield* walk(child, `${path}.${name}`);
  if (schema.items !== undefined) yield* walk(schema.items, `${path}[]`);
}

describe('definitions', () => {
  it('are the spec files, with every hint when all three tools are offered', () => {
    const defs = definitions();
    expect(defs.map((d) => d.name)).toEqual([...TOOL_NAMES]);
    for (const def of defs) {
      const spec = toolFile(def.name);
      expect(def.input_schema).toEqual(spec.input_schema);
      expect(def.description).toBe([spec.description, ...Object.values(spec.description_hints)].join('\n\n'));
    }
  });

  it('describe the lookup without a hint when the lookup tool is not offered', () => {
    const [search] = definitions({ include: ['search'] });
    expect(search!.description).toBe(toolFile('sprouts_search').description);
    expect(search!.description).not.toContain('sprouts_entity_lookup');
  });

  it.each([['search'], ['similar'], ['lookup'], ['search', 'similar'], ['similar', 'lookup']])(
    'name only tools in the set: %s',
    (...include) => {
      const defs = definitions({ include });
      const offered = new Set<string>(defs.map((d) => d.name));
      const text = JSON.stringify(defs);
      for (const name of TOOL_NAMES.filter((n) => !offered.has(n))) expect(text).not.toContain(name);
    },
  );

  it('list the live vocabulary and never tell the model to pass a search id', () => {
    const search = toolFile('sprouts_search');
    expect(search.description).toContain(SENIORITIES.map((level) => `\`${level}\``).join(', '));
    const text = JSON.stringify(definitions());
    for (const retired of ["'director'", 'c_suite', '`Software`']) expect(text).not.toContain(retired);
    expect(text).toContain("Never pass a row's `id`");
  });

  it('select the same tools by short and full name, in spec order', () => {
    expect(definitions({ include: ['search', 'sprouts_entity_lookup'] })).toEqual(
      definitions({ include: ['sprouts_entity_lookup', 'sprouts_search'] }),
    );
  });

  it('are fresh copies a caller may change', () => {
    const [first] = definitions();
    first!.input_schema.properties = {};
    expect(Object.keys(definitions()[0]!.input_schema.properties!)).toContain('query');
  });
});

describe.each(TOOL_NAMES)('the strict schema of %s', (name) => {
  const spec = toolFile(name);

  it('stays inside OpenAI strict mode at every level', () => {
    for (const [path, node] of walk(spec.strict_input_schema)) {
      for (const key of Object.keys(node)) expect(STRICT_KEYWORDS.has(key), `${path}: ${key}`).toBe(true);
      if ([node.type].flat().includes('object')) {
        expect(node.additionalProperties, path).toBe(false);
        expect(node.required, path).toEqual(Object.keys(node.properties ?? {}));
      }
    }
  });

  it('makes exactly the optional arguments nullable', () => {
    const loose = new Map(walk(spec.input_schema));
    const strict = new Map(walk(spec.strict_input_schema));
    expect([...strict.keys()]).toEqual([...loose.keys()]);
    for (const [path, node] of strict) {
      const dot = path.lastIndexOf('.');
      const prop = dot === -1 ? '' : path.slice(dot + 1);
      const parent = loose.get(dot === -1 ? '' : path.slice(0, dot));
      const optional = prop !== '' && !prop.includes('[]') && !(parent?.required ?? []).includes(prop);
      expect(Array.isArray(node.type), path).toBe(optional);
      if (Array.isArray(node.type) && node.enum !== undefined) expect(node.enum.at(-1), path).toBeNull();
    }
  });
});

// -- provider helpers ---------------------------------------------------------------

describe('provider helpers', () => {
  it('give Chat Completions the strict schema by default', () => {
    const tools = openai() as OpenAIChatTool[];
    expect(tools.map((t) => t.function.name)).toEqual([...TOOL_NAMES]);
    expect(tools[0]).toEqual({
      type: 'function',
      function: {
        name: 'sprouts_search',
        description: definitions()[0]!.description,
        parameters: toolFile('sprouts_search').strict_input_schema,
        strict: true,
      },
    });
  });

  it('give the Responses API flat tools, loose when asked', () => {
    expect(openai({ include: ['lookup'], strict: false, api: 'responses' }) as OpenAIResponsesTool[]).toEqual([
      {
        type: 'function',
        name: 'sprouts_entity_lookup',
        description: definitions({ include: ['lookup'] })[0]!.description,
        parameters: toolFile('sprouts_entity_lookup').input_schema,
        strict: false,
      },
    ]);
  });

  it('refuse an unknown OpenAI api', () => {
    expect(() => openai({ api: 'completions' as 'chat' })).toThrow(/'chat' or 'responses'/);
  });

  it('give Anthropic name, description and the loose schema', () => {
    const tools = anthropic({ include: ['search'] });
    expect(tools.map((t) => Object.keys(t).sort())).toEqual([['description', 'input_schema', 'name']]);
    expect(tools[0]!.input_schema).toEqual(toolFile('sprouts_search').input_schema);
  });

  it('answer every Chat Completions call in order: a valid one, bad arguments, an unknown tool, bad JSON', async () => {
    const { tools, fetchMock } = toolset([searchOk()]);
    const call = (id: string, name: string, args: string) => ({ id, type: 'function', function: { name, arguments: args } });
    const answers = await tools.handleOpenAIToolCalls({
      role: 'assistant',
      tool_calls: [
        call('c1', 'sprouts_search', '{"query":"acme"}'),
        call('c2', 'sprouts_search', '{"limit":"many"}'),
        call('c3', 'sprouts_weather', '{}'),
        call('c4', 'sprouts_search', '{not json'),
      ],
    });
    expect(answers.map((a) => ('tool_call_id' in a ? a.tool_call_id : null))).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(answers.every((a) => 'role' in a && a.role === 'tool')).toBe(true);
    const payloads = answers.map((a) => JSON.parse('content' in a ? a.content : '') as ToolResult);
    expect((payloads[0] as SearchToolResult).results[0]!.account_name).toBe('Acme');
    expect(errorOf(payloads[1]!).field_errors).toEqual(['limit: expected integer.']);
    expect(errorOf(payloads[2]!).code).toBe('unknown_tool');
    expect(errorOf(payloads[3]!).message).toBe('Arguments are not valid JSON. Send a JSON object.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const answer of answers) {
      const content = 'content' in answer ? answer.content : '';
      expect(content).toBe(toJson(JSON.parse(content)));
    }
  });

  it('read a Responses API response, skipping items that need no answer', async () => {
    const { tools } = toolset([searchOk()]);
    const answers = await tools.handleOpenAIToolCalls({
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [] },
        { type: 'function_call', call_id: 'call_9', name: 'sprouts_search', arguments: '{"query":"acme"}' },
        { type: 'message', role: 'assistant', content: [] },
      ],
    });
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ type: 'function_call_output', call_id: 'call_9' });
    expect(JSON.parse((answers[0] as { output: string }).output).total).toBe(1);
  });

  it('refuse what is not an OpenAI message', async () => {
    const { tools } = toolset([]);
    await expect(tools.handleOpenAIToolCalls(42)).rejects.toThrow(/OpenAI assistant message.*got number/);
  });

  it('answer every Anthropic tool_use block, marking the failed ones', async () => {
    const { tools } = toolset([searchOk()]);
    const blocks = await tools.handleAnthropicToolUse({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', id: 'tu_1', name: 'sprouts_search', input: { query: 'acme' } },
        { type: 'tool_use', id: 'tu_2', name: 'sprouts_unknown', input: {} },
      ],
    });
    expect(blocks.map((b) => b.tool_use_id)).toEqual(['tu_1', 'tu_2']);
    expect(blocks.every((b) => b.type === 'tool_result')).toBe(true);
    expect(blocks[0]).not.toHaveProperty('is_error');
    expect(blocks[1]!.is_error).toBe(true);
    expect(errorOf(JSON.parse(blocks[1]!.content)).code).toBe('unknown_tool');
  });
});

// -- validation -----------------------------------------------------------------------

describe('validation', () => {
  it('reads strict-mode nulls as "not set"', async () => {
    const { tools, fetchMock } = toolset([searchOk()]);
    const args: Record<string, unknown> = Object.fromEntries(
      Object.keys(toolFile('sprouts_search').input_schema.properties!).map((key) => [key, null]),
    );
    args.query = 'acme';
    args.filters = { industry: { include: ['Software & Technology'], exclude: null } };
    const result = await tools.run('sprouts_search', JSON.stringify(args));
    expect(result).not.toHaveProperty('error');
    expect(sentBody(fetchMock)).toEqual({
      category: 'company',
      query: 'acme',
      mode: 'fast',
      limit: 10,
      filters: { industry: { include: ['Software & Technology'] } },
    });
  });

  it('coerces representations, never values', async () => {
    const { tools, fetchMock } = toolset([searchOk()]);
    const result = await tools.run('sprouts_search', {
      query: 'acme',
      limit: ' 5 ',
      filters: { seniority: { include: 'VP' } },
    });
    expect(result).not.toHaveProperty('error');
    expect(sentBody(fetchMock).limit).toBe(5);
    expect(sentBody(fetchMock).filters).toEqual({ seniority: { include: ['VP'] } });

    const refusedLimit = await tools.run('sprouts_search', { query: 'acme', limit: 101 });
    expect(errorOf(refusedLimit).field_errors).toEqual(['limit: must be at most 100.']);
    const fractional = await tools.run('sprouts_search', { query: 'acme', limit: 2.5 });
    expect(errorOf(fractional).field_errors).toEqual(['limit: expected integer.']);
  });

  it('refuses unknown keys at every depth, and sends nothing', async () => {
    const { tools, fetchMock } = toolset([]);
    const result = await tools.run('sprouts_search', {
      query: 'acme',
      country: 'DE',
      filters: { geo: { country: 'DE' } },
    });
    const problems = errorOf(result).field_errors;
    expect(problems[0]).toMatch(/^country: unknown argument\./);
    expect(problems).toContain('filters.geo.country: unknown argument. Allowed here: places.');
    expect(problems).toContain('filters.geo.places: required.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts string length in code points, as Python does', async () => {
    const { tools } = toolset([]);
    const fits = await tools.run('sprouts_search', { query: '\u{1F600}'.repeat(2000), category: 'auto' });
    expect(errorOf(fits).message).toMatch(/requires `mode: "auto"`/);
    const over = await tools.run('sprouts_search', { query: '\u{1F600}'.repeat(2001) });
    expect(errorOf(over).field_errors).toEqual(['query: must be at most 2000 characters.']);
  });

  it('answers arguments that are not an object, and treats nothing as an empty object', async () => {
    const { tools } = toolset([]);
    expect(errorOf(await tools.run('sprouts_search', '[1, 2]')).message).toBe('Arguments must be a JSON object.');
    expect(errorOf(await tools.run('sprouts_search', '')).message).toMatch(/^Provide `query`, `filters`, or both/);
    expect(errorOf(await tools.run('sprouts_search')).message).toMatch(/^Provide `query`, `filters`, or both/);
  });

  it('keeps an argument named __proto__ a plain unknown key', async () => {
    const { tools } = toolset([]);
    const result = await tools.run('sprouts_search', '{"query":"x","__proto__":{"polluted":true}}');
    expect(errorOf(result).field_errors[0]).toMatch(/^__proto__: unknown argument\./);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// -- errors: returned or thrown -------------------------------------------------------

describe('errors', () => {
  it.each([
    [401, 'auth.invalid_key', AuthenticationError],
    [403, 'auth.insufficient_scope', PermissionDeniedError],
    [402, 'credits.insufficient', InsufficientCreditsError],
  ] as const)('throws %i: only the application can fix it', async (status, code, ErrorClass) => {
    const { tools } = toolset([problemResponse(status, { code }), problemResponse(status, { code })]);
    await expect(tools.run('sprouts_search', { query: 'acme' })).rejects.toBeInstanceOf(ErrorClass);
    await expect(
      tools.handleAnthropicToolUse([{ type: 'tool_use', id: 't', name: 'sprouts_search', input: { query: 'acme' } }]),
    ).rejects.toBeInstanceOf(ErrorClass);
  });

  it.each([
    [problemResponse(404, { code: 'history.not_found', detail: 'No such run.' }), 'history.not_found', false],
    [problemResponse(500, { code: 'internal' }), 'internal', true],
    [problemResponse(500, { code: 'credits.unknown_action' }), 'credits.unknown_action', false],
    [problemResponse(503, { code: 'upstream.unavailable' }), 'upstream.unavailable', true],
    [problemResponse(504, { code: 'upstream.timeout' }), 'upstream.timeout', true],
    [problemResponse(501, { code: 'not_implemented' }), 'not_implemented', false],
    [new Response('<html>oops</html>', { status: 500 }), 'http.500', true],
  ] as const)('returns an API failure as data with all six keys (%#)', async (response, code, retryable) => {
    const { tools } = toolset([response]);
    const error = errorOf(await tools.run('sprouts_search', { query: 'acme' }));
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    expect(Object.keys(error).sort()).toEqual(
      ['code', 'field_errors', 'message', 'request_id', 'retry_after', 'retryable'].sort(),
    );
  });

  it('reads a bare status as its message when the body says nothing', async () => {
    const { tools } = toolset([new Response('<html>oops</html>', { status: 500 })]);
    expect(errorOf(await tools.run('sprouts_search', { query: 'acme' })).message).toBe('HTTP 500');
  });

  it('does not offer a gateway 502 on a billed tool for retry, and says why', async () => {
    const { tools, fetchMock } = toolset([new Response('Bad Gateway', { status: 502 })]);
    const error = errorOf(await tools.run('sprouts_search', { query: 'acme' }));
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('may have reached the service and been charged');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a dropped connection after sending with the charge warning, not retryable', async () => {
    const { tools } = toolset([networkError('ECONNRESET')]);
    const error = errorOf(await tools.run('sprouts_similar', { anchors: [{ value: 'acme.com' }] }));
    expect(error.code).toBe('connection_error');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('a charge may already have happened');
  });

  it('returns a timeout after sending with the charge warning, not retryable', async () => {
    const hang = (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const tools = new Toolset(
      new SproutsData({ apiKey: TEST_KEY, baseUrl: BASE_URL, fetch: hang, maxRetries: 0, timeoutMs: 5 }),
    );
    const error = errorOf(await tools.run('sprouts_search', { query: 'acme' }));
    expect(error.code).toBe('timeout');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('Do not retry it automatically.');
  });

  it('offers a request that never left for retry', async () => {
    const { tools } = toolset([networkError('ECONNREFUSED')]);
    expect(errorOf(await tools.run('sprouts_search', { query: 'acme' }))).toEqual({
      code: 'connection_error',
      message:
        'Could not reach the Sprouts API. The request was never sent and nothing was charged; retrying later may succeed.',
      retryable: true,
      retry_after: null,
      field_errors: [],
      request_id: null,
    });
  });

  it('returns an unreadable success, not throws it', async () => {
    const { tools } = toolset([new Response('not json', { status: 200, headers: { 'x-request-id': 'req_1' } })]);
    const error = errorOf(await tools.run('sprouts_search', { query: 'acme' }));
    expect(error.code).toBe('response_invalid');
    expect(error.request_id).toBe('req_1');
  });

  it('returns the client’s own refusal as invalid arguments', async () => {
    const { tools, fetchMock } = toolset([]);
    const error = errorOf(await tools.run('sprouts_search', { query: '', category: 'auto', mode: 'auto' }));
    expect(error.code).toBe('invalid_arguments');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles a client from a second copy of the SDK as one from its own', async () => {
    // A fresh module graph: classes `instanceof` does not connect to this
    // file's, as with a second install or the CommonJS build beside the ESM.
    vi.resetModules();
    const other = await import('../src/index');
    expect(other.SproutsData).not.toBe(SproutsData);
    const fetchMock = fetchQueue(
      problemResponse(422, { code: 'request.invalid', detail: 'bad' }),
      networkError('ECONNREFUSED'),
      problemResponse(401, { code: 'auth.invalid_key' }),
    );
    const foreign = new other.SproutsData({ apiKey: TEST_KEY, baseUrl: BASE_URL, fetch: fetchMock, maxRetries: 0 });
    const tools = new Toolset(foreign);
    expect(errorOf(await tools.run('sprouts_search', { query: 'acme' })).code).toBe('request.invalid');
    expect(errorOf(await tools.run('sprouts_search', { query: 'acme' })).retryable).toBe(true);
    await expect(tools.run('sprouts_search', { query: 'acme' })).rejects.toBeInstanceOf(
      other.AuthenticationError,
    );
    expect(sentHeaders(fetchMock)['X-SproutsData-Client']).toBe(DEFAULT_INTEGRATION);
  });

  it('never puts the API key in a result or an error', async () => {
    const { tools } = toolset([searchOk(), problemResponse(422, { code: 'request.invalid', detail: 'bad' })]);
    const texts = [
      toJson(await tools.run('sprouts_search', { query: 'acme' })),
      toJson(await tools.run('sprouts_search', { query: 'acme' })),
      toJson(await tools.run('sprouts_weather', {})),
    ];
    for (const text of texts) expect(text).not.toContain(TEST_KEY);
  });
});

// -- developer settings ------------------------------------------------------------------

describe('developer settings', () => {
  it('merge baseline filters per sub-key', async () => {
    const { tools, fetchMock } = toolset([searchOk()], {
      baselineFilters: { industry: { include: ['Software & Technology'] } },
    });
    const result = (await tools.run('sprouts_search', {
      query: 'acme',
      filters: { industry: { exclude: ['Gaming'] } },
    })) as SearchToolResult;
    expect(sentBody(fetchMock).filters).toEqual({
      industry: { exclude: ['Gaming'], include: ['Software & Technology'] },
    });
    expect(result.caveats).toEqual([]);
  });

  it('do not report a baseline equal to the model’s value as an override', async () => {
    const baseline = { geo: { places: [{ value: 'germany', level: 'country' }] } };
    const { tools } = toolset([searchOk()], { baselineFilters: baseline });
    const result = (await tools.run('sprouts_search', {
      query: 'acme',
      filters: { geo: { places: [{ level: 'country', value: 'germany' }] } },
    })) as SearchToolResult;
    expect(result.caveats).toEqual([]);
  });

  it('apply baseline filters to look-alikes too', async () => {
    const { tools, fetchMock } = toolset([jsonResponse(envelope({ results: [] }))], {
      baselineFilters: { employee_count: { gte: 100 } },
    });
    await tools.run('sprouts_similar', { anchors: [{ value: 'acme.com' }] });
    expect(sentBody(fetchMock).filters).toEqual({ employee_count: { gte: 100 } });
  });

  it('do not let `category: "auto"` bypass the baseline', async () => {
    const { tools, fetchMock } = toolset([], { baselineFilters: { employee_count: { gte: 100 } } });
    const result = await tools.run('sprouts_search', { query: 'acme', category: 'auto', mode: 'auto' });
    expect(errorOf(result).message).toContain('cannot apply the constraints this application sets');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('take fixed arguments out of the model’s schema', async () => {
    const { tools } = toolset([], { fixed: { lookup: { category: 'person' } } });
    const lookup = tools.definitions()[2]!.input_schema;
    expect(lookup.properties).not.toHaveProperty('category');
    expect(lookup.required).toEqual(['ids']);
    const strict = (tools.openai()[2] as OpenAIChatTool).function.parameters;
    expect(strict.properties).not.toHaveProperty('category');
    expect(strict.required).not.toContain('category');
    const refusedCall = await tools.run('sprouts_entity_lookup', { category: 'company', ids: ['x'] });
    expect(errorOf(refusedCall).field_errors[0]).toMatch(/^category: unknown argument\./);
  });

  it('apply fixed and default arguments, the model keeping the last word on defaults', async () => {
    const { tools, fetchMock } = toolset([searchOk(), searchOk()], {
      fixed: { sprouts_search: { category: 'person' } },
      defaults: { sprouts_search: { mode: 'auto' } },
    });
    await tools.run('sprouts_search', { query: 'acme' });
    await tools.run('sprouts_search', { query: 'acme', mode: 'fast' });
    expect([sentBody(fetchMock, 0).category, sentBody(fetchMock, 0).mode]).toEqual(['person', 'auto']);
    expect(sentBody(fetchMock, 1).mode).toBe('fast');
  });

  it('cap the rows, saying so only when the model asked for more', async () => {
    const { tools, fetchMock } = toolset([searchOk(), searchOk()], { maxResults: 10 });
    const asked = (await tools.run('sprouts_search', { query: 'acme', limit: 50 })) as SearchToolResult;
    const defaulted = (await tools.run('sprouts_search', { query: 'acme' })) as SearchToolResult;
    expect([sentBody(fetchMock, 0).limit, sentBody(fetchMock, 1).limit]).toEqual([10, 10]);
    expect(asked.caveats).toEqual(['limit_capped: you asked for 50 rows; this application returns at most 10 per call.']);
    expect(defaulted.caveats).toEqual([]);
  });

  it.each([
    [{ include: ['search', 'weather'] }, /Unknown tool 'weather'/],
    [{ include: [] }, /at least one tool/],
    [{ include: 'search' as unknown as string[] }, /not a single string/],
    [{ fixed: { sprouts_search: { category: 'planet' } } }, /must be one of/],
    [{ fixed: { sprouts_search: { colour: 'red' } } }, /fixed\.sprouts_search\.colour: unknown argument/],
    [{ include: ['search'], fixed: { lookup: { category: 'person' } } }, /not in this toolset/],
    [{ fixed: { search: { mode: 'auto' } }, defaults: { search: { mode: 'fast' } } }, /both fixed and defaulted/],
    [{ maxResults: 0 }, /from 1 to 25/],
    [{ maxResults: 26 }, /from 1 to 25/],
    [{ maxResults: 2.5 }, /from 1 to 25/],
    [{ baselineFilters: { industry: [] as unknown as Record<string, unknown> } }, /non-empty filter object/],
    [{ integration: 'not a name' }, /`integration` must look like/],
  ] as Array<[ToolsetOptions, RegExp]>)('refuse an invalid option at construction (%#)', (options, match) => {
    expect(() => new Toolset(client(fetchQueue()), options)).toThrow(ClientValidationError);
    expect(() => new Toolset(client(fetchQueue()), options)).toThrow(match);
  });

  it('need a SproutsData client', () => {
    expect(() => new Toolset({} as SproutsData)).toThrow(TypeError);
  });
});

// -- tool rules ------------------------------------------------------------------------------

describe('tool rules', () => {
  it('omit the category on the wire for `category: "auto"`', async () => {
    const { tools, fetchMock } = toolset([searchOk()]);
    await tools.run('sprouts_search', { query: 'who raised a Series B', category: 'auto', mode: 'auto' });
    expect(sentBody(fetchMock)).toEqual({ query: 'who raised a Series B', mode: 'auto', limit: 10 });
  });

  it('ask the public `search` for `category: "auto"` rather than strip it themselves', async () => {
    const search = vi.spyOn(SproutsData.prototype, 'search');
    try {
      const { tools } = toolset([searchOk()]);
      await tools.run('sprouts_search', { query: 'who raised a Series B', category: 'auto', mode: 'auto' });
      expect(search).toHaveBeenCalledWith(expect.objectContaining({ category: 'auto' }));
    } finally {
      search.mockRestore();
    }
  });

  it('send no empty domain list or sort, and no empty filters', async () => {
    const { tools, fetchMock } = toolset([searchOk()]);
    await tools.run('sprouts_search', { query: 'x', include_domains: [], sort: [], filters: {} });
    expect(sentBody(fetchMock)).toEqual({ category: 'company', query: 'x', mode: 'fast', limit: 10 });
  });

  it.each([
    [{ query: 'x', category: 'auto' }, 'requires `mode: "auto"`'],
    [{ filters: { industry: { include: ['x'] } }, category: 'auto', mode: 'auto' }, 'needs `query`'],
    [{ query: 'x', category: 'auto', mode: 'auto', include_domains: ['a.com'] }, 'accepts only `query`'],
    [{ query: 'x', category: 'patent', include_domains: ['a.com'] }, 'not `patent`'],
    [{ query: 'x', sort: [{ field: 'revenue' }, { field: 'revenue', direction: 'asc' }] }, 'names `revenue` twice'],
  ])('refuse a search before sending (%#)', async (args, message) => {
    const { tools, fetchMock } = toolset([]);
    expect(errorOf(await tools.run('sprouts_search', args)).message).toContain(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('say so when `fast` mode parsed nothing', async () => {
    const resolved = { parser_version: 'none', mode: 'fast', category: 'company', filters: {}, filters_source: 'none' };
    const { tools } = toolset([jsonResponse(envelope({ results: [], resolved_search: resolved as never }))]);
    const result = (await tools.run('sprouts_search', { query: 'payments companies in Germany' })) as SearchToolResult;
    expect(result.caveats[0]).toMatch(/^parser_not_run:/);
  });

  it.each([
    [{ category: 'patent', ids: ['US1'], by: 'name' }, '`patent` accepts no `by`'],
    [{ category: 'person', ids: ['a'], by: 'domain' }, 'a person has no domain'],
    [{ category: 'company', ids: ['a'], by: 'id' }, 'Allowed: auto, domain, li_url, name.'],
  ])('refuse a lookup before sending (%#)', async (args, message) => {
    const { tools, fetchMock } = toolset([]);
    expect(errorOf(await tools.run('sprouts_entity_lookup', args)).message).toContain(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('send `by: "id"` for named document lookups unless asked otherwise', async () => {
    const empty = () => jsonResponse(envelope({ results: [] }));
    const { tools, fetchMock } = toolset([empty(), empty()]);
    await tools.run('sprouts_entity_lookup', { category: 'funding_round', ids: ['a9f4c1e07d3b52c8'] });
    await tools.run('sprouts_entity_lookup', { category: 'funding_round', ids: ['Stripe'], by: 'name' });
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/v1\/entities\/fundings$/);
    expect(sentBody(fetchMock, 0)).toEqual({ ids: ['a9f4c1e07d3b52c8'], by: 'id' });
    expect(sentBody(fetchMock, 1)).toEqual({ ids: ['Stripe'], by: 'name' });
  });

  it('request and project lookup fields', async () => {
    const record = { id: 'acme.com', account_name: 'Acme', domain: 'acme.com', ownership: 'Private' };
    const hit = { id: 'acme.com', category: 'company', found: true, matches: [record] };
    const { tools, fetchMock } = toolset([jsonResponse(envelope({ results: [hit as never] }))]);
    const result = await tools.run('sprouts_entity_lookup', {
      category: 'company',
      ids: ['acme.com'],
      by: 'domain',
      fields: ['ownership'],
    });
    expect(sentBody(fetchMock).fields).toEqual(['ownership']);
    expect(toJson(result)).toContain('"matches":[{"id":"acme.com","ownership":"Private"}]');
  });

  it('omit a missing id, never coerce it', async () => {
    const { tools } = toolset([
      jsonResponse(envelope({ results: [{ category: 'company', account_name: 'No Id Inc' } as never] })),
    ]);
    const row = ((await tools.run('sprouts_search', { query: 'x' })) as SearchToolResult).results[0]!;
    expect(row).not.toHaveProperty('id');
    expect(toJson(row)).not.toMatch(/undefined|null|None/);
  });

  it('match a search id whole, not up to a trailing newline', async () => {
    const miss = (id: string) => ({ id, category: 'company', found: false, matches: [] });
    const misses = [miss('a3f9c2e17b604d58'), miss('a3f9c2e17b604d58\n')];
    const { tools } = toolset([jsonResponse(envelope({ results: misses as never }))]);
    const result = await tools.run('sprouts_entity_lookup', {
      category: 'company',
      ids: ['a3f9c2e17b604d58', 'a3f9c2e17b604d58\n'],
    });
    expect((result as { caveats: string[] }).caveats).toEqual([
      'search_ids_not_found: a3f9c2e17b604d58 — search-result ids are not record ids and are never found here. ' +
        'Look the row up by its `lookup` value (domain or LinkedIn URL); this miss does not mean the record is not held.',
    ]);
  });

  it('call out zero-weight anchors', async () => {
    const { tools } = toolset([jsonResponse(envelope({ results: [] }))]);
    const result = (await tools.run('sprouts_similar', {
      anchors: [{ value: 'a.com' }, { value: 'b.com', weight: 0 }],
    })) as SearchToolResult;
    expect(result.caveats[1]).toContain('anchors_zero_weight: b.com');
  });

  it('add no lookup hint when the lookup tool is not offered', async () => {
    const { tools } = toolset([searchOk()], { include: ['search'] });
    const result = (await tools.run('sprouts_search', { query: 'acme' })) as SearchToolResult;
    expect(result.results[0]).not.toHaveProperty('lookup');
  });

  it('pass the suggestion through', async () => {
    const suggestion = { kind: 'search' as const, category: 'job_opening' as const, message: 'Postings answer this.' };
    const { tools } = toolset([jsonResponse(envelope({ results: [], suggestion }))]);
    expect(((await tools.run('sprouts_search', { query: 'x' })) as SearchToolResult).suggestion).toEqual(suggestion);
  });
});

// -- attribution header ---------------------------------------------------------------------------

describe('X-SproutsData-Client', () => {
  it('names toolset calls without changing the caller’s client', async () => {
    const fetchMock = fetchQueue(searchOk(), searchOk());
    const own = client(fetchMock);
    await new Toolset(own).run('sprouts_search', { query: 'acme' });
    expect(sentHeaders(fetchMock)['X-SproutsData-Client']).toBe(`js-tools/${VERSION}`);
    expect(DEFAULT_INTEGRATION).toBe(`js-tools/${VERSION}`);
    expect(own.integration).toBeUndefined();
    await own.search({ query: 'acme' });
    expect(sentHeaders(fetchMock, 1)).not.toHaveProperty('X-SproutsData-Client');
  });

  it('lets a caller-named integration win, on the toolset or on the client', async () => {
    const fetchMock = fetchQueue(searchOk(), searchOk());
    await new Toolset(client(fetchMock), { integration: 'langchain/0.4.0' }).run('sprouts_search', { query: 'a' });
    expect(sentHeaders(fetchMock, 0)['X-SproutsData-Client']).toBe('langchain/0.4.0');
    const named = client(fetchMock, { integration: 'my-agent/1.0.0+build.7' });
    await new Toolset(named).run('sprouts_search', { query: 'a' });
    expect(sentHeaders(fetchMock, 1)['X-SproutsData-Client']).toBe('my-agent/1.0.0+build.7');
  });

  it('is validated, and refused as a raw header in any casing', async () => {
    expect(() => client(fetchQueue(), { integration: 'langchain' })).toThrow(/`integration` must look like/);
    expect(() => client(fetchQueue(), { integration: 'langchain/1.0\n' })).toThrow(/`integration` must look like/);
    expect(
      () => new SproutsData({ apiKey: TEST_KEY, defaultHeaders: { 'x-sproutsdata-client': 'x/1' } }),
    ).toThrow(/integration/);
    const own = client(fetchQueue(searchOk()));
    await expect(
      own.search({ query: 'acme' }, { headers: { 'X-SPROUTSDATA-CLIENT': 'x/1' } }),
    ).rejects.toThrow(ClientValidationError);
  });

  it('is carried and replaced by withOptions, which leaves the original alone', async () => {
    const fetchMock = fetchQueue(searchOk());
    const original = client(fetchMock, { integration: 'a/1' });
    expect(original.withOptions({ timeoutMs: 5_000 }).integration).toBe('a/1');
    const copy = original.withOptions({ integration: 'b/2', defaultHeaders: { 'X-Team': 'growth' } });
    expect(copy.integration).toBe('b/2');
    expect(original.integration).toBe('a/1');
    await copy.search({ query: 'acme' });
    expect(sentHeaders(fetchMock)).toMatchObject({ 'X-SproutsData-Client': 'b/2', 'X-Team': 'growth' });
    expect(JSON.stringify(copy)).not.toContain(TEST_KEY);
  });
});

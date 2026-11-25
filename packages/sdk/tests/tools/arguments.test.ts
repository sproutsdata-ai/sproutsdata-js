/**
 * Reading a model's arguments, as JSON reads them, checked against the tool's schema; and the
 * failures that come back as data or are thrown. Nothing is sent for what the schema refuses.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { APIError, AuthenticationError, InsufficientCreditsError, PermissionDeniedError, RedirectRefusedError, SproutsData } from '../../src/index.js';
import { Toolset } from '../../src/tools/index.js';
import { BASE_URL, FIXTURE_KEY } from '../support/fakes.js';
import type { ToolError, ToolResult } from '../../src/tools/index.js';
import { problem, searchOk, toolset } from './support.js';

const SPEC = new URL('../../../../spec/tools/sprouts_search.json', import.meta.url).pathname;
const errorOf = (result: ToolResult): ToolError['error'] => {
  if (!('error' in result)) throw new Error(`expected an error, got ${JSON.stringify(result)}`);
  return result.error;
};
const ch = (code: number): string => String.fromCodePoint(code);

describe('arguments', () => {
  it('read a strict-mode null as not set', async () => {
    const { tools, sent } = toolset([searchOk()]);
    const properties = (JSON.parse(readFileSync(SPEC, 'utf8')) as { input_schema: { properties: Record<string, unknown> } }).input_schema.properties;
    const args: Record<string, unknown> = Object.fromEntries(Object.keys(properties).map((key) => [key, null]));
    Object.assign(args, { query: 'acme', filters: { industry: { include: ['Software & Technology'], exclude: null } } });
    const result = await tools.run('sprouts_search', JSON.stringify(args));
    expect(result).not.toHaveProperty('error');
    expect(sent[0]?.body).toEqual({ category: 'company', query: 'acme', mode: 'fast', limit: 10, filters: { industry: { include: ['Software & Technology'] } } });
  });

  it.each([[undefined], [null], [''], [{}]])('read %j as an empty object', async (args) => {
    const { tools, sent } = toolset([searchOk()]);
    expect(errorOf(await tools.run('sprouts_search', args)).message).toMatch(/^Provide `query`, `filters`, or both\./);
    expect(sent).toHaveLength(0);
  });

  it('coerce representations, never values', async () => {
    const { tools, sent } = toolset([searchOk()]);
    await tools.run('sprouts_search', { query: 'acme', limit: '5', filters: { seniority: { include: 'VP' } } });
    expect(sent[0]?.body).toMatchObject({ limit: 5, filters: { seniority: { include: ['VP'] } } });
    expect(errorOf(await tools.run('sprouts_search', { query: 'acme', limit: 101 })).field_errors).toEqual(['limit: must be at most 100.']);
  });

  it.each([
    [{ query: 'acme', limit: 0 }, 'limit: must be at least 1.'],
    [{ query: 'acme', limit: 2.5 }, 'limit: expected integer.'],
    [{ query: 'acme', limit: true }, 'limit: expected integer.'],
    [{ query: 'acme', category: 'planet' }, 'category: must be one of'],
    [{ query: 7 }, 'query: expected string.'],
    [{ query: 'x'.repeat(2001) }, 'query: must be at most 2000 characters.'],
    [{ query: 'acme', sort: [{ direction: 'asc' }] }, 'sort.0.field: required.'],
    [{ query: 'acme', filters: [] }, 'filters: expected object.'],
  ])('list every schema problem: %j', async (args, expected) => {
    const { tools, sent } = toolset([searchOk()]);
    expect(errorOf(await tools.run('sprouts_search', args)).field_errors.some((p) => p.startsWith(expected))).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('refuse unknown keys at every depth', async () => {
    const { tools } = toolset([searchOk()]);
    const problems = errorOf(await tools.run('sprouts_search', { query: 'acme', country: 'DE', filters: { geo: { country: 'DE' } } })).field_errors;
    expect(problems[0]).toMatch(/^country: unknown argument\./);
    expect(problems.some((p) => p.startsWith('filters.geo.country: unknown argument.'))).toBe(true);
  });

  it.each([
    ['sprouts_search', { query: 'acme', page: 2 }, 'page: This tool has no `page`.'],
    ['sprouts_search', { query: 'acme', offset: 20 }, 'offset: This tool has no `offset`.'],
    ['sprouts_entity_lookup', { kind: 'company', ids: ['a'] }, 'kind: This tool takes'],
  ])('%s: a refused argument says what to use instead', async (tool, args, hint) => {
    const { tools } = toolset([searchOk()]);
    expect(errorOf(await tools.run(tool, args)).field_errors[0]).toMatch(new RegExp(`^${hint.replace(/[.`]/g, '\\$&')}`));
  });

  it('must be an object', async () => {
    const { tools } = toolset([searchOk()]);
    expect(errorOf(await tools.run('sprouts_search', '[1, 2]')).message).toBe('Arguments must be a JSON object.');
  });

  it.each(['NaN', 'Infinity', '-Infinity'])('are JSON: %s is not', async (constant) => {
    const { tools } = toolset([searchOk()]);
    expect(errorOf(await tools.run('sprouts_search', `{"query": "x", "limit": ${constant}}`)).message).toBe('Arguments are not valid JSON. Send a JSON object.');
  });

  it('hold an integer beyond 2**53 as its nearest double', async () => {
    const { tools, sent } = toolset([searchOk()]);
    await tools.run('sprouts_search', '{"query": "x", "filters": {"employee_count": {"gte": 9007199254740993}}}');
    expect(sent[0]?.body).toMatchObject({ filters: { employee_count: { gte: 2 ** 53 } } });
    expect(errorOf(await tools.run('sprouts_search', `{"query": "x", "limit": 1${'0'.repeat(400)}}`)).field_errors).toEqual(['limit: expected integer.']);
  });

  it.each([
    [ch(0xa0) + '5' + ch(0xfeff), []],
    [ch(0x2028) + '5\n', []],
    [ch(0x1c) + '5', ['limit: expected integer.']],
    [ch(0x85) + '5', ['limit: expected integer.']],
    ['5\n6', ['limit: expected integer.']],
  ])('trim digit strings as JavaScript trims them (%#)', async (limit, problems) => {
    const { tools } = toolset([searchOk()]);
    const result = await tools.run('sprouts_search', { query: 'x', limit });
    expect('error' in result ? result.error.field_errors : []).toEqual(problems);
  });
});

describe('failures', () => {
  it.each([
    [401, 'auth.invalid_key', AuthenticationError],
    [403, 'auth.insufficient_scope', PermissionDeniedError],
    [402, 'credits.insufficient', InsufficientCreditsError],
  ])('a %i is thrown: only the application can fix it', async (status, code, thrown) => {
    const { tools } = toolset([problem(code, status)]);
    await expect(tools.run('sprouts_search', { query: 'acme' })).rejects.toBeInstanceOf(thrown);
    await expect(tools.handleAnthropicToolUse([{ type: 'tool_use', id: 't', name: 'sprouts_search', input: { query: 'acme' } }])).rejects.toBeInstanceOf(thrown);
  });

  it.each([
    [problem('history.not_found', 404, { detail: 'No such run.' }), 'history.not_found', false],
    [problem('internal', 500), 'internal', true],
    [problem('conflict', 409), 'conflict', false],
    [problem('upstream.unavailable', 503), 'upstream.unavailable', true],
    [problem('upstream.timeout', 504), 'upstream.timeout', true],
    [problem('credits.refused', 503), 'credits.refused', false],
    [problem('quota.concurrency_exceeded', 429), 'quota.concurrency_exceeded', false],
    [problem('not_implemented', 501), 'not_implemented', false],
    [{ status: 500, raw_body: '<html>oops</html>' }, 'http.500', true],
  ])('come back as data with six keys (%#)', async (answer, code, retryable) => {
    const { tools } = toolset([answer]);
    const error = errorOf(await tools.run('sprouts_search', { query: 'acme' }));
    expect([error.code, error.retryable]).toEqual([code, retryable]);
    expect(Object.keys(error).sort()).toEqual(['code', 'field_errors', 'message', 'request_id', 'retry_after', 'retryable']);
  });

  it('carry the server field errors without the body prefix, and a rate limit its wait', async () => {
    const errors = [
      { loc: ['body', 'filters', 'seniority'], msg: 'not held' },
      { loc: ['query', 'limit'], msg: 'too big' },
      { loc: [], msg: 'whole request' },
    ];
    expect(errorOf(await toolset([problem('request.invalid', 422, { errors })]).tools.run('sprouts_search', { query: 'acme' })).field_errors).toEqual([
      'filters.seniority: not held',
      'limit: too big',
      'arguments: whole request',
    ]);
    const limited = errorOf(await toolset([problem('quota.burst_exceeded', 429, {}, { 'Retry-After': '3' })]).tools.run('sprouts_search', { query: 'acme' }));
    expect([limited.retryable, limited.retry_after]).toEqual([true, 3]);
  });

  it.each([
    [{ status: 502, raw_body: 'Bad Gateway' }],
    [{ status: 504, raw_body: '' }],
    [{ status: 504, raw_body: '<html>504 Gateway Time-out</html>' }],
    [problem('x', 408)],
  ])('a gateway answer is not retryable, and says why (%#)', async (answer) => {
    const { tools, sent } = toolset([answer]);
    const error = errorOf(await tools.run('sprouts_search', { query: 'acme' }));
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('may have reached the service and been charged');
    expect(sent).toHaveLength(1);
  });

  it('a redirect is thrown, however the fetch reports it: the application must fix its base URL', async () => {
    const answered = toolset([{ status: 302, headers: { location: 'https://elsewhere.example' } }]);
    await expect(answered.tools.run('sprouts_search', { query: 'acme' })).rejects.toBeInstanceOf(APIError);
    const refused = new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    const client = new SproutsData({ apiKey: FIXTURE_KEY, baseUrl: BASE_URL, maxRetries: 0, fetch: () => Promise.reject(refused) });
    await expect(new Toolset(client).run('sprouts_search', { query: 'acme' })).rejects.toBeInstanceOf(RedirectRefusedError);
  });

  it('a request that never left is retryable; one that may have is not', async () => {
    const unsent = errorOf(await toolset([{ network: 'connect_refused' }]).tools.run('sprouts_search', { query: 'acme' }));
    expect([unsent.code, unsent.retryable]).toEqual(['connection_error', true]);
    const reset = errorOf(await toolset([{ network: 'reset_after_send' }]).tools.run('sprouts_similar', { anchors: [{ value: 'acme.com' }] }));
    expect([reset.code, reset.retryable, reset.message.includes('a charge may already have happened')]).toEqual(['connection_error', false, true]);
  });

  it('an unreadable success comes back as data', async () => {
    const { tools } = toolset([{ status: 200, raw_body: 'not json', content_type: 'application/json' }]);
    expect(errorOf(await tools.run('sprouts_search', { query: 'acme' })).code).toBe('response_invalid');
  });

  it("the client's own refusal comes back as invalid arguments", async () => {
    const { tools, sent } = toolset([{ status: 500 }]);
    const error = errorOf(await tools.run('sprouts_search', { query: 'acme', filters: { employee_count: { gte: 500, lte: 10 } } }));
    expect(error.code).toBe('invalid_arguments');
    expect(sent).toHaveLength(0);
  });
});

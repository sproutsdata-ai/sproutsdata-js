/**
 * Running one conformance case (`spec/conformance/cases/`) against the transport: the cases
 * are the specification and this is the implementation. Each case runs through the real
 * transport, against the operation `spec/routes.json` gives its method and path, with a
 * recording `fetch` and a clock that never waits. A key this runner does not know fails the
 * case: a silently ignored key reads as coverage it is not.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { expect } from 'vitest';

import { OPERATIONS, type OperationName, type RouteClass } from '../../src/generated/operations.js';
import type { Answer } from '../../src/core/answer.js';
import { APIConnectionError, APIError, APITimeoutError, SproutsDataError } from '../../src/core/errors.js';
import { degraded, Pager, truncated, type SentPage } from '../../src/core/pagination.js';
import { CONCEPT_CLASSES } from '../../src/core/problem.js';
import { Transport, type Operation } from '../../src/core/transport.js';
import { FakeClock, options, recordingFetch, type Scripted, type Sent } from '../support/fakes.js';

export const CASES_DIR = new URL('../../../../spec/conformance/cases/', import.meta.url).pathname;

const KEYS = {
  case: ['name', 'description', 'request', 'responses', 'expect', 'max_retries', 'paginate', 'next_page_limit', 'mutate_request_after_first_page', 'request_id', 'off_spec', 'route_class'],
  expect: ['attempts', 'error', 'success', 'sent', 'slept', 'no_sleep', 'no_next_page'],
  error: ['concept', 'not_concept', 'status', 'code', 'request_id', 'fields', 'extra', 'field_errors_length', 'reached_server'],
  success: ['results_length', 'has_more', 'request_id', 'truncated', 'degraded', 'first_category', 'first_degradation_reason', 'hit_extra_field', 'attribution_length', 'attribution_url_is_none', 'export_kind', 'job_id'],
  sent: ['body_equals_index', 'except_keys', 'cursor', 'limit', 'headers_present', 'headers_absent', 'headers_equal', 'same_header_as_index'],
} as const;

const CONCEPTS: Readonly<Record<string, abstract new (...args: never[]) => Error>> = {
  ...CONCEPT_CLASSES,
  connection: APIConnectionError,
  timeout: APITimeoutError,
  api_status: APIError,
};

type Json = Record<string, unknown>;

export interface Case {
  readonly name: string;
  readonly file: string;
  readonly request?: { readonly method?: string; readonly path?: string; readonly body?: Json };
  readonly responses: readonly Scripted[];
  readonly expect: Json;
  readonly max_retries?: number;
  readonly paginate?: string;
  readonly next_page_limit?: number;
  readonly mutate_request_after_first_page?: Json;
  readonly request_id?: string;
  readonly route_class?: RouteClass;
}

export interface Run {
  readonly sent: Sent[];
  readonly clock: FakeClock;
  readonly answers: Answer[];
  raised: unknown;
}

/** Every case, with the file it came from. */
export function loadCases(): Case[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.json')) files.push(path);
    }
  };
  walk(CASES_DIR);
  return files.map((path) => ({ ...(JSON.parse(readFileSync(path, 'utf8')) as Omit<Case, 'file'>), file: relative(CASES_DIR, path) }));
}

/** Fail on any key the runner would otherwise ignore. */
export function checkKeys(test: Case): void {
  const unknown = (known: readonly string[], found: readonly string[]): string[] => found.filter((k) => !known.includes(k));
  const sentKeys = ((test.expect['sent'] ?? []) as Json[]).flatMap((s) => Object.keys(s));
  expect(unknown(KEYS.case, Object.keys(test).filter((k) => k !== 'file')), test.file).toEqual([]);
  expect(unknown(KEYS.expect, Object.keys(test.expect)), test.file).toEqual([]);
  expect(unknown(KEYS.error, Object.keys((test.expect['error'] ?? {}) as Json)), test.file).toEqual([]);
  expect(unknown(KEYS.success, Object.keys((test.expect['success'] ?? {}) as Json)), test.file).toEqual([]);
  expect(unknown(KEYS.sent, sentKeys), test.file).toEqual([]);
}

const pattern = (template: string): RegExp => new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`);

/**
 * The case's operation, its template path replaced by the case's concrete one, and its class
 * by the case's `route_class` where it pins a class rather than a route (only `keyed` sends a
 * key).
 */
export function operationFor(test: Case): Operation {
  const method = test.request?.method ?? 'POST';
  const path = test.request?.path ?? '/v1/search';
  const matches = (Object.keys(OPERATIONS) as OperationName[]).filter((name) => OPERATIONS[name].method === method && pattern(OPERATIONS[name].path).test(path));
  expect(matches, `${test.file}: ${method} ${path}`).toHaveLength(1);
  const name = matches[0];
  if (name === undefined) throw new Error(`${test.file}: no operation for ${method} ${path}`);
  const op: Operation = { ...OPERATIONS[name], path, name };
  const routeClass = test.route_class;
  if (routeClass === undefined) return op;
  const keyed = op.idempotency === 'none' ? 'optional' : op.idempotency;
  return { ...op, routeClass, idempotency: routeClass === 'keyed' ? keyed : 'none' };
}

function firstInput(test: Case, op: Operation): SentPage {
  if (op.method === 'GET') return { query: { ...(test.request?.body ?? {}) } };
  if (test.request?.body !== undefined) return { body: test.request.body };
  return { body: op.name === 'search' ? { query: 'fintech' } : undefined };
}

/** Run the case on the transport. */
export async function run(test: Case): Promise<Run> {
  const { fetch, sent } = recordingFetch(test.responses);
  const clock = new FakeClock();
  const result: Run = { sent, clock, answers: [], raised: undefined };
  const transport = new Transport(options({ fetch, maxRetries: test.max_retries ?? 2 }), clock);
  const op = operationFor(test);
  const input = firstInput(test, op);
  try {
    const pager = op.paging === undefined ? undefined : new Pager(op.paging, input);
    const first = await transport.send(op, input, test.request_id === undefined ? {} : { requestId: test.request_id });
    result.answers.push(first);
    const follow = nextInput(test, input, pager, first);
    if (follow !== undefined) result.answers.push(await transport.send(op, follow));
  } catch (err) {
    result.raised = err;
  }
  return result;
}

function nextInput(test: Case, sent: SentPage, pager: Pager | undefined, first: Answer): SentPage | undefined {
  if (test.paginate !== 'next_page') return undefined;
  expect(pager, `${test.file}: pages an operation that does not page`).toBeDefined();
  if (test.mutate_request_after_first_page !== undefined && sent.body !== undefined) {
    Object.assign(sent.body, test.mutate_request_after_first_page); // page 2 must be unaffected
  }
  const body = first.kind === 'json' ? (first.json as Json) : {};
  const cursor = body['next_cursor'];
  if (typeof cursor !== 'string') {
    expect(test.expect['no_next_page'], `${test.file}: expected another page`).toBe(true);
    return undefined;
  }
  const rows = ((body[pager?.paging.items ?? 'results'] ?? []) as unknown[]).length;
  return pager?.nextInput(cursor, rows, test.next_page_limit);
}

/** Every expectation of the case, against what happened. */
export function check(test: Case, result: Run): void {
  const want = test.expect;
  if (want['attempts'] !== undefined) expect(result.sent, `${test.file}: attempts`).toHaveLength(want['attempts'] as number);
  if (want['no_sleep'] === true) expect(result.clock.sleeps).toEqual([]);
  if (want['slept'] !== undefined) expect(result.clock.sleeps).toEqual((want['slept'] as number[]).map((s) => s * 1_000));
  if (want['error'] === undefined) expect(result.raised, `${test.file}: unexpected error`).toBeUndefined();
  else checkError(test, want['error'] as Json, result.raised);
  if (want['success'] !== undefined) checkSuccess(want['success'] as Json, result.answers.at(-1));
  ((want['sent'] ?? []) as Json[]).forEach((spec, index) => {
    checkSent(result.sent, index, spec);
  });
}

const camel = (name: string): string => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

function checkError(test: Case, spec: Json, raised: unknown): void {
  expect(raised, `${test.file}: expected an error`).toBeInstanceOf(SproutsDataError);
  checkConcept(spec, raised);
  if (['status', 'code', 'request_id', 'fields', 'extra', 'field_errors_length'].some((k) => k in spec)) {
    expect(raised).toBeInstanceOf(APIError);
    checkProblem(spec, raised as APIError);
  }
}

function checkConcept(spec: Json, raised: unknown): void {
  const concept = spec['concept'];
  if (typeof concept === 'string') expect(raised).toBeInstanceOf(CONCEPTS[concept]);
  const notConcept = spec['not_concept'];
  if (typeof notConcept === 'string') expect(raised).not.toBeInstanceOf(CONCEPTS[notConcept]);
  if (spec['reached_server'] !== undefined) expect((raised as APIConnectionError).reachedServer).toBe(spec['reached_server']);
}

function checkProblem(spec: Json, error: APIError): void {
  const direct: Readonly<Record<string, unknown>> = { status: error.status, code: error.code, request_id: error.requestId };
  for (const [key, value] of Object.entries(direct)) if (spec[key] !== undefined) expect(value, key).toEqual(spec[key]);
  for (const [name, value] of Object.entries((spec['fields'] ?? {}) as Json)) expect((error as unknown as Json)[camel(name)]).toEqual(value);
  for (const [name, value] of Object.entries((spec['extra'] ?? {}) as Json)) expect(error.extra[name]).toEqual(value);
  if (spec['field_errors_length'] !== undefined) expect(error.fieldErrors).toHaveLength(spec['field_errors_length'] as number);
}

function checkSuccess(spec: Json, answer: Answer | undefined): void {
  if (answer === undefined) throw new Error('expected an answer');
  if (spec['export_kind'] !== undefined) expect(answer.kind === 'csv' ? 'file' : 'job').toBe(spec['export_kind']);
  if (spec['request_id'] !== undefined) expect(answer.meta.requestId).toBe(spec['request_id']);
  checkEnvelope(spec, answer.kind === 'json' ? (answer.json as Json) : {});
}

function checkEnvelope(spec: Json, body: Json): void {
  const results = (body['results'] ?? []) as Json[];
  const degradation = (body['degradation'] ?? []) as Json[];
  const attribution = (body['attribution'] ?? []) as Json[];
  const checks: Readonly<Record<string, () => unknown>> = {
    job_id: () => body['job_id'],
    results_length: () => results.length,
    has_more: () => body['has_more'],
    truncated: () => truncated(body),
    degraded: () => degraded(body),
    first_category: () => results[0]?.['category'],
    first_degradation_reason: () => degradation[0]?.['reason'],
    attribution_length: () => attribution.length,
  };
  for (const [key, read] of Object.entries(checks)) if (spec[key] !== undefined) expect(read(), key).toEqual(spec[key]);
  if (spec['hit_extra_field'] !== undefined) {
    const [key, value] = spec['hit_extra_field'] as [string, unknown];
    expect(results[0]?.[key]).toEqual(value);
  }
  if (spec['attribution_url_is_none'] !== undefined) {
    expect(attribution[0]?.['url']).toBeNull();
    expect(attribution[0]).toHaveProperty('url');
  }
}

function sentFields(request: Sent): Json {
  return request.method === 'GET' ? Object.fromEntries(request.url.searchParams) : ((request.body ?? {}) as Json);
}

/** A value as the wire carries it: a query string holds text, a JSON body its own type. */
function asSent(request: Sent, value: unknown): unknown {
  if (request.method !== 'GET') return value;
  return typeof value === 'number' || typeof value === 'string' ? String(value) : JSON.stringify(value);
}

function checkSent(sent: readonly Sent[], index: number, spec: Json): void {
  const request = sent[index];
  if (request === undefined) throw new Error(`no request ${String(index)} was sent`);
  checkSentBody(sent, request, spec);
  checkSentHeaders(sent, request, spec);
}

function checkSentBody(sent: readonly Sent[], request: Sent, spec: Json): void {
  const fields = sentFields(request);
  const reference = spec['body_equals_index'];
  if (typeof reference === 'number') {
    const other = sent[reference];
    if (other === undefined) throw new Error(`no request ${String(reference)} to compare with`);
    const ignored = new Set((spec['except_keys'] ?? []) as string[]);
    const without = (o: Json): Json => Object.fromEntries(Object.entries(o).filter(([k]) => !ignored.has(k)));
    expect(without(fields)).toEqual(without(sentFields(other)));
  }
  for (const key of ['cursor', 'limit']) if (spec[key] !== undefined) expect(fields[key], key).toEqual(asSent(request, spec[key]));
}

function checkSentHeaders(sent: readonly Sent[], request: Sent, spec: Json): void {
  for (const name of (spec['headers_present'] ?? []) as string[]) expect(request.headers.get(name), name).toBeTruthy();
  for (const name of (spec['headers_absent'] ?? []) as string[]) expect(request.headers.has(name), name).toBe(false);
  for (const [name, value] of Object.entries((spec['headers_equal'] ?? {}) as Json)) expect(request.headers.get(name)).toBe(value);
  const same = spec['same_header_as_index'] as { header: string; index: number } | undefined;
  if (same !== undefined) {
    expect(request.headers.get(same.header)).toBeTruthy();
    expect(request.headers.get(same.header)).toBe(sent[same.index]?.headers.get(same.header));
  }
}

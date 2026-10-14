/**
 * Runs the shared behavioural fixtures in `spec/conformance/cases/` (vendored
 * from sprouts-py; see `spec/conformance/README.md`).
 *
 * The cases are the specification and this file is the implementation. Every
 * case runs against the route class `spec/routes.json` gives its request, over
 * a scripted `fetch` that replays the case's responses — HTTP answers or
 * transport outcomes (`connect_refused`, `read_timeout`, `reset_after_send`).
 * Waits between retries are observed by mocking `src/sleep`, so no case
 * sleeps for real.
 *
 * A case, or a key inside one, that this runner does not understand is a
 * failure, never a skip: a silently skipped case reads as coverage it does not
 * have.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Transport, type RouteClass } from '../src/http';
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  ConflictError,
  CursorExpiredError,
  CursorInvalidError,
  FeatureNotAvailableError,
  IdempotencyConflictError,
  InsufficientCreditsError,
  InternalServerError,
  InvalidRequestError,
  NotFoundError,
  PaginationDepthExceededError,
  PermissionDeniedError,
  RateLimitError,
  RequestTooLargeError,
  ServiceUnavailableError,
  SproutsData,
  UpstreamTimeoutError,
  type SearchEnvelope,
  type SearchParams,
} from '../src/index';
import { TEST_KEY, networkError } from './helpers';

const { slept } = vi.hoisted(() => ({ slept: [] as number[] }));
vi.mock('../src/sleep', () => ({
  sleep: vi.fn(async (ms: number) => {
    slept.push(ms / 1_000);
  }),
}));

const SPEC_DIR = fileURLToPath(new URL('../../../spec/', import.meta.url));
const CASES_DIR = join(SPEC_DIR, 'conformance', 'cases');
const BASE_URL = 'https://api.conformance.test';
/** Short enough that a `read_timeout` case costs milliseconds; the other responses are immediate. */
const TIMEOUT_MS = 25;

/** The one table that is this SDK's own: a spec concept → the class that must be raised. */
const CONCEPTS: Record<string, abstract new (...args: never[]) => Error> = {
  api_status: APIError,
  authentication: AuthenticationError,
  permission_denied: PermissionDeniedError,
  insufficient_credits: InsufficientCreditsError,
  invalid_request: InvalidRequestError,
  cursor_invalid: CursorInvalidError,
  cursor_expired: CursorExpiredError,
  pagination_depth_exceeded: PaginationDepthExceededError,
  not_found: NotFoundError,
  request_too_large: RequestTooLargeError,
  conflict: ConflictError,
  idempotency_conflict: IdempotencyConflictError,
  rate_limit: RateLimitError,
  feature_not_available: FeatureNotAvailableError,
  service_unavailable: ServiceUnavailableError,
  upstream_timeout: UpstreamTimeoutError,
  internal: InternalServerError,
  connection: APIConnectionError,
  timeout: APITimeoutError,
};

const KNOWN_KEYS = {
  case: [
    'name',
    'description',
    'request',
    'responses',
    'expect',
    'max_retries',
    'paginate',
    'next_page_limit',
    'mutate_request_after_first_page',
    'request_id',
    'route_class',
  ],
  request: ['method', 'path', 'body'],
  response: ['status', 'headers', 'body', 'raw_body', 'content_type', 'network'],
  expect: ['attempts', 'error', 'success', 'sent', 'slept', 'no_sleep', 'no_next_page'],
  error: [
    'concept',
    'not_concept',
    'status',
    'code',
    'request_id',
    'fields',
    'field_errors_length',
    'reached_server',
  ],
  success: [
    'results_length',
    'has_more',
    'request_id',
    'truncated',
    'degraded',
    'first_category',
    'first_degradation_reason',
    'hit_extra_field',
    'attribution_length',
    'attribution_url_is_none',
  ],
  sent: [
    'body_equals_index',
    'except_keys',
    'cursor',
    'limit',
    'headers_present',
    'headers_absent',
    'headers_equal',
    'same_header_as_index',
  ],
  same_header_as_index: ['header', 'index'],
} as const;

const ROUTE_CLASSES: readonly RouteClass[] = ['safe', 'billed', 'keyed', 'once'];

type Json = Record<string, unknown>;

interface ScriptedResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  raw_body?: string;
  content_type?: string;
  network?: 'connect_refused' | 'read_timeout' | 'reset_after_send';
}

interface Case {
  name: string;
  request?: { method?: 'GET' | 'POST'; path?: string; body?: Json };
  responses: ScriptedResponse[];
  expect: Json;
  max_retries?: number;
  paginate?: string;
  next_page_limit?: number;
  mutate_request_after_first_page?: Json;
  /** The caller's request id, passed to the first call only. */
  request_id?: string;
  /** Overrides the class `spec/routes.json` gives the request's route. */
  route_class?: RouteClass;
}

interface Sent {
  body: Json;
  headers: Record<string, string>;
}

interface RouteEntry {
  method: string;
  path: string;
  class: RouteClass;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.json') ? [path] : [];
  });
}

const ROUTES = (JSON.parse(readFileSync(join(SPEC_DIR, 'routes.json'), 'utf8')) as { routes: RouteEntry[] })
  .routes;

/** The class of `method path`, matching `{template}` segments against any one segment. */
function routeClassOf(method: string, path: string): RouteClass {
  const route = ROUTES.find((entry) => {
    if (entry.method !== method) return false;
    const pattern = entry.path.replace(/\{[^}]+\}/g, '[^/]+');
    return new RegExp(`^${pattern}$`).test(path);
  });
  if (route === undefined) throw new Error(`spec/routes.json has no route for ${method} ${path}`);
  return route.class;
}

function unknownKeys(value: unknown, known: readonly string[], where: string): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.keys(value)
    .filter((key) => !known.includes(key))
    .map((key) => `unknown key '${key}' in ${where}`);
}

/** Every key the runner would otherwise ignore — a case it cannot honour in full is a failure. */
function unsupported(c: Case): string[] {
  const e = c.expect;
  const sent = (e.sent as Json[] | undefined) ?? [];
  return [
    ...unknownKeys(c, KNOWN_KEYS.case, 'the case'),
    ...unknownKeys(c.request, KNOWN_KEYS.request, 'request'),
    ...c.responses.flatMap((r, i) => unknownKeys(r, KNOWN_KEYS.response, `responses[${i}]`)),
    ...unknownKeys(e, KNOWN_KEYS.expect, 'expect'),
    ...unknownKeys(e.error, KNOWN_KEYS.error, 'expect.error'),
    ...unknownKeys(e.success, KNOWN_KEYS.success, 'expect.success'),
    ...sent.flatMap((s, i) => unknownKeys(s, KNOWN_KEYS.sent, `expect.sent[${i}]`)),
    ...sent.flatMap((s, i) =>
      unknownKeys(s.same_header_as_index, KNOWN_KEYS.same_header_as_index, `expect.sent[${i}].same_header_as_index`),
    ),
    ...(c.paginate !== undefined && c.paginate !== 'next_page'
      ? [`unknown paginate mode '${c.paginate}'`]
      : []),
    ...(c.route_class !== undefined && !ROUTE_CLASSES.includes(c.route_class)
      ? [`unknown route_class '${String(c.route_class)}'`]
      : []),
  ];
}

/** A `fetch` that replays `responses` in order (the last one repeats) and records what was sent. */
function scriptedFetch(responses: ScriptedResponse[], sent: Sent[]): typeof globalThis.fetch {
  return (_input, init) => {
    sent.push({
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Json) : {},
      headers: { ...(init?.headers as Record<string, string>) },
    });
    const spec = responses[Math.min(sent.length - 1, responses.length - 1)]!;
    switch (spec.network) {
      case 'connect_refused':
        return Promise.reject(networkError('ECONNREFUSED'));
      case 'reset_after_send':
        return Promise.reject(networkError('ECONNRESET'));
      case 'read_timeout':
        // Sent, and no answer: settles only when the SDK's timer aborts it.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('This operation was aborted', 'AbortError')),
          );
        });
      case undefined:
        break;
      default:
        return Promise.reject(new Error(`unknown network outcome '${String(spec.network)}'`));
    }
    const headers = { ...spec.headers };
    if (spec.raw_body !== undefined) {
      return Promise.resolve(
        new Response(spec.raw_body, {
          status: spec.status,
          headers: { 'content-type': spec.content_type ?? 'text/plain', ...headers },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(spec.body ?? null), {
        status: spec.status,
        headers: { 'content-type': 'application/json', ...headers },
      }),
    );
  };
}

/** Mutate in place, the way a caller editing their own object between pages would. */
function mutate(target: Json, changes: Json): void {
  for (const [key, value] of Object.entries(changes)) {
    const current = target[key];
    if (current !== null && typeof current === 'object' && value !== null && typeof value === 'object') {
      Object.assign(current, value);
    } else {
      target[key] = value;
    }
  }
}

async function exercise(c: Case, sent: Sent[]): Promise<{ page?: SearchEnvelope; raised?: unknown; noNextPage?: boolean }> {
  const method = c.request?.method ?? 'POST';
  const path = c.request?.path ?? '/v1/search';
  const routeClass = c.route_class ?? routeClassOf(method, path);
  const fetch = scriptedFetch(c.responses, sent);
  const maxRetries = c.max_retries ?? 2;
  const params: Json = structuredClone(c.request?.body ?? { query: 'fintech' });
  // `client.search` is billed by construction; a case that reclassifies the
  // route is run through the transport, which takes the class it is given.
  const isSearch = method === 'POST' && path === '/v1/search' && routeClass === 'billed';
  const client = new SproutsData({ apiKey: TEST_KEY, baseUrl: BASE_URL, fetch, maxRetries, timeoutMs: TIMEOUT_MS });
  // The first call's options; a page iterator decides what later pages get.
  const options = { requestId: c.request_id };

  try {
    if (c.paginate === 'next_page') {
      if (!isSearch) throw new Error(`paginate is only runnable on a billed POST /v1/search (got ${method} ${path})`);
      const pages = client.searchPages(params as SearchParams, { ...options, limit: c.next_page_limit });
      const first = await pages.next();
      if (c.mutate_request_after_first_page) mutate(params, c.mutate_request_after_first_page);
      const follow = await pages.next();
      return follow.done ? { page: first.value ?? undefined, noNextPage: true } : { page: follow.value };
    }
    if (isSearch) return { page: await client.search(params as SearchParams, options) };
    // Any other route goes through the transport — the client's generic
    // request path — with the class routes.json assigns it.
    const transport = new Transport({
      baseUrl: BASE_URL,
      apiKey: TEST_KEY,
      fetch,
      timeoutMs: TIMEOUT_MS,
      maxRetries,
      userAgent: 'sproutsdata-js/conformance',
      defaultHeaders: {},
    });
    const page =
      method === 'GET'
        ? await transport.request<SearchEnvelope>('GET', path, { options })
        : await transport.request<SearchEnvelope>('POST', path, { body: params, routeClass, options });
    return { page };
  } catch (raised) {
    return { raised };
  }
}

function checkError(e: Json, raised: unknown, fails: string[]): void {
  if (raised === undefined) {
    fails.push('expected an error, none raised');
    return;
  }
  const concept = e.concept as string | undefined;
  if (concept !== undefined) {
    const expected = CONCEPTS[concept];
    if (expected === undefined) fails.push(`unknown concept '${concept}'`);
    else if (!(raised instanceof expected)) {
      fails.push(`concept ${concept}: expected ${expected.name}, got ${(raised as Error).name}: ${(raised as Error).message}`);
    }
  }
  const notConcept = e.not_concept as string | undefined;
  if (notConcept !== undefined) {
    const excluded = CONCEPTS[notConcept];
    if (excluded === undefined) fails.push(`unknown concept '${notConcept}'`);
    else if (raised instanceof excluded) fails.push(`must not be ${excluded.name}`);
  }
  const apiError = raised instanceof APIError ? raised : undefined;
  if ('status' in e && apiError?.status !== e.status) fails.push(`status ${apiError?.status} != ${String(e.status)}`);
  if ('code' in e && apiError?.code !== e.code) fails.push(`code ${apiError?.code} != ${String(e.code)}`);
  if ('request_id' in e && apiError?.requestId !== e.request_id) {
    fails.push(`request_id ${apiError?.requestId} != ${String(e.request_id)}`);
  }
  if ('reached_server' in e) {
    const reached = raised instanceof APIConnectionError ? raised.reachedServer : undefined;
    if (reached !== e.reached_server) fails.push(`reached_server ${reached} != ${String(e.reached_server)}`);
  }
  for (const [field, value] of Object.entries((e.fields as Json | undefined) ?? {})) {
    if (!(raised instanceof InsufficientCreditsError)) {
      fails.push(`fields: ${field} is only readable on InsufficientCreditsError`);
      continue;
    }
    const accessors: Record<string, unknown> = {
      available: raised.available,
      required: raised.required,
      action_type: raised.actionType,
    };
    if (!(field in accessors)) fails.push(`fields: no accessor for '${field}'`);
    else if (accessors[field] !== value) fails.push(`field ${field}: ${String(accessors[field])} != ${String(value)}`);
  }
  if ('field_errors_length' in e && apiError?.fieldErrors.length !== e.field_errors_length) {
    fails.push(`field_errors length ${apiError?.fieldErrors.length} != ${String(e.field_errors_length)}`);
  }
}

function checkSuccess(s: Json, page: SearchEnvelope | undefined, fails: string[]): void {
  if (page === undefined) {
    fails.push('expected a result, got none');
    return;
  }
  const first = page.results[0];
  const checks: Array<[key: string, actual: unknown]> = [
    ['results_length', page.results.length],
    ['has_more', page.has_more],
    ['request_id', page.meta?.request_id],
    ['truncated', page.truncated],
    ['degraded', page.degradation.length > 0],
    ['first_category', first?.category],
    ['first_degradation_reason', page.degradation[0]?.reason],
    ['attribution_length', page.attribution.length],
    ['attribution_url_is_none', page.attribution[0] !== undefined && 'url' in page.attribution[0] && page.attribution[0].url === null],
  ];
  for (const [key, actual] of checks) {
    if (key in s && actual !== s[key]) fails.push(`success.${key}: ${String(actual)} != ${String(s[key])}`);
  }
  if ('hit_extra_field' in s) {
    const [name, value] = s.hit_extra_field as [string, unknown];
    if (first?.[name] !== value) fails.push(`hit_extra_field ${name}: ${String(first?.[name])} != ${String(value)}`);
  }
}

function checkSent(expected: Json[], sent: Sent[], fails: string[]): void {
  expected.forEach((spec, i) => {
    const request = sent[i];
    if (request === undefined) {
      fails.push(`request ${i} was never sent`);
      return;
    }
    const index = spec.body_equals_index;
    if (typeof index === 'number') {
      const ignored = new Set((spec.except_keys as string[] | undefined) ?? []);
      const strip = (body: Json) =>
        JSON.stringify(Object.fromEntries(Object.entries(body).filter(([k]) => !ignored.has(k)).sort()));
      const other = sent[index];
      if (other === undefined || strip(request.body) !== strip(other.body)) {
        fails.push(`request ${i} body changed between pages: ${JSON.stringify(request.body)}`);
      }
    }
    for (const key of ['cursor', 'limit'] as const) {
      if (key in spec && request.body[key] !== spec[key]) {
        fails.push(`request ${i} ${key}=${String(request.body[key])} != ${String(spec[key])}`);
      }
    }
    const names = new Set(Object.keys(request.headers).map((name) => name.toLowerCase()));
    for (const name of (spec.headers_absent as string[] | undefined) ?? []) {
      if (names.has(name.toLowerCase())) fails.push(`header ${name} must not be sent`);
    }
    for (const name of (spec.headers_present as string[] | undefined) ?? []) {
      if (!names.has(name.toLowerCase())) fails.push(`header ${name} missing`);
    }
    for (const [name, value] of Object.entries((spec.headers_equal as Record<string, string> | undefined) ?? {})) {
      const actual = headerValue(request, name);
      if (actual !== value) fails.push(`request ${i} header ${name}=${String(actual)} != ${value}`);
    }
    const same = spec.same_header_as_index as { header: string; index: number } | undefined;
    if (same !== undefined) {
      const actual = headerValue(request, same.header);
      const other = sent[same.index] === undefined ? undefined : headerValue(sent[same.index]!, same.header);
      if (actual === undefined || actual === '') fails.push(`request ${i} header ${same.header} missing or empty`);
      else if (actual !== other) {
        fails.push(`request ${i} header ${same.header}=${actual} != request ${same.index}'s ${String(other)}`);
      }
    }
  });
}

/** The value `request` sent under `name`, whatever casing either used. */
function headerValue(request: Sent, name: string): string | undefined {
  const key = Object.keys(request.headers).find((header) => header.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : request.headers[key];
}

async function runCase(c: Case): Promise<string[]> {
  const fails = unsupported(c);
  if (fails.length > 0) return fails;
  const e = c.expect;
  const sent: Sent[] = [];
  const { page, raised, noNextPage } = await exercise(c, sent);

  if ('attempts' in e && sent.length !== e.attempts) fails.push(`attempts: expected ${String(e.attempts)}, made ${sent.length}`);
  if (e.no_sleep === true && slept.length > 0) fails.push(`must not sleep, slept ${JSON.stringify(slept)}`);
  if ('slept' in e) {
    const want = e.slept as number[];
    const same = slept.length === want.length && slept.every((s, i) => Math.abs(s - want[i]!) < 0.05);
    if (!same) fails.push(`slept ${JSON.stringify(slept)}, expected ${JSON.stringify(want)}`);
  }
  if (e.no_next_page === true && !noNextPage) fails.push('expected no further page');
  if (c.paginate === 'next_page' && e.no_next_page !== true && noNextPage) fails.push('expected another page');

  if ('error' in e) checkError(e.error as Json, raised, fails);
  else if (raised !== undefined) fails.push(`unexpected error: ${(raised as Error).name}: ${(raised as Error).message}`);
  if ('success' in e && raised === undefined) checkSuccess(e.success as Json, page, fails);
  checkSent((e.sent as Json[] | undefined) ?? [], sent, fails);
  return fails;
}

const files = walk(CASES_DIR).sort();

describe('conformance', () => {
  beforeEach(() => {
    slept.length = 0;
  });

  it('finds the vendored cases', () => {
    expect(files.length).toBeGreaterThanOrEqual(42);
  });

  it.each(files.map((file) => [relative(CASES_DIR, file), file]))('%s', async (_name, file) => {
    const c = JSON.parse(readFileSync(file, 'utf8')) as Case;
    expect(await runCase(c)).toEqual([]);
  });
});

/**
 * HTTP transport: one place that knows about headers, timeouts, retries, and
 * how a problem body becomes a typed error. The client above it only builds
 * requests and types responses.
 *
 * Every request names its {@link RouteClass}: a `GET` is always `safe`, and
 * a `POST` must say what repeating it would cost, because that decides which
 * failures are retried (see `retry.ts`).
 */

import {
  FORBIDDEN_HEADERS,
  HEADER_CLIENT,
  HEADER_IDEMPOTENCY_KEY,
  HEADER_REQUEST_ID,
  HEADER_SOURCE,
  REQUEST_ID_PATTERN,
  SOURCE,
} from './constants';
import { normalizeBody } from './envelope';
import {
  APIConnectionError,
  APIError,
  APIResponseValidationError,
  APITimeoutError,
  APIUserAbortError,
  ClientValidationError,
  SproutsDataError,
} from './errors';
import { INSPECT_CUSTOM, inspectView, redactKey, type InspectFn } from './redact';
import { isSentNoAnswerStatus, provablyNotSent, retryDelayMs, shouldRetry, type RouteClass } from './retry';
import { newIdempotencyKey } from './runtime';
import { sleep } from './sleep';
import type { Problem } from './types';

export type { RouteClass } from './retry';

/** Per-request overrides accepted by every client method. */
export interface RequestOptions {
  /** Abort the request (and any pending retries) from the caller's side. */
  signal?: AbortSignal;
  /**
   * Time budget per attempt, in milliseconds, covering the response body as
   * well as the headers. Overrides the client default.
   */
  timeoutMs?: number;
  /**
   * Retry budget for this call. Overrides the client default. Retries follow
   * the route's class: a billed call that may have reached the server is
   * never repeated, whatever this says.
   */
  maxRetries?: number;
  /**
   * Your id for this request, sent as `X-Request-Id` and echoed back in
   * `meta.request_id` and on any error, so the request can be found in your
   * logs and the server's. 1–128 characters of letters, digits, `_`, `.`,
   * `:` and `-`; anything else is refused before sending, because the server
   * would silently replace it with its own id. A page iterator sends it with
   * the first page only: every request needs its own id.
   */
  requestId?: string;
  /**
   * Extra headers for this call. `X-API-Key`, `User-Agent`, `X-Dsp-Source` and SDK-set
   * headers such as a `runs.create` `Idempotency-Key` cannot be overridden,
   * in any casing; `Origin`, `Referer` and `X-SproutsData-Client` (set it with
   * the client's `integration` option) are refused. A raw `X-Request-Id` is
   * held to the same rule as `requestId`, which wins over it.
   */
  headers?: Record<string, string>;
}

/** Query-string values: a scalar, a list (repeated key), or omitted. */
export type QueryParams = Record<string, string | string[] | undefined>;

export interface TransportConfig {
  baseUrl: string;
  apiKey: string;
  fetch: typeof globalThis.fetch;
  timeoutMs: number;
  maxRetries: number;
  userAgent: string | undefined;
  defaultHeaders: Record<string, string>;
  /** Sent as `X-SproutsData-Client` when set; already validated. */
  integration?: string;
}

interface InitBase {
  query?: QueryParams;
  /** Headers set by client methods (typed parameters), not by callers. */
  headers?: Record<string, string>;
  options?: RequestOptions;
}

/** A `GET`: no body, and always `safe` to repeat. */
export type GetInit = InitBase;

/**
 * A `POST`, `PUT`, `PATCH` or `DELETE`: the class is required, because only the
 * caller knows what a repeat costs.
 */
export interface PostInit extends InitBase {
  body?: unknown;
  routeClass: RouteClass;
}

/** Every method other than `GET` — each one needs a route class. */
export type WriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A success whose body is not JSON — a CSV export — as the bytes and headers it came with. */
export interface RawResponse {
  status: number;
  /** Response headers, lower-cased keys. */
  headers: Record<string, string>;
  body: Uint8Array;
}

/** An open event stream, and how to let go of it. */
export interface OpenStream {
  response: Response;
  /**
   * Detach the caller's abort listener and close the connection. Call it
   * once the stream is consumed or abandoned; calling it twice is harmless.
   */
  release: () => void;
}

/**
 * Refuse `Origin` / `Referer` in any casing. Either one alongside an API key
 * is a `403 auth.browser_origin` before routing, so sending it could only
 * fail — and it would be a browser's header in a server's request.
 */
function assertNoForbiddenHeaders(
  headers: Record<string, string> | undefined,
  where: string,
): void {
  for (const name of Object.keys(headers ?? {})) {
    if (FORBIDDEN_HEADERS.includes(name.toLowerCase())) {
      throw new ClientValidationError(
        `Refusing to send a '${name}' header (in ${where}): the API rejects any ` +
          'key-authenticated request that carries one (403 auth.browser_origin). ' +
          'API keys are server-side credentials.',
      );
    }
  }
}

/**
 * Refuse `X-SproutsData-Client` in any casing. It has one way in — the
 * client's validated `integration` option — so a raw header can never
 * quietly disagree with it.
 */
function assertNoClientHeader(headers: Record<string, string> | undefined, where: string): void {
  for (const name of Object.keys(headers ?? {})) {
    if (name.toLowerCase() === HEADER_CLIENT.toLowerCase()) {
      throw new ClientValidationError(
        `Set the ${HEADER_CLIENT} header with the client's \`integration: '<name>/<version>'\` ` +
          `option, not through ${where}.`,
      );
    }
  }
}

const REQUEST_ID_RULE =
  "1-128 characters of A-Z, a-z, 0-9, '_', '.', ':' or '-'. The server silently replaces " +
  'anything else with its own id, which would break the correlation you are asking for.';

/** Refuse a request id the server would not keep (contract 02 §10). The value is not echoed. */
function assertRequestId(requestId: unknown, what: string): void {
  if (typeof requestId === 'string' && REQUEST_ID_PATTERN.test(requestId)) return;
  throw new ClientValidationError(`${what} must be ${REQUEST_ID_RULE}`);
}

/** Hold a raw `X-Request-Id` header, in any casing, to the `requestId` rule. */
function assertRawRequestIds(headers: Record<string, string> | undefined, where: string): void {
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() === HEADER_REQUEST_ID.toLowerCase()) {
      assertRequestId(value, `The '${name}' header (in ${where})`);
    }
  }
}

/**
 * Refuse a header `fetch` would reject (a newline in a value, a space in a
 * name) before the first attempt. Such a request can never be sent, so it
 * is a local mistake, not a network failure to retry. The value is never
 * echoed: it may be a credential.
 */
function assertSendableHeaders(headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    try {
      new Headers([[name, value]]);
    } catch {
      throw new ClientValidationError(
        `Header '${name.replace(/[^\x21-\x7e]/g, '?')}' cannot be sent: header names must be ` +
          'tokens, and values must not contain newlines or other control characters.',
      );
    }
  }
}

/**
 * Headers merged by name, case-insensitively: a later `set` replaces an
 * earlier one whatever either's casing, and the later casing is the one sent.
 * This is what keeps a caller's lowercase `x-api-key` from riding along
 * beside the SDK's `X-API-Key`.
 */
class HeaderMap {
  private readonly entries = new Map<string, [name: string, value: string]>();

  set(name: string, value: string): void {
    this.entries.set(name.toLowerCase(), [name, value]);
  }

  has(name: string): boolean {
    return this.entries.has(name.toLowerCase());
  }

  merge(headers: Record<string, string> | undefined): void {
    for (const [name, value] of Object.entries(headers ?? {})) this.set(name, value);
  }

  toObject(): Record<string, string> {
    return Object.fromEntries(this.entries.values());
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

/** undici reports `redirect: 'error'` as a `TypeError` whose cause says "unexpected redirect". */
function isRefusedRedirect(err: unknown): boolean {
  const cause = err instanceof Error ? err.cause : undefined;
  return cause instanceof Error && /redirect/i.test(cause.message);
}

/**
 * Errors no retry can change, whatever the route: a refused redirect is the
 * server's answer (a 3xx), and it would be refused again. Kept by identity so
 * the error stays an ordinary `APIConnectionError` to the caller.
 */
const finalErrors = new WeakSet<SproutsDataError>();

function redirectRefused(url: URL, location?: string | null, cause?: unknown): APIConnectionError {
  const target = location ? ` to ${location}` : '';
  const err = new APIConnectionError(
    `Request to ${url.host} was redirected${target}. Redirects are refused, so ` +
      'the API key is never forwarded to another origin — check `baseUrl` ' +
      '(it must be the API origin itself, not a URL that redirects to it).',
    { cause, reachedServer: true },
  );
  finalErrors.add(err);
  return err;
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** A problem body, or undefined when it is not a JSON object — a proxy or LB answered. */
function parseProblem(text: string): Problem | undefined {
  try {
    const body: unknown = JSON.parse(text);
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) return body as Problem;
  } catch {
    // Not JSON. Fall through to a bare status error.
  }
  return undefined;
}

/**
 * What a failure on a route that is not repeated after sending might have
 * done. Appended to connection errors that may have reached the server.
 */
function sentNote(routeClass: RouteClass): string {
  if (routeClass === 'billed') {
    return ' The request may have reached the server and been charged, so it was not retried.';
  }
  if (routeClass === 'once') {
    return ' The request may have reached the server and been recorded, so it was not retried.';
  }
  return '';
}

/**
 * The error to throw, told what it means that it was not repeated. A 502 or
 * 408 on a billed or feedback route is the HTTP form of "sent, no answer":
 * the caller has something to reconcile, so the message says so instead of
 * leaving it to `reachedServer`. Connection failures already carry the note.
 */
function withConsequence(err: unknown, routeClass: RouteClass): unknown {
  if (err instanceof APIError && isSentNoAnswerStatus(err)) {
    const note = sentNote(routeClass);
    if (note && !err.message.endsWith(note)) err.message += note;
  }
  return err;
}

/**
 * The typed error for a `fetch` that rejected. `timedOut` means the SDK's own
 * per-attempt timer fired; the caller's abort is handled before this.
 */
function connectionFailure(
  err: unknown,
  url: URL,
  routeClass: RouteClass,
  timedOut: boolean,
  timeoutMs: number,
): SproutsDataError {
  if (isRefusedRedirect(err)) return redirectRefused(url, undefined, err);
  if (timedOut) {
    return new APITimeoutError(`Request timed out after ${timeoutMs}ms.${sentNote(routeClass)}`, {
      timeoutMs,
      cause: err,
    });
  }
  const reason = err instanceof Error ? err.message : String(err);
  if (provablyNotSent(err)) {
    return new APIConnectionError(`Could not connect to ${url.host}: ${reason}`, {
      cause: err,
      reachedServer: false,
    });
  }
  return new APIConnectionError(`Request to ${url.host} failed: ${reason}.${sentNote(routeClass)}`, {
    cause: err,
    reachedServer: true,
  });
}

/** One attempt's lifetime: its abort controller, its timer, and the caller's signal wired in. */
class Attempt {
  readonly controller = new AbortController();
  timedOut = false;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly onAbort = () => this.controller.abort();

  constructor(
    timeoutMs: number,
    private readonly signal: AbortSignal | undefined,
  ) {
    this.timer = setTimeout(() => {
      this.timedOut = true;
      this.controller.abort();
    }, timeoutMs);
    signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  /** The per-attempt timer is done; the caller's signal stays wired to the connection. */
  stopTimer(): void {
    clearTimeout(this.timer);
  }

  /** Let go of everything: timer, caller listener, connection. */
  close(): void {
    clearTimeout(this.timer);
    this.signal?.removeEventListener('abort', this.onAbort);
    this.controller.abort();
  }
}

export class Transport {
  // `#private`, not TypeScript `private`: an ECMAScript private field is
  // invisible to `JSON.stringify`, `util.inspect`, `Object.keys` and spread.
  readonly #apiKey: string;
  private readonly config: Omit<TransportConfig, 'apiKey'>;

  constructor(config: TransportConfig) {
    const { apiKey, ...rest } = config;
    assertNoForbiddenHeaders(rest.defaultHeaders, '`defaultHeaders`');
    assertNoClientHeader(rest.defaultHeaders, '`defaultHeaders`');
    assertRawRequestIds(rest.defaultHeaders, '`defaultHeaders`');
    this.#apiKey = apiKey;
    this.config = rest;
  }

  /** What `JSON.stringify` shows: the configuration, with the key redacted. */
  toJSON(): Record<string, unknown> {
    return {
      baseUrl: this.config.baseUrl,
      apiKey: redactKey(this.#apiKey),
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
    };
  }

  [INSPECT_CUSTOM](_depth: number, options: unknown, inspect?: InspectFn): unknown {
    return inspectView('Transport', this.toJSON(), options, inspect);
  }

  // A list value is repeated (`?k=a&k=b`), which is how FastAPI reads a
  // `list[str]` query parameter.
  private buildUrl(path: string, query?: QueryParams): URL {
    const url = new URL(this.config.baseUrl.replace(/\/+$/, '') + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) url.searchParams.append(key, item);
        } else {
          url.searchParams.set(key, value);
        }
      }
    }
    return url;
  }

  // Precedence, lowest first, merged case-insensitively: the defaults, the
  // caller's `options.headers`, method-supplied headers (`extra` — so a typed
  // parameter like `idempotencyKey` cannot be shadowed by a raw header), then
  // the protected ones, which nothing overrides in any casing.
  //
  // Called once per logical call, before the first attempt, so a generated
  // `Idempotency-Key` is the same on every retry of that call.
  private buildHeaders(
    accept: string,
    extra: Record<string, string> | undefined,
    options: RequestOptions | undefined,
    routeClass: RouteClass,
    hasBody: boolean,
  ): Record<string, string> {
    assertNoForbiddenHeaders(options?.headers, '`options.headers`');
    assertNoClientHeader(options?.headers, '`options.headers`');
    assertRawRequestIds(options?.headers, '`options.headers`');
    if (options?.requestId !== undefined) assertRequestId(options.requestId, '`requestId`');
    const headers = new HeaderMap();
    headers.set('Accept', accept);
    headers.merge(this.config.defaultHeaders);
    headers.merge(options?.headers);
    headers.merge(extra);
    // A billed route recognises a same-day repeat by this key when it returns
    // the same rows (contract 02 §4), so one key per call, resent on that
    // call's retries, keeps a recognised repeat from paying twice.
    if (routeClass === 'billed' && !headers.has(HEADER_IDEMPOTENCY_KEY)) {
      headers.set(HEADER_IDEMPOTENCY_KEY, newIdempotencyKey());
    }
    if (options?.requestId !== undefined) headers.set(HEADER_REQUEST_ID, options.requestId);
    headers.set('X-API-Key', this.#apiKey);
    if (this.config.userAgent !== undefined) headers.set('User-Agent', this.config.userAgent);
    if (this.config.integration !== undefined) headers.set(HEADER_CLIENT, this.config.integration);
    headers.set(HEADER_SOURCE, SOURCE);
    if (hasBody) headers.set('Content-Type', 'application/json');
    const result = headers.toObject();
    assertSendableHeaders(result);
    return result;
  }

  /**
   * Run `attempt` until it succeeds, the route's class forbids another try,
   * or the retry budget is spent. Waits between attempts are abortable.
   */
  private async withRetries<T>(
    routeClass: RouteClass,
    options: RequestOptions | undefined,
    attempt: () => Promise<T>,
  ): Promise<T> {
    const maxRetries = options?.maxRetries ?? this.config.maxRetries;
    for (let retry = 0; ; retry++) {
      if (options?.signal?.aborted) throw new APIUserAbortError();
      try {
        return await attempt();
      } catch (err) {
        if (
          !(err instanceof SproutsDataError) ||
          finalErrors.has(err) ||
          retry >= maxRetries ||
          !shouldRetry(err, routeClass)
        ) {
          throw withConsequence(err, routeClass);
        }
        await sleep(retryDelayMs(err, retry + 1), options?.signal);
      }
    }
  }

  /** Send a `GET`. It is always `safe`: repeating it costs nothing. */
  request<T>(method: 'GET', path: string, init?: GetInit): Promise<T>;
  /** Send a `POST`, `PUT`, `PATCH` or `DELETE` of the given route class. A `204` resolves to `undefined`. */
  request<T>(method: WriteMethod, path: string, init: PostInit): Promise<T>;
  async request<T>(method: 'GET' | WriteMethod, path: string, init: GetInit | PostInit = {}): Promise<T> {
    return (await this.send(method, path, init, false)) as T;
  }

  /**
   * Send a write whose success body is not JSON — a CSV export — and resolve
   * with its bytes and headers. A failure is still a problem document and is
   * mapped, retried and annotated exactly as `request` does.
   */
  requestBytes(method: WriteMethod, path: string, init: PostInit): Promise<RawResponse> {
    return this.send(method, path, init, true) as Promise<RawResponse>;
  }

  private async send(
    method: 'GET' | WriteMethod,
    path: string,
    init: GetInit | PostInit,
    raw: boolean,
  ): Promise<unknown> {
    const { query, options } = init;
    const routeClass: RouteClass = 'routeClass' in init ? init.routeClass : 'safe';
    const body = 'body' in init ? init.body : undefined;
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs;

    const url = this.buildUrl(path, query);
    const accept = raw ? 'text/csv, application/problem+json' : 'application/json';
    const headers = this.buildHeaders(accept, init.headers, options, routeClass, body !== undefined);
    const serializedBody = serializeBody(body);

    return this.withRetries(routeClass, options, async () => {
      const attempt = new Attempt(timeoutMs, options?.signal);
      try {
        let response: Response;
        let text = '';
        let bytes: Uint8Array | undefined;
        try {
          response = await this.config.fetch(url.toString(), {
            method,
            headers,
            body: serializedBody,
            // Following a redirect would re-send `X-API-Key` to wherever it points.
            redirect: 'error',
            signal: attempt.controller.signal,
          });
          // A custom `fetch` may ignore `redirect: 'error'` and hand the 3xx back.
          if (isRedirect(response.status)) {
            throw redirectRefused(url, response.headers.get('location'));
          }
          // Still inside the attempt's timer and abort wiring: a body that
          // stalls mid-read times out like headers that never came.
          if (raw && response.ok) bytes = new Uint8Array(await response.arrayBuffer());
          else text = await response.text();
        } catch (err) {
          if (err instanceof SproutsDataError) throw err;
          if (options?.signal?.aborted) throw new APIUserAbortError();
          throw connectionFailure(err, url, routeClass, attempt.timedOut, timeoutMs);
        }

        const responseHeaders = headersToObject(response.headers);
        if (!response.ok) throw APIError.from(response.status, parseProblem(text), responseHeaders);
        if (bytes !== undefined) {
          return { status: response.status, headers: responseHeaders, body: bytes } satisfies RawResponse;
        }
        if (response.status === 204) return undefined;

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          throw new APIResponseValidationError(
            `The response from ${url.pathname} (status ${response.status}) is not valid JSON.`,
            { status: response.status, requestId: responseHeaders['x-request-id'], cause: err },
          );
        }
        normalizeBody(parsed, response.headers.get('x-request-id'));
        return parsed;
      } finally {
        attempt.close();
      }
    });
  }

  /**
   * Open a server-sent-events stream (GET only, so `safe`) and resolve once
   * response headers are in; the caller consumes `response.body` and calls
   * `release` when done.
   *
   * Retries and `timeoutMs` apply only to the connection phase — a run
   * streams for minutes, so a per-attempt timeout mid-stream would kill every
   * healthy stream (the reader applies its own idle timeout instead). After
   * headers, the caller's `signal` stays wired to the connection until
   * `release`.
   */
  async requestStream(path: string, init: GetInit = {}): Promise<OpenStream> {
    const { query, options } = init;
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs;

    const url = this.buildUrl(path, query);
    const headers = this.buildHeaders('text/event-stream', init.headers, options, 'safe', false);

    return this.withRetries('safe', options, async () => {
      const attempt = new Attempt(timeoutMs, options?.signal);
      let response: Response;
      let problemText: string;
      try {
        response = await this.config.fetch(url.toString(), {
          method: 'GET',
          headers,
          redirect: 'error',
          signal: attempt.controller.signal,
        });
        if (isRedirect(response.status)) {
          throw redirectRefused(url, response.headers.get('location'));
        }
        if (response.ok) {
          attempt.stopTimer();
          return { response, release: () => attempt.close() };
        }
        problemText = await response.text();
      } catch (err) {
        attempt.close();
        if (err instanceof SproutsDataError) throw err;
        if (options?.signal?.aborted) throw new APIUserAbortError();
        throw connectionFailure(err, url, 'safe', attempt.timedOut, timeoutMs);
      }
      attempt.close();
      throw APIError.from(response.status, parseProblem(problemText), headersToObject(response.headers));
    });
  }
}

/** JSON-encode a request body before the first attempt; a body that cannot be encoded is a local mistake. */
function serializeBody(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  try {
    return JSON.stringify(body);
  } catch (err) {
    throw new ClientValidationError(
      `The request body cannot be sent as JSON: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

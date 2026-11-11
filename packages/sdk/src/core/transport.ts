/**
 * The transport: requests on the wire, retried as the policy says.
 *
 * Every decision is made elsewhere in `core/` (what to send, whether to retry, how to read
 * the answer); this module performs it: one `fetch` per attempt, each with its own timer
 * and the caller's abort signal wired in, redirects refused so the key never leaves the
 * API's origin, and the key held in a `#private` field that neither `JSON.stringify` nor
 * `util.inspect` shows (`toJSON` reports it redacted).
 */

import { DEFAULTS } from '../generated/defaults.js';
import type { OperationSpec } from '../generated/operations.js';
import { readAnswer, type Answer, type AnswerMeta } from './answer.js';
import { SYSTEM_CLOCK, type Clock } from './clock.js';
import {
  APIConnectionError,
  APITimeoutError,
  APIUserAbortError,
  ClientValidationError,
  RedirectRefusedError,
  SproutsDataError,
} from './errors.js';
import { lowered } from './headers.js';
import type { ResolvedOptions } from './options.js';
import { decodeErrorBody, errorFromAnswer } from './problem.js';
import { redactKey } from './redact.js';
import { buildHeaders, buildUrl, fillPath, type CallOptions, type Query } from './request.js';
import { backoffMs, consequence, decide, provablyNotSent } from './retry.js';
import { readEvents, type ServerSentEvent } from './sse.js';

/** An operation, with its SDK name. */
export type Operation = OperationSpec & { readonly name: string };

/** Per-call options accepted by every client method. */
export interface RequestOptions extends CallOptions {
  /** Abort the call (and any retry it is waiting for). */
  readonly signal?: AbortSignal;
  /** Milliseconds each attempt may take, body included. */
  readonly timeoutMs?: number;
  /** Retries for this call (the operation's route class still decides which failures). */
  readonly maxRetries?: number;
  /** Called with the request id, headers and rate limit of every successful answer. */
  readonly onResponse?: (meta: AnswerMeta) => void;
}

/** What a call sends besides its options. */
export interface CallInput {
  readonly path?: Readonly<Record<string, unknown>> | undefined;
  readonly query?: Query | undefined;
  readonly body?: unknown;
}

export class Transport {
  readonly #apiKey: string;
  readonly #options: Omit<ResolvedOptions, 'apiKey'>;
  readonly #clock: Clock;

  constructor(options: ResolvedOptions, clock: Clock = SYSTEM_CLOCK) {
    const { apiKey, ...rest } = options;
    this.#apiKey = apiKey;
    this.#options = rest;
    this.#clock = clock;
  }

  /** The clock this transport waits on: a `wait` polls on it too. */
  get clock(): Clock {
    return this.#clock;
  }

  /** What `JSON.stringify` shows: the configuration, with the key redacted. */
  toJSON(): Record<string, unknown> {
    return { baseUrl: this.#options.baseUrl, apiKey: redactKey(this.#apiKey), timeoutMs: this.#options.timeoutMs, maxRetries: this.#options.maxRetries };
  }

  /**
   * One logical call: the attempts its route class allows, then an answer or the last
   * error. Every retry resends the same request, idempotency key included.
   */
  async send(operation: Operation, input: CallInput = {}, options: RequestOptions = {}): Promise<Answer> {
    const { url, headers, body } = this.#prepare(operation, input, options);
    const maxRetries = options.maxRetries ?? this.#options.maxRetries;
    for (let attempt = 1; ; attempt++) {
      if (options.signal?.aborted === true) throw new APIUserAbortError();
      try {
        const answer = await this.#attempt(operation, url, headers, body, options);
        options.onResponse?.(answer.meta);
        return answer;
      } catch (err) {
        if (!retryable(err, attempt, maxRetries, operation)) throw withConsequence(err, operation);
        const wait = backoffMs(attempt, retryAfterOf(err), () => this.#clock.random());
        await this.#clock.sleep(wait, options.signal);
      }
    }
  }

  #prepare(operation: Operation, input: CallInput, options: RequestOptions): { url: URL; headers: Record<string, string>; body: string | undefined } {
    const url = buildUrl(this.#options.baseUrl, fillPath(operation.path, input.path ?? {}), input.query);
    const body = serialise(input.body);
    const headers = buildHeaders(operation, this.#apiKey, this.#options.defaultHeaders, options, body !== undefined);
    return { url, headers, body };
  }

  async #attempt(
    operation: Operation,
    url: URL,
    headers: Record<string, string>,
    body: string | undefined,
    options: RequestOptions,
  ): Promise<Answer> {
    const timeoutMs = options.timeoutMs ?? this.#options.timeoutMs;
    const attempt = new Attempt(timeoutMs, options.signal);
    try {
      const response = await this.#fetch(url, { method: operation.method, headers, body, signal: attempt.signal }, attempt, timeoutMs, options);
      // Still inside the attempt's timer: a body that stalls mid-read times out too.
      const text = await response.text();
      const responseHeaders = lowered(response.headers);
      if (!response.ok) throw errorFromAnswer(response.status, responseHeaders, decodeErrorBody(text), this.#clock.now());
      return readAnswer(operation.name, operation.response, response.status, responseHeaders, text);
    } catch (err) {
      throw failure(err, attempt, timeoutMs, options.signal);
    } finally {
      attempt.close();
    }
  }

  /** One `fetch`, with redirects refused however the `fetch` reports them. */
  async #fetch(
    url: URL,
    init: { method: string; headers: Record<string, string>; body: string | undefined; signal: AbortSignal },
    attempt: Attempt,
    timeoutMs: number,
    options: RequestOptions,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.#options.fetch(url.toString(), { ...init, body: init.body ?? null, redirect: 'error' });
    } catch (err) {
      throw failure(err, attempt, timeoutMs, options.signal);
    }
    // A custom fetch may ignore `redirect: 'error'` and hand the 3xx back.
    if (response.status >= 300 && response.status < 400) {
      throw errorFromAnswer(response.status, lowered(response.headers), undefined, this.#clock.now());
    }
    return response;
  }

  /**
   * The events of a server-sent stream, as they arrive. Not retried once open: a stream that
   * breaks, or goes quiet past the idle timeout, throws with `lastEventId` set.
   */
  async *stream(operation: Operation, input: CallInput = {}, options: RequestOptions = {}): AsyncGenerator<ServerSentEvent, void, undefined> {
    const { url, headers } = this.#prepare(operation, { ...input, body: undefined }, options);
    const timeoutMs = options.timeoutMs ?? this.#options.timeoutMs;
    const attempt = new Attempt(timeoutMs, options.signal);
    try {
      const response = await this.#fetch(url, { method: operation.method, headers, body: undefined, signal: attempt.signal }, attempt, timeoutMs, options);
      if (!response.ok || response.body === null) {
        const text = await response.text();
        throw errorFromAnswer(response.status, lowered(response.headers), decodeErrorBody(text), this.#clock.now());
      }
      attempt.stopTimer(); // a stream runs for minutes: the idle timeout guards it instead
      yield* readEvents(response.body, { idleTimeoutMs: DEFAULTS.streamIdleTimeoutMs, signal: options.signal });
    } finally {
      attempt.close();
    }
  }
}

/** One attempt's lifetime: its abort controller and timer, with the caller's signal wired in. */
class Attempt {
  readonly #controller = new AbortController();
  readonly #timer: ReturnType<typeof setTimeout>;
  readonly #caller: AbortSignal | undefined;
  readonly #onAbort = (): void => {
    this.#controller.abort();
  };

  timedOut = false;

  constructor(timeoutMs: number, caller: AbortSignal | undefined) {
    this.#caller = caller;
    this.#timer = setTimeout(() => {
      this.timedOut = true;
      this.#controller.abort();
    }, timeoutMs);
    caller?.addEventListener('abort', this.#onAbort, { once: true });
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  stopTimer(): void {
    clearTimeout(this.#timer);
  }

  close(): void {
    clearTimeout(this.#timer);
    this.#caller?.removeEventListener('abort', this.#onAbort);
    this.#controller.abort();
  }
}

/** Whether a failed attempt may be repeated: an SDK error, within the budget, that the policy retries. */
function retryable(err: unknown, attempt: number, maxRetries: number, operation: Operation): err is SproutsDataError {
  return err instanceof SproutsDataError && attempt <= maxRetries && decide(err, operation.routeClass) === 'retry';
}

/** The seconds a failure's answer asked the caller to wait, when it said. */
function retryAfterOf(err: SproutsDataError): number | undefined {
  return 'retryAfter' in err && typeof err.retryAfter === 'number' ? err.retryAfter : undefined;
}

/** The typed error for a failed attempt (an SDK error passes through unchanged). */
function failure(err: unknown, attempt: Attempt, timeoutMs: number, caller: AbortSignal | undefined): unknown {
  if (err instanceof SproutsDataError) return err;
  if (caller?.aborted === true) return new APIUserAbortError();
  if (refusedRedirect(err)) {
    return new RedirectRefusedError(
      'The server answered with a redirect, which this client never follows (it would send your API key ' +
        'there). Check baseUrl: it must be the API origin itself.',
      { cause: err },
    );
  }
  if (attempt.timedOut) return new APITimeoutError(`The request timed out after ${String(timeoutMs)}ms.`, { timeoutMs, cause: err });
  const reason = err instanceof Error ? err.message : String(err);
  if (provablyNotSent(err)) return new APIConnectionError(`Could not connect to the Sprouts Data API: ${reason}`, { cause: err, reachedServer: false });
  return new APIConnectionError(`The request to the Sprouts Data API failed: ${reason}`, { cause: err, reachedServer: true });
}

/** undici reports `redirect: 'error'` as a `TypeError` whose cause says "unexpected redirect". */
function refusedRedirect(err: unknown): boolean {
  return err instanceof Error && err.cause instanceof Error && /redirect/i.test(err.cause.message);
}

/** The error to throw, told what it means that it was not repeated. */
function withConsequence(err: unknown, operation: Operation): unknown {
  if (!(err instanceof SproutsDataError)) return err;
  const note = consequence(err, operation.routeClass);
  if (note !== undefined && !err.message.endsWith(note)) err.message = `${err.message} ${note}`;
  return err;
}

/** A request body as JSON, before the first attempt: a body that cannot be encoded is a local mistake. */
function serialise(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  try {
    return JSON.stringify(body);
  } catch (err) {
    throw new ClientValidationError(`The request body cannot be sent as JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

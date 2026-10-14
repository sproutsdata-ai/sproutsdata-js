/**
 * Error hierarchy.
 *
 * Everything the SDK throws is a `SproutsDataError`, split into these families:
 *
 * - `ClientValidationError` — the request never left the process; fix the call.
 * - `APIConnectionError` / `APITimeoutError` / `APIUserAbortError` — no
 *   response was received. `reachedServer` says whether the request may have
 *   arrived anyway (and so been charged, or filed).
 * - `APIResponseValidationError` — a success status with a body the SDK
 *   cannot parse.
 * - `RunWaitTimeoutError` — `runs.wait` passed its deadline.
 * - `APIError` and its subclasses — the server answered with an RFC 9457
 *   problem. `code` carries the machine-readable reason and `requestId` is
 *   the handle for a support conversation.
 *
 * An `APIError`'s class is chosen by its `code` first (the table generated
 * from `spec/error-codes.json`), then by its HTTP status, then `APIError`
 * itself — so a code or status this release has never seen still maps, and
 * mapping never throws.
 */

import { CODE_CONCEPTS, STATUS_CONCEPTS, type ErrorConcept } from './error-codes.gen';
import type { AgentRunResult } from './runs';
import type { Problem } from './types';

/** Base class for every error this SDK throws. */
export class SproutsDataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The request was rejected client-side and was never sent. */
export class ClientValidationError extends SproutsDataError {}

/** No response was received. */
export class APIConnectionError extends SproutsDataError {
  /**
   * False only when the request provably never left this process
   * (connection refused, DNS failure, connect timeout). True means it may
   * have reached the server: on a billed route that is a possible charge,
   * on `feedback.create` a possibly filed report, which is why neither is
   * retried after one.
   */
  readonly reachedServer: boolean;

  constructor(message: string, options: { cause?: unknown; reachedServer?: boolean } = {}) {
    super(message, { cause: options.cause });
    this.reachedServer = options.reachedServer ?? true;
  }
}

/**
 * A time budget ran out: a request's `timeoutMs`, or the event stream's idle
 * timeout. The request was sent, so `reachedServer` is true.
 */
export class APITimeoutError extends APIConnectionError {
  /** The budget that ran out, in milliseconds. */
  readonly timeoutMs: number;
  /**
   * On an event stream, the last event id received — pass it back as
   * `lastEventId` to resume without replaying. Undefined elsewhere, and when
   * no event had arrived.
   */
  readonly lastEventId: string | undefined;

  constructor(
    message: string,
    options: { timeoutMs: number; lastEventId?: string; cause?: unknown },
  ) {
    super(message, { cause: options.cause, reachedServer: true });
    this.timeoutMs = options.timeoutMs;
    this.lastEventId = options.lastEventId;
  }
}

/** The caller's own `AbortSignal` fired. Never retried. */
export class APIUserAbortError extends SproutsDataError {
  constructor() {
    super('Request was aborted by the caller');
  }
}

/**
 * The server answered with a success status, but the body is not the JSON
 * the SDK expected. The request was processed — and, on a billed route,
 * charged — so it is not retried.
 */
export class APIResponseValidationError extends SproutsDataError {
  readonly status: number;
  /** From the `X-Request-Id` header, when there was one. */
  readonly requestId: string | undefined;

  constructor(
    message: string,
    options: { status: number; requestId: string | undefined; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

/**
 * `runs.wait` reached its deadline before the run finished. The run carries
 * on server-side; `run` is its last polled state, and waiting again resumes
 * where this left off.
 */
export class RunWaitTimeoutError extends SproutsDataError {
  /** The run as the last poll returned it. */
  readonly run: AgentRunResult;
  /** The deadline that passed, in milliseconds. */
  readonly timeoutMs: number;

  constructor(run: AgentRunResult, timeoutMs: number) {
    super(
      `Run ${run.run_id} did not finish within ${timeoutMs}ms; it is still running. ` +
        'Call runs.wait again to keep waiting, or runs.cancel to stop it.',
    );
    this.run = run;
    this.timeoutMs = timeoutMs;
  }
}

/** One entry of a 422's `extra.errors`: where the problem is, and what. */
export interface FieldError {
  /** Path to the field, e.g. `['body', 'filters', 'industry']`. */
  loc: Array<string | number>;
  msg: string;
  /** The validator's error type, when the server sent one. */
  type?: string;
}

/** `extra.errors`, keeping only well-formed entries; never throws. */
function readFieldErrors(problem: Problem | undefined): FieldError[] {
  const raw = problem?.extra?.errors;
  if (!Array.isArray(raw)) return [];
  const out: FieldError[] = [];
  for (const entry of raw as unknown[]) {
    if (entry === null || typeof entry !== 'object') continue;
    const { loc, msg, type } = entry as Record<string, unknown>;
    if (!Array.isArray(loc) || typeof msg !== 'string') continue;
    const path = loc.filter(
      (part): part is string | number => typeof part === 'string' || typeof part === 'number',
    );
    out.push(typeof type === 'string' ? { loc: path, msg, type } : { loc: path, msg });
  }
  return out;
}

/**
 * Seconds from a `Retry-After` header — delta-seconds or an HTTP date —
 * or undefined when absent or unparseable. A date in the past is 0.
 */
export function parseRetryAfter(raw: string | undefined, now: number = Date.now()): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, (date - now) / 1_000);
}

/** A non-2xx response, parsed from the `application/problem+json` body. */
export class APIError extends SproutsDataError {
  /** HTTP status. */
  readonly status: number;
  /** Machine-readable code from the closed set — see {@link ErrorCode}. */
  readonly code: string | undefined;
  readonly title: string | undefined;
  readonly detail: string | undefined;
  /**
   * Quote this when contacting support. The `X-Request-Id` header first,
   * then the body's `request_id` — an unhandled server error may carry it
   * only in the body.
   */
  readonly requestId: string | undefined;
  /** The full problem body, including `extra`. Undefined when the body was not JSON. */
  readonly problem: Problem | undefined;
  /** Response headers, lower-cased keys. */
  readonly headers: Record<string, string>;
  /** Per-field detail from `extra.errors` (422s); empty when there is none. */
  readonly fieldErrors: FieldError[];
  /**
   * The parsed `Retry-After` header, in seconds, when the server sent one.
   * Above 60 s the SDK raises instead of retrying, so this is when to come
   * back.
   */
  readonly retryAfter: number | undefined;
  /**
   * A response came back, so the request was sent — to the service, or to a
   * proxy in front of it. Mirrors {@link APIConnectionError.reachedServer},
   * so "may this have been acted on" is one property whatever was thrown.
   */
  readonly reachedServer = true as const;

  constructor(status: number, problem: Problem | undefined, headers: Record<string, string>) {
    const requestId = headers['x-request-id'] ?? problem?.request_id ?? undefined;
    const fieldErrors = readFieldErrors(problem);
    super(APIError.describe(status, problem, requestId, fieldErrors));
    this.status = status;
    this.problem = problem;
    this.code = typeof problem?.code === 'string' ? problem.code : undefined;
    this.title = problem?.title;
    this.detail = problem?.detail ?? undefined;
    this.requestId = requestId;
    this.headers = headers;
    this.fieldErrors = fieldErrors;
    this.retryAfter = parseRetryAfter(headers['retry-after']);
  }

  private static describe(
    status: number,
    problem: Problem | undefined,
    requestId: string | undefined,
    fieldErrors: FieldError[],
  ): string {
    const parts = [`${status}`];
    if (typeof problem?.code === 'string') parts.push(problem.code);
    let message = parts.join(' ');
    if (problem?.title) message += `: ${problem.title}`;
    if (problem?.detail) message += ` — ${problem.detail}`;
    if (fieldErrors.length > 0) {
      message += ` — ${fieldErrors.map((e) => `${e.loc.join('.')}: ${e.msg}`).join('; ')}`;
    }
    if (requestId) message += ` (request_id: ${requestId})`;
    return message;
  }

  /** Build the subclass for a response: by `code`, then by status, then `APIError`. */
  static from(status: number, problem: Problem | undefined, headers: Record<string, string>): APIError {
    const code = typeof problem?.code === 'string' ? problem.code : undefined;
    const concept =
      (code === undefined ? undefined : CODE_CONCEPTS.get(code)) ?? STATUS_CONCEPTS.get(status) ??
      (status === 400 ? 'invalid_request' : undefined);
    const ErrorClass = concept === undefined ? APIError : CONCEPT_CLASSES[concept];
    return new ErrorClass(status, problem, headers);
  }
}

/** 400/415/422 — the request shape or values were refused. `fieldErrors` says where. */
export class InvalidRequestError extends APIError {}

/** `pagination.cursor_invalid` — the request changed between pages, or the cursor is malformed. */
export class CursorInvalidError extends InvalidRequestError {}

/** `pagination.cursor_expired` — the cursor is over 24 hours old. Run the search again. */
export class CursorExpiredError extends InvalidRequestError {}

/**
 * `pagination.depth_exceeded` — past the 10,000-row paging cap. Narrow the
 * search instead; the `*Pages` iterators stop at the cap rather than hit it.
 */
export class PaginationDepthExceededError extends InvalidRequestError {}

/** 401 — missing, unknown, revoked, or expired API key. */
export class AuthenticationError extends APIError {}

/**
 * 402 — the tenant's credit allocation is exhausted (`credits.insufficient`).
 * Waiting does not help; buying or reallocating credits does.
 */
export class InsufficientCreditsError extends APIError {
  /** Credits the tenant can spend now, from `extra.available`. */
  get available(): number | undefined {
    return numberField(this.problem, 'available');
  }

  /** Credits the action costs, from `extra.required`. */
  get required(): number | undefined {
    return numberField(this.problem, 'required');
  }

  /** The billable action refused, e.g. `dsp.search.fast`, from `extra.action_type`. */
  get actionType(): string | undefined {
    const value = this.problem?.extra?.action_type;
    return typeof value === 'string' ? value : undefined;
  }
}

function numberField(problem: Problem | undefined, name: string): number | undefined {
  const value = problem?.extra?.[name];
  return typeof value === 'number' ? value : undefined;
}

/**
 * 403 — the key is valid but not allowed: missing scope
 * (`auth.insufficient_scope`) or presented from a browser
 * (`auth.browser_origin`).
 */
export class PermissionDeniedError extends APIError {}

/** 404 — no such resource. */
export class NotFoundError extends APIError {}

/**
 * 409 — the request conflicts with the current state of what it names. `code`
 * says which: `lists.item_cap_reached` is the one an API key meets, where a free
 * workspace's saved-items cap would be exceeded, nothing was added, and `extra`
 * carries `cap`, `saved` and `adding`. Not retried: the state has to change first.
 */
export class ConflictError extends APIError {}

/** 409 — the same `Idempotency-Key` while the original request is still running. */
export class IdempotencyConflictError extends ConflictError {}

/** 413 — the request body is over the server's size limit. */
export class RequestTooLargeError extends APIError {}

/** 429 — a quota was exceeded. `code` says which; honor `retryAfter`. */
export class RateLimitError extends APIError {}

/** 500 — the server failed. `credits.unknown_action` is the one 500 never retried. */
export class InternalServerError extends APIError {}

/** 501 — not available on this deployment (for example, a cursor on a `deep` search). */
export class FeatureNotAvailableError extends APIError {}

/** 503 — a dependency (auth, credits, retrieval, feedback store) is unavailable. Retried. */
export class ServiceUnavailableError extends APIError {}

/** 504 — an upstream timed out; the work was abandoned and not billed. Retried. */
export class UpstreamTimeoutError extends APIError {}

/** Each spec concept's class. Exhaustive, so a new concept in the spec fails the build. */
const CONCEPT_CLASSES: Record<ErrorConcept, typeof APIError> = {
  authentication: AuthenticationError,
  conflict: ConflictError,
  cursor_expired: CursorExpiredError,
  cursor_invalid: CursorInvalidError,
  feature_not_available: FeatureNotAvailableError,
  idempotency_conflict: IdempotencyConflictError,
  insufficient_credits: InsufficientCreditsError,
  internal: InternalServerError,
  invalid_request: InvalidRequestError,
  not_found: NotFoundError,
  pagination_depth_exceeded: PaginationDepthExceededError,
  permission_denied: PermissionDeniedError,
  rate_limit: RateLimitError,
  request_too_large: RequestTooLargeError,
  service_unavailable: ServiceUnavailableError,
  upstream_timeout: UpstreamTimeoutError,
};

/**
 * Everything the SDK throws.
 *
 * - `ClientValidationError`: refused before sending; fix the call.
 * - `APIConnectionError` / `APITimeoutError` / `APIUserAbortError`: no answer arrived.
 *   `reachedServer` says whether the request may have arrived anyway.
 * - `APIResponseValidationError`: a success the SDK cannot read.
 * - `APIError` and its subclasses: the server answered with an RFC 9457 problem. Its class
 *   is chosen by `code`, then by status (`spec/error-codes.json`), so a code this release
 *   has not seen still maps, and mapping never throws.
 */

/** Base class for every error this SDK throws. */
export class SproutsDataError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Refused before sending: the request is one the server would refuse. Nothing was sent. */
export class ClientValidationError extends SproutsDataError {}

/**
 * A `wait` gave up before the work settled. The work goes on server-side: `last` is the last
 * state seen (a run's `RunResult`, an export's `ExportJobView`), to report how far it got.
 */
export class WaitTimeoutError extends SproutsDataError {
  readonly last: unknown;

  constructor(message: string, last?: unknown) {
    super(message);
    this.last = last;
  }
}

/** An export job ended `failed`. `job` is its last state; `job.error` says why. */
export class ExportFailedError extends SproutsDataError {
  readonly job: unknown;

  constructor(message: string, job?: unknown) {
    super(message);
    this.job = job;
  }
}

/** No answer arrived. */
export class APIConnectionError extends SproutsDataError {
  /**
   * False only when the request provably never left the process. True means it may have
   * reached the server: on a billed operation a possible charge, which is why such a call
   * is never repeated.
   */
  readonly reachedServer: boolean;
  /** On an event stream that broke: the last event id, to resume after it. */
  readonly lastEventId: string | undefined;

  constructor(
    message: string,
    options: { readonly cause?: unknown; readonly reachedServer?: boolean; readonly lastEventId?: string } = {},
  ) {
    super(message, { cause: options.cause });
    this.reachedServer = options.reachedServer ?? true;
    this.lastEventId = options.lastEventId;
  }
}

/** A time budget ran out: the call's `timeoutMs`, or the event stream's idle timeout. */
export class APITimeoutError extends APIConnectionError {
  /** The budget that ran out, in milliseconds. */
  readonly timeoutMs: number;

  constructor(
    message: string,
    options: { readonly timeoutMs: number; readonly lastEventId?: string; readonly cause?: unknown },
  ) {
    super(message, { cause: options.cause, reachedServer: true, ...(options.lastEventId === undefined ? {} : { lastEventId: options.lastEventId }) });
    this.timeoutMs = options.timeoutMs;
  }
}

/**
 * The server answered with a redirect, which the SDK refuses to follow: following it would
 * send the API key to wherever it points. Never retried: it would be refused again. Check
 * `baseUrl` (it must be the API origin itself, not an address that redirects to it).
 */
export class RedirectRefusedError extends SproutsDataError {}

/** The caller's own `AbortSignal` fired. Never retried. */
export class APIUserAbortError extends SproutsDataError {
  constructor() {
    super('The request was aborted by the caller.');
  }
}

/** A success arrived with a body this release cannot read. Never retried: it was answered. */
export class APIResponseValidationError extends SproutsDataError {
  readonly status: number;
  readonly requestId: string | undefined;

  constructor(message: string, options: { readonly status: number; readonly requestId: string | undefined; readonly cause?: unknown }) {
    super(message, { cause: options.cause });
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

/** One entry of a 422's `errors`: where the problem is, and what. */
export interface FieldError {
  readonly loc: readonly (string | number)[];
  readonly msg: string;
  readonly type?: string;
}

/** The parts of an error answer an `APIError` is built from. */
export interface ErrorAnswer {
  readonly status: number;
  /** Response headers, lower-cased names. */
  readonly headers: Readonly<Record<string, string>>;
  /** The decoded body: a problem document, a proxy's text, or `undefined`. */
  readonly body: unknown;
  readonly retryAfter: number | undefined;
}

/** The server answered with an error status. Only `status` is certain. */
export class APIError extends SproutsDataError {
  readonly status: number;
  readonly code: string | undefined;
  readonly title: string | undefined;
  readonly detail: string | undefined;
  readonly instance: string | undefined;
  readonly type: string | undefined;
  /** The `X-Request-Id` header, else the body's `request_id`. Quote it to support. */
  readonly requestId: string | undefined;
  /** Field-level validation detail from a 422's top-level `errors`. */
  readonly fieldErrors: readonly FieldError[];
  readonly extra: Readonly<Record<string, unknown>>;
  /** Seconds the server asked the caller to wait, when it said so. */
  readonly retryAfter: number | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  /** An answer came back, so the request was sent (mirrors `APIConnectionError`). */
  readonly reachedServer = true as const;

  constructor(answer: ErrorAnswer) {
    const problem = isRecord(answer.body) ? answer.body : {};
    const text = (key: string): string | undefined => (typeof problem[key] === 'string' ? problem[key] : undefined);
    const requestId = answer.headers['x-request-id'] ?? text('request_id');
    super(describe(answer.status, answer.headers, text('code'), text('title'), text('detail'), requestId));
    this.status = answer.status;
    this.code = text('code');
    this.title = text('title');
    this.detail = text('detail');
    this.instance = text('instance');
    this.type = text('type');
    this.requestId = requestId;
    this.fieldErrors = fieldErrors(problem['errors']);
    this.extra = isRecord(problem['extra']) ? problem['extra'] : {};
    this.retryAfter = answer.retryAfter;
    this.headers = answer.headers;
    this.body = answer.body;
  }
}

function describe(
  status: number,
  headers: Readonly<Record<string, string>>,
  code: string | undefined,
  title: string | undefined,
  detail: string | undefined,
  requestId: string | undefined,
): string {
  const parts: string[] = [];
  if (status >= 300 && status < 400) {
    const location = headers['location'];
    const target = location === undefined ? 'with no Location' : `to ${location}`;
    parts.push(
      `Redirect refused (HTTP ${String(status)}): the server redirected ${target}, and this client ` +
        'never follows a redirect, which would send your API key there. Check baseUrl.',
    );
  } else {
    parts.push(`${title ?? `HTTP ${String(status)}`} (${code ?? String(status)})`);
    if (detail !== undefined) parts.push(detail);
  }
  if (requestId !== undefined) parts.push(`request_id=${requestId}`);
  return parts.join(' - ');
}

function fieldErrors(raw: unknown): FieldError[] {
  if (!Array.isArray(raw)) return [];
  const out: FieldError[] = [];
  for (const entry of raw as unknown[]) {
    if (!isRecord(entry) || !Array.isArray(entry['loc']) || typeof entry['msg'] !== 'string') continue;
    const loc = (entry['loc'] as unknown[]).filter((p): p is string | number => typeof p === 'string' || typeof p === 'number');
    out.push(typeof entry['type'] === 'string' ? { loc, msg: entry['msg'], type: entry['type'] } : { loc, msg: entry['msg'] });
  }
  return out;
}

/** Whether `value` is a plain JSON object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberIn(extra: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = extra[key];
  return typeof value === 'number' ? value : undefined;
}

function stringIn(extra: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = extra[key];
  return typeof value === 'string' ? value : undefined;
}

/** 401: the key is missing, unknown, revoked or expired, or was sent from a browser. One answer for all. */
export class AuthenticationError extends APIError {}

/** 403: the key is valid but lacks the scope this operation needs. */
export class PermissionDeniedError extends APIError {}

/** 403 `auth.workspace_required`: a signed-in user has not chosen a workspace. */
export class WorkspaceRequiredError extends PermissionDeniedError {}

/** 402: the workspace cannot pay for this call. Nothing was charged. Never retried. */
export class InsufficientCreditsError extends APIError {
  /** Credits the workspace has available now. */
  get availableCredits(): number | undefined {
    return numberIn(this.extra, 'available_credits');
  }

  /** Credits this call needs. */
  get requiredCredits(): number | undefined {
    return numberIn(this.extra, 'required_credits');
  }
}

/** 402 `credits.wallet_frozen`: Sprouts staff froze the wallet; contact support. */
export class WalletFrozenError extends InsufficientCreditsError {}

/** 400 or 422: the request is invalid. `fieldErrors` says which field and why. */
export class InvalidRequestError extends APIError {}

/** One company an ambiguous org-chart identifier could mean. */
export interface CompanyCandidate {
  readonly company_ref: string;
  readonly name?: string | null;
  readonly domain?: string | null;
  readonly linkedin_url?: string | null;
}

/** 422 `org_chart.company_ambiguous`: the domain or page names several companies; ask again with one `company_ref`. */
export class OrgChartCompanyAmbiguousError extends InvalidRequestError {
  /** The companies it could mean. */
  get candidates(): readonly CompanyCandidate[] {
    const raw = this.extra['candidates'];
    if (!Array.isArray(raw)) return [];
    return (raw as unknown[]).filter((c): c is CompanyCandidate => isRecord(c) && typeof c['company_ref'] === 'string');
  }
}

/** 422 `pagination.cursor_invalid`: the cursor does not belong to this request. */
export class CursorInvalidError extends InvalidRequestError {}

/** 422 `pagination.cursor_expired`: the cursor is over 24 hours old; start again. */
export class CursorExpiredError extends InvalidRequestError {}

/** 422 `pagination.depth_exceeded`: past the 10,000-result depth; narrow the request. */
export class PaginationDepthExceededError extends InvalidRequestError {}

/** 404: no such resource for this workspace. */
export class NotFoundError extends APIError {}

/** 409: the request conflicts with the current state. */
export class ConflictError extends APIError {}

/** 409 `lists.name_taken`: the workspace already has a list by that name. */
export class ListNameTakenError extends ConflictError {}

/** 429: over a per-minute limit. Retried while its Retry-After is within the cap. */
export class RateLimitError extends APIError {
  /** Calls allowed per window. */
  get limit(): number | undefined {
    return numberIn(this.extra, 'limit');
  }

  /** The window the limit counts over (`minute`). */
  get window(): string | undefined {
    return stringIn(this.extra, 'window');
  }

  /** The operation counted (`POST /v1/search`). */
  get operation(): string | undefined {
    return stringIn(this.extra, 'operation');
  }

  /** Whose limit was reached (the workspace's, the key's). */
  get scope(): string | undefined {
    return stringIn(this.extra, 'scope');
  }
}

/** 501: the server cannot do this yet; the request is not the problem. */
export class FeatureNotAvailableError extends APIError {}

/** 503: the API or a service behind it is unavailable. Nothing was charged. */
export class ServiceUnavailableError extends APIError {}

/** 504: the work did not finish in time; abandoned and not charged. */
export class UpstreamTimeoutError extends APIError {}

/** 500: an unexpected server error. */
export class InternalServerError extends APIError {}

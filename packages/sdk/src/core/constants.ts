/** Names and limits every layer shares: headers, the User-Agent product, paging limits. */

export const USER_AGENT_PRODUCT = 'sproutsdata-js';
export const HEADER_API_KEY = 'X-API-Key';
export const HEADER_REQUEST_ID = 'X-Request-Id';
export const HEADER_IDEMPOTENCY_KEY = 'Idempotency-Key';
export const HEADER_LAST_EVENT_ID = 'Last-Event-ID';
export const IDEMPOTENCY_KEY_PREFIX = 'sdk-';

/** The server keeps a caller's request id only if it matches this (else it substitutes its own). */
export const REQUEST_ID_PATTERN: RegExp = /^[A-Za-z0-9_.:-]{1,128}$/;

/** The server refuses a longer `Idempotency-Key` with `400 request.invalid`. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** The server pages no further than this many results into one request. */
export const MAX_PAGINATION_DEPTH = 10_000;

/** The page size the server uses when a request sends no `limit`. */
export const DEFAULT_PAGE_SIZE = 10;

/**
 * The server refuses an API key on any request carrying one of these (a key is a server's
 * credential; a browser cannot hold one safely), so the SDK never sends either.
 */
export const FORBIDDEN_HEADERS: ReadonlySet<string> = new Set(['origin', 'referer']);

/** Headers the SDK sets itself, per call: a default header may add others, never these. */
export const OWNED_HEADERS: ReadonlySet<string> = new Set([
  'x-api-key',
  'idempotency-key',
  'x-request-id',
  'user-agent',
  'accept',
  'content-type',
  'last-event-id',
]);

/**
 * `cause.code` values (anywhere in a failure's cause chain) proving a request never left the
 * process: nothing was charged or recorded, so any operation may be retried. Any other
 * failure counts as "may have been sent".
 */
export const NOT_SENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
]);

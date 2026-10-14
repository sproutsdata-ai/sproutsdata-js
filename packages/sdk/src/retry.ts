/**
 * When a failed attempt is repeated, and how long to wait first.
 *
 * Whether a failure may be retried depends on what the route costs (its
 * {@link RouteClass}), because a billed request that may have arrived may
 * already have been charged, and a repeat is recognised by its
 * `Idempotency-Key` only when it returns the same rows: it is never repeated
 * there, or it could be charged twice.
 * `shouldRetry` is the retry table of contract 02 §4.1
 * (`spec/retry-policy.json`); `tests/spec.test.ts` checks every row of that
 * file against it.
 */

import {
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
  NOT_SENT_ERROR_CODES,
  RETRY_AFTER_CAP_MS,
} from './constants';
import { APIConnectionError, APIError, type SproutsDataError } from './errors';
import { ErrorCode } from './error-codes.gen';

/**
 * What repeating a request costs.
 *
 * - `safe` — nothing, and no side effect: every `GET`, run cancel, member
 *   resolve.
 * - `billed` — charged once the work is done; a repeat that returns different
 *   rows is a second charge.
 * - `keyed` — the server requires `Idempotency-Key` and recognises a repeat
 *   that carries the same one (`runs.create`).
 * - `once` — free, but a repeat files a duplicate (`feedback.create`).
 */
export type RouteClass = 'safe' | 'billed' | 'keyed' | 'once';

/** Deterministic answers: repeating the request cannot change them. */
const NEVER_RETRIED_STATUSES: ReadonlySet<number> = new Set([
  400, 401, 402, 403, 404, 409, 413, 415, 422, 501,
]);

/** Retried on every class (`once` included): answered before any charge or work. */
const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([503, 504]);

/**
 * Statuses that mean "sent, no answer": a 502 comes from the ingress and a 408
 * from a proxy that gave up waiting, and neither says whether the service ran
 * the request (spec/retry-policy.json, `sent_no_answer`).
 */
const SENT_NO_ANSWER_STATUSES: ReadonlySet<number> = new Set([408, 502]);

/** True when `err` is an HTTP answer that says nothing about whether the request ran. */
export function isSentNoAnswerStatus(err: SproutsDataError): boolean {
  return err instanceof APIError && SENT_NO_ANSWER_STATUSES.has(err.status);
}

/** Classes on which a "sent, no answer" failure may be repeated. */
function repeatsAfterSend(routeClass: RouteClass): boolean {
  return routeClass === 'safe' || routeClass === 'keyed';
}

/**
 * True when `err`, or anything in its cause chain, carries a code proving the
 * request never left this process. Anything else — including an unknown
 * error, and the SDK's own timeout — counts as "may have been sent".
 */
export function provablyNotSent(err: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current = err; current !== null && typeof current === 'object'; ) {
    if (seen.has(current)) return false;
    seen.add(current);
    const { code, errors, cause } = current as { code?: unknown; errors?: unknown; cause?: unknown };
    if (typeof code === 'string' && NOT_SENT_ERROR_CODES.has(code)) return true;
    // Happy-eyeballs connects fail as an AggregateError: not sent only if no
    // address got the request.
    if (Array.isArray(errors) && errors.length > 0 && errors.every(provablyNotSent)) return true;
    current = cause;
  }
  return false;
}

/** The `Retry-After` of `err`, in milliseconds, when it has one. */
function retryAfterMs(err: SproutsDataError): number | undefined {
  return err instanceof APIError && err.retryAfter !== undefined ? err.retryAfter * 1_000 : undefined;
}

/**
 * True when the server asked for a longer wait than the SDK will sleep: the
 * error is raised at once, with `retryAfter` attached, instead of retried.
 */
export function retryAfterExceedsCap(err: SproutsDataError): boolean {
  const wait = retryAfterMs(err);
  return wait !== undefined && wait > RETRY_AFTER_CAP_MS;
}

/** Whether contract 02 §4.1 allows another attempt after `err` on a `routeClass` route. */
export function shouldRetry(err: SproutsDataError, routeClass: RouteClass): boolean {
  if (err instanceof APIConnectionError) {
    return !err.reachedServer || repeatsAfterSend(routeClass);
  }
  if (!(err instanceof APIError)) return false;
  if (retryAfterExceedsCap(err)) return false;
  if (SENT_NO_ANSWER_STATUSES.has(err.status)) return repeatsAfterSend(routeClass);
  if (err.status === 429) return true;
  if (NEVER_RETRIED_STATUSES.has(err.status) || err.code === ErrorCode.CREDITS_UNKNOWN_ACTION) {
    return false;
  }
  if (err.status === 500) return routeClass !== 'once';
  return UNAVAILABLE_STATUSES.has(err.status);
}

/**
 * Milliseconds to wait before retry `retry` (1-based): the server's
 * `Retry-After` when it sent one (already known to be within the cap), else
 * full-jitter exponential backoff, which spreads a fleet of clients out
 * instead of having them retry on the same beat.
 */
export function retryDelayMs(err: SproutsDataError, retry: number): number {
  const wait = retryAfterMs(err);
  if (wait !== undefined) return wait;
  const ceiling = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** (retry - 1));
  return Math.random() * ceiling;
}

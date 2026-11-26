/**
 * Whether a failed attempt is retried, and how long to wait first.
 *
 * The decision is `spec/retry-policy.json`, row for row (`OUTCOMES`): what may be repeated
 * depends on what the operation costs, so each operation carries a route class and the
 * first row matching the failure decides for that class. In short: a call that provably
 * never arrived is always retried; one that may have arrived (a timeout after sending, a
 * gateway's answer instead of the API's) only where a repeat is free (`safe`) or recognised by
 * its key (`keyed`); a deterministic answer never, nor one whose code says a repeat cannot help
 * (too many runs at once, a refused credit hold).
 */

import { DEFAULTS } from '../generated/defaults.js';
import type { RouteClass } from '../generated/operations.js';
import { OUTCOMES, RETRY_AFTER_CAP_MS, type Decision, type NetworkOutcome, type Outcome } from '../generated/retry-policy.js';
import { NOT_SENT_ERROR_CODES } from './constants.js';
import { APIConnectionError, APIError, GatewayError, isRecord, type SproutsDataError } from './errors.js';

// A connection failure is either provably unsent or possibly sent: the two groups the
// policy distinguishes, each matched by one representative of its group.
const UNSENT: NetworkOutcome = 'connect_refused';
const MAYBE_SENT: NetworkOutcome = 'read_timeout';

/** The policy row a failed attempt matches, or `undefined` (never retried). */
export function outcomeFor(error: SproutsDataError): Outcome | undefined {
  if (error instanceof APIConnectionError) {
    const network = error.reachedServer ? MAYBE_SENT : UNSENT;
    return OUTCOMES.find((o) => o.network.includes(network));
  }
  if (!(error instanceof APIError)) return undefined;
  const { code } = error;
  const byCode = code === undefined ? undefined : OUTCOMES.find((o) => o.codes.includes(code));
  if (byCode !== undefined) return byCode; // the code decides, whatever its status
  const beyondCap = error.retryAfter !== undefined && error.retryAfter * 1_000 > RETRY_AFTER_CAP_MS;
  return OUTCOMES.find(
    (o) => o.statuses.includes(error.status) && (o.retryAfter === null || (o.retryAfter === 'beyond_cap') === beyondCap),
  );
}

/** `retry` or `raise`, for this failure on an operation of this class. */
export function decide(error: SproutsDataError, routeClass: RouteClass): Decision {
  return outcomeFor(error)?.decisions[routeClass] ?? 'raise';
}

/**
 * Milliseconds to wait before retry `attempt` (1-based): the server's Retry-After (within
 * the cap) in full, else full-jitter exponential backoff.
 */
export function backoffMs(attempt: number, retryAfter: number | undefined, random: () => number): number {
  if (retryAfter !== undefined && retryAfter * 1_000 <= RETRY_AFTER_CAP_MS) return retryAfter * 1_000;
  const ceiling = Math.min(DEFAULTS.backoff.capMs, DEFAULTS.backoff.initialMs * 2 ** Math.max(0, attempt - 1));
  return random() * ceiling;
}

/**
 * What a caller must know about a call that may have reached the API without an answer from it (a
 * timeout or dropped connection after sending, or a gateway's answer) and was deliberately not
 * repeated.
 */
export function consequence(error: SproutsDataError, routeClass: RouteClass): string | undefined {
  const unanswered = error instanceof GatewayError || (error instanceof APIConnectionError && error.reachedServer);
  if (!unanswered) return undefined;
  if (routeClass === 'billed') {
    return (
      'The request may have reached the server, and a billed call is charged once its work is done, so it ' +
      'may have been charged. It was not repeated, because a repeat could be charged again; check ' +
      'client.credits.transactions() before trying again.'
    );
  }
  if (routeClass === 'once') {
    return (
      'The request may have reached the server, so what it asked for may already be done. It was not ' +
      'repeated (a second list create answers 409, a second delete 404); check client.lists.list() first.'
    );
  }
  return undefined;
}

/**
 * Whether `error`, or anything in its cause chain, carries a code proving the request never
 * left the process. Anything else, including an unknown error, counts as "may have been sent".
 */
export function provablyNotSent(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current: unknown = error; isRecord(current) || current instanceof Error; ) {
    if (seen.has(current)) return false;
    seen.add(current);
    const { code, errors, cause } = current as { code?: unknown; errors?: unknown; cause?: unknown };
    if (typeof code === 'string' && NOT_SENT_ERROR_CODES.has(code)) return true;
    // Happy-eyeballs connects fail as an AggregateError: unsent only if no address got it.
    if (Array.isArray(errors) && errors.length > 0 && errors.every(provablyNotSent)) return true;
    current = cause;
  }
  return false;
}

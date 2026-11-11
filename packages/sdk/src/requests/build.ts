/**
 * What every request builder shares: refusing locally, and leaving unset fields out.
 *
 * A refusal says `what: reason`, in the server's words where it has some, so the error a
 * caller reads is the one the server would have sent, without the round trip.
 */

import { ClientValidationError } from '../core/errors.js';

/** A plain object (not an array, not null). */
export function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value that was given: neither `undefined` nor `null` (the server reads both as absent). */
export function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** Refuse a request locally, as the server would. */
export function refuse(what: string, reason: string): never {
  throw new ClientValidationError(`${what}: ${reason}`);
}

/** A page size (or page number) the server accepts: 1 to `maximum`. */
export function checkLimit(what: string, name: string, value: number | undefined, maximum: number): void {
  if (value !== undefined && !(Number.isInteger(value) && value >= 1 && value <= maximum)) {
    refuse(what, `${name} must be an integer between 1 and ${String(maximum)} (got ${String(value)})`);
  }
}

/** A query string the server accepts: 1 to `maximum` characters. */
export function checkText(what: string, name: string, value: string | undefined, maximum: number): void {
  if (value !== undefined && !(value.length >= 1 && value.length <= maximum)) {
    refuse(what, `${name} must be 1 to ${String(maximum)} characters (got ${String(value.length)})`);
  }
}

/** At least one row wanted; `undefined` means every row. */
export function checkMaxResults(what: string, maxResults: number | undefined): void {
  if (maxResults !== undefined && !(Number.isInteger(maxResults) && maxResults >= 1)) {
    refuse(what, `maxResults must be a whole number of at least 1, or omitted for every row (got ${String(maxResults)})`);
  }
}

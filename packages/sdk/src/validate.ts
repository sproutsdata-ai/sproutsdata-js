/**
 * Structural-validation helpers shared by the client and its resources.
 *
 * Validation in this SDK is deliberately structural only (contract 02 §11):
 * a missing required argument, two arguments that exclude each other, a
 * header or base URL that must never be sent, a call certain to be billed
 * for nothing. Numeric bounds, lengths and vocabularies stay on the server,
 * which names the offending field on every refusal — a local copy would go
 * stale and refuse requests the server accepts.
 */

import { ClientValidationError } from './errors';

export function ensure(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ClientValidationError(message);
}

/**
 * One caller-supplied value, safe to place between two `/` in a path. Encoded
 * so a `/` or `?` cannot address another route; `.` and `..` survive encoding
 * and would be resolved as path steps, so they are refused outright.
 */
export function pathSegment(value: string): string {
  ensure(typeof value === 'string' && value.length > 0, 'A path identifier must be a non-empty string');
  ensure(
    value !== '.' && value !== '..',
    `'${value}' is not an identifier: it would be read as a path step and address a different route`,
  );
  return encodeURIComponent(value);
}

/**
 * Filters the server retired, and what replaced each. Refused locally with
 * the replacement named (contract 02 §11): the server's 422 could only say
 * the name is unknown. The same table as the Python SDK's `RETIRED_FILTERS`.
 */
const RETIRED_FILTERS: ReadonlyMap<string, string> = new Map([['prior_company', 'employment_history']]);

/**
 * Refuse a retired filter name, used as a `filters` key or named to a filter
 * catalogue. `where` is how the caller wrote it, for the message.
 */
export function assertNotRetiredFilter(name: string, where: string): void {
  const replacement = RETIRED_FILTERS.get(name);
  if (replacement === undefined) return;
  throw new ClientValidationError(
    `${where} was retired by the server. Use '${replacement}' instead — for past ` +
      `employers, \`${replacement}: { groups: [{ company: { include: […] } }] }\`.`,
  );
}

/** Refuse a retired filter among a request's `filters` keys. */
export function assertNoRetiredFilters(filters: object | undefined): void {
  for (const name of Object.keys(filters ?? {})) assertNotRetiredFilter(name, `\`filters.${name}\``);
}

/** Strip `undefined` values so the wire body only carries what was set. */
export function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/** Serialize a `Date` to ISO 8601; strings pass through unvalidated. */
export function toIso(value: Date | string, field: string): string {
  if (typeof value === 'string') return value;
  ensure(!Number.isNaN(value.getTime()), `\`${field}\` is an invalid Date`);
  return value.toISOString();
}

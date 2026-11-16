/**
 * Building a request: the URL and the headers, from an operation and a call.
 *
 * A caller's default headers go in first and the SDK's own last, matched without regard to
 * case, so a default may add a header but never replace the key, the media type, the
 * request id or the idempotency key.
 */

import type { OperationSpec, ResponseKind } from '../generated/operations.js';
import {
  HEADER_API_KEY,
  HEADER_IDEMPOTENCY_KEY,
  HEADER_LAST_EVENT_ID,
  HEADER_REQUEST_ID,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  REQUEST_ID_PATTERN,
} from './constants.js';
import { ClientValidationError } from './errors.js';
import { HeaderMap } from './headers.js';
import { newIdempotencyKey, userAgent } from './runtime.js';

const ACCEPT: Readonly<Record<ResponseKind, string>> = {
  json: 'application/json',
  empty: 'application/json',
  sse: 'text/event-stream',
  csv: 'text/csv',
  csv_or_job: 'text/csv, application/json',
};

/** Query values: a scalar, a list (the key repeated, as the server reads a list), or omitted. */
export type Query = Readonly<Record<string, unknown>>;

/** What one call may set beyond its arguments. */
export interface CallOptions {
  /** Sent as `X-Request-Id`, so your logs and the server's share an id. */
  readonly requestId?: string;
  /** For a keyed operation, the key to send instead of a generated one. */
  readonly idempotencyKey?: string;
  /** For an event stream: resume after this event. */
  readonly lastEventId?: string;
}

/** The operation's path with each `{name}` replaced by its encoded value. */
export function fillPath(template: string, params: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{([a-z_]+)\}/g, (_, name: string) => encodeSegment(params[name], name));
}

/** One value, safe between two `/` in a path (`.` and `..` would address another route). */
export function encodeSegment(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '' || value === '.' || value === '..') {
    throw new ClientValidationError(`\`${name}\` must be a non-empty identifier.`);
  }
  return encodeURIComponent(value);
}

/** The full URL: the base, the filled path, and the query (unset values dropped, lists repeated). */
export function buildUrl(baseUrl: string, path: string, query: Query | undefined): URL {
  const url = new URL(baseUrl + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? (value as unknown[]) : [value]) url.searchParams.append(key, String(item));
  }
  return url;
}

/** The headers a call sends. Called once per logical call, so a generated key is resent on its retries. */
export function buildHeaders(
  operation: OperationSpec & { readonly name: string },
  apiKey: string,
  defaults: Readonly<Record<string, string>>,
  call: CallOptions,
  hasBody: boolean,
): Record<string, string> {
  const headers = new HeaderMap();
  headers.merge(defaults);
  headers.set('Accept', ACCEPT[operation.response]);
  headers.set('User-Agent', userAgent());
  headers.set(HEADER_API_KEY, apiKey);
  if (call.requestId !== undefined) headers.set(HEADER_REQUEST_ID, checkRequestId(call.requestId));
  const key = idempotencyKey(operation, call.idempotencyKey);
  if (key !== undefined) headers.set(HEADER_IDEMPOTENCY_KEY, key);
  if (call.lastEventId !== undefined) headers.set(HEADER_LAST_EVENT_ID, call.lastEventId);
  if (hasBody) headers.set('Content-Type', 'application/json');
  return headers.toObject();
}

function checkRequestId(value: string): string {
  if (!REQUEST_ID_PATTERN.test(value)) {
    throw new ClientValidationError(
      "requestId must be 1-128 characters of A-Z, a-z, 0-9, '_', '.', ':' or '-'. The server replaces " +
        'anything else with its own id, which would break the correlation you are asking for.',
    );
  }
  return value;
}

/** The caller's key, a fresh one, or none: only keyed operations read one. */
function idempotencyKey(operation: OperationSpec & { readonly name: string }, given: string | undefined): string | undefined {
  if (operation.idempotency === 'none') {
    if (given !== undefined) throw new ClientValidationError(`${operation.name} does not take an idempotency key.`);
    return undefined;
  }
  if (given === undefined) return newIdempotencyKey();
  if (given === '' || given.length > IDEMPOTENCY_KEY_MAX_LENGTH || /[^\x20-\x7e]/.test(given)) {
    throw new ClientValidationError(`idempotencyKey must be 1-${String(IDEMPOTENCY_KEY_MAX_LENGTH)} printable characters.`);
  }
  return given;
}

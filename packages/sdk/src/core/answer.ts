/** Reading a success: by its operation's response kind, with its request id and rate limit. */

import type { ResponseKind } from '../generated/operations.js';
import { APIResponseValidationError } from './errors.js';

/** The rate limit the server counted a call against, when it said. */
export interface RateLimitInfo {
  readonly limit: number | undefined;
  readonly remaining: number | undefined;
  /** Seconds until the window resets. */
  readonly resetSeconds: number | undefined;
}

/** A decoded success: `kind` says which body is set. */
export type Answer =
  | { readonly kind: 'json'; readonly json: unknown; readonly meta: AnswerMeta }
  | { readonly kind: 'csv'; readonly text: string; readonly meta: AnswerMeta }
  | { readonly kind: 'empty'; readonly meta: AnswerMeta };

/** What every success carries besides its body. */
export interface AnswerMeta {
  readonly status: number;
  /** Lower-cased names. */
  readonly headers: Readonly<Record<string, string>>;
  readonly requestId: string | undefined;
  readonly rateLimit: RateLimitInfo;
}

/** The `RateLimit-*` (or `X-RateLimit-*`) headers, when the server sent them. */
export function rateLimitOf(headers: Readonly<Record<string, string>>): RateLimitInfo {
  const integer = (name: string): number | undefined => {
    const raw = headers[`ratelimit-${name}`] ?? headers[`x-ratelimit-${name}`];
    return raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : undefined;
  };
  return { limit: integer('limit'), remaining: integer('remaining'), resetSeconds: integer('reset') };
}

/** Whether a success is a CSV file: an operation that answers one, with the CSV media type. */
function isCsv(kind: ResponseKind, headers: Readonly<Record<string, string>>): boolean {
  if (kind !== 'csv' && kind !== 'csv_or_job') return false;
  return headers['content-type']?.split(';')[0]?.trim().toLowerCase() === 'text/csv';
}

/** Decode a success body for an operation's response kind. */
export function readAnswer(
  name: string,
  kind: ResponseKind,
  status: number,
  headers: Readonly<Record<string, string>>,
  text: string,
): Answer {
  const meta: AnswerMeta = { status, headers, requestId: headers['x-request-id'], rateLimit: rateLimitOf(headers) };
  if (status === 204 || kind === 'empty') return { kind: 'empty', meta };
  if (isCsv(kind, headers)) return { kind: 'csv', text: text.replace(/^\uFEFF/, ''), meta };
  if (text === '') return { kind: 'empty', meta };
  try {
    return { kind: 'json', json: JSON.parse(text) as unknown, meta };
  } catch (err) {
    throw new APIResponseValidationError(
      `${name} answered ${String(status)} with a body that is not JSON (request_id=${meta.requestId ?? 'none'}).`,
      { status, requestId: meta.requestId, cause: err },
    );
  }
}

/**
 * Reading an error answer: the RFC 9457 problem document, into the right error class.
 *
 * Tolerates a body that is not a problem document (a proxy's HTML 502, an empty 503): a
 * parse failure there would hide the real one.
 */

import { ERROR_CODES, STATUS_FALLBACKS, type ErrorCode, type ErrorConcept } from '../generated/error-codes.js';
import {
  APIError,
  AuthenticationError,
  ConflictError,
  CursorExpiredError,
  CursorInvalidError,
  FeatureNotAvailableError,
  InsufficientCreditsError,
  InternalServerError,
  InvalidRequestError,
  isRecord,
  ListNameTakenError,
  NotFoundError,
  OrgChartCompanyAmbiguousError,
  PaginationDepthExceededError,
  PermissionDeniedError,
  RateLimitError,
  ServiceUnavailableError,
  UpstreamTimeoutError,
  WalletFrozenError,
  WorkspaceRequiredError,
} from './errors.js';

/** The class each spec concept raises. Exhaustive: a new concept in the spec fails the build. */
export const CONCEPT_CLASSES: Readonly<Record<ErrorConcept, typeof APIError>> = {
  authentication: AuthenticationError,
  permission_denied: PermissionDeniedError,
  workspace_required: WorkspaceRequiredError,
  insufficient_credits: InsufficientCreditsError,
  wallet_frozen: WalletFrozenError,
  invalid_request: InvalidRequestError,
  org_chart_company_ambiguous: OrgChartCompanyAmbiguousError,
  not_found: NotFoundError,
  conflict: ConflictError,
  list_name_taken: ListNameTakenError,
  cursor_invalid: CursorInvalidError,
  cursor_expired: CursorExpiredError,
  pagination_depth_exceeded: PaginationDepthExceededError,
  rate_limit: RateLimitError,
  feature_not_available: FeatureNotAvailableError,
  service_unavailable: ServiceUnavailableError,
  upstream_timeout: UpstreamTimeoutError,
  internal: InternalServerError,
};

function isKnownCode(code: string): code is ErrorCode {
  return Object.hasOwn(ERROR_CODES, code);
}

/** The concept a code (else its status) maps to, or `undefined` for neither. */
export function conceptFor(status: number, code: string | undefined): ErrorConcept | undefined {
  if (code !== undefined && isKnownCode(code)) return ERROR_CODES[code].concept;
  return STATUS_FALLBACKS[status];
}

/** `Retry-After` as seconds from `now` (ms since the epoch): a delay, or an HTTP date. A past date is 0. */
export function parseRetryAfter(raw: string | undefined, now: number): number | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(value)) return Math.max(0, Number(value));
  const when = Date.parse(value);
  return Number.isNaN(when) ? undefined : Math.max(0, (when - now) / 1_000);
}

/** A response body as JSON when it is JSON, else its text, else `undefined`. */
export function decodeErrorBody(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** The error for an error answer. `headers` has lower-cased names. Never throws. */
export function errorFromAnswer(
  status: number,
  headers: Readonly<Record<string, string>>,
  body: unknown,
  now: number,
): APIError {
  const code = isRecord(body) && typeof body['code'] === 'string' ? body['code'] : undefined;
  const concept = conceptFor(status, code);
  const ErrorClass = concept === undefined ? APIError : CONCEPT_CLASSES[concept];
  return new ErrorClass({ status, headers, body, retryAfter: parseRetryAfter(headers['retry-after'], now) });
}

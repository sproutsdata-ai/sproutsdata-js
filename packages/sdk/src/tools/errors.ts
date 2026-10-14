/**
 * Which failures a model is told about, and which stop the application.
 *
 * Contract 02 §12.3, as one rule: **return what the model can act on; throw
 * what only the application can fix.**
 *
 * - Returned, as `{ error: {...} }`: invalid model input, 404, 409, 422, 429,
 *   5xx, timeouts and connection failures. The model can correct its
 *   arguments, wait, or tell the user — and an agent run that aborted on one
 *   bad argument would lose every turn before it.
 * - Thrown: 401, 403 and 402, plus the configuration errors the client
 *   throws before any call (a missing key, a bad base URL). A model cannot
 *   fix a key or buy credits, and a model told "insufficient credits" as
 *   data tends to retry, apologise, or invent an answer.
 *
 * Every returned error has the same six keys. `retryable` answers "would
 * calling again, unchanged, be both useful and safe?" — and all three tools
 * are charged once the server has done the work, so a request that may have reached the
 * server (a read timeout, a dropped connection, a gateway's 502) is not
 * retryable: a repeat may be a second charge, and the message says so.
 *
 * Errors are recognised by `name` and `status`, not `instanceof`. An
 * application can hold a second copy of this SDK — another installed
 * version, or the CommonJS build beside the ES module one — whose classes
 * `instanceof` does not recognise; matching on the class only would turn
 * every API error from such a client into a throw that ends the agent run.
 */

import type { APIError } from '../errors';
import { text } from './spec';
import { isObject } from './validate';
import type { ToolError } from './types';

/** Answered as such, and worth asking again: throttling, a server error answered before the charge, an unreachable dependency, a retrieval that ran out of time unbilled. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 503, 504]);

/** Sent, but nothing came back from the service itself. On a billed route the charge may have landed. */
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([408, 502]);

/** A 500 that is not transient: the server has no price for the action. */
const NEVER_RETRY_CODES: ReadonlySet<string> = new Set(['credits.unknown_action']);

/** What only the application can fix: a rejected key, a missing scope, no credits. */
const RAISED_ERRORS: ReadonlySet<string> = new Set([
  'AuthenticationError',
  'PermissionDeniedError',
  'InsufficientCreditsError',
]);

interface ErrorFields {
  retryable?: boolean;
  retryAfter?: number | null;
  fieldErrors?: string[];
  requestId?: string | null;
}

/** The one error shape every tool returns. */
export function errorResult(code: string, message: string, fields: ErrorFields = {}): ToolError {
  return {
    error: {
      code,
      message,
      retryable: fields.retryable ?? false,
      retry_after: fields.retryAfter ?? null,
      field_errors: fields.fieldErrors ?? [],
      request_id: fields.requestId ?? null,
    },
  };
}

/** Arguments the schema refused, every problem listed. */
export function invalidArguments(fieldErrors: string[]): ToolError {
  return errorResult('invalid_arguments', text('validation', 'summary'), { fieldErrors });
}

/** Arguments that fit the schema but break one of the tool's rules. */
export function refused(message: string): ToolError {
  return errorResult('invalid_arguments', message);
}

/**
 * The server's field errors as `path: problem`, in the tool's own terms.
 * `loc` starts at `body` (or `query`); the tool's arguments are the body, so
 * that first segment is dropped and the path reads like the argument the
 * model sent.
 */
function apiFieldErrors(error: APIError): string[] {
  const entries = error.problem?.extra?.errors;
  if (!Array.isArray(entries)) return [];
  return entries.filter(isObject).map((entry) => {
    let parts = Array.isArray(entry.loc) ? entry.loc.map(String) : [];
    if (parts[0] === 'body' || parts[0] === 'query') parts = parts.slice(1);
    const path = parts.length > 0 ? parts.join('.') : text('validation', 'root');
    return `${path}: ${typeof entry.msg === 'string' ? entry.msg : 'invalid'}`;
  });
}

function fromStatus(error: APIError): ToolError {
  const status = error.status;
  const code = error.code || `http.${status}`;
  const requestId = error.requestId;
  if (GATEWAY_STATUSES.has(status)) {
    return errorResult(code, text('errors', 'gateway_no_answer', { status }), { requestId });
  }
  return errorResult(code, error.detail || error.title || text('errors', 'http_status', { status }), {
    retryable: RETRYABLE_STATUSES.has(status) && !NEVER_RETRY_CODES.has(code),
    retryAfter: error.retryAfter,
    fieldErrors: apiFieldErrors(error),
    requestId,
  });
}

/** The error's class name, when it is an `Error` at all. */
function errorName(err: unknown): string | undefined {
  return err instanceof Error ? err.name : undefined;
}

/** An `APIError` of any subclass: a server answer, with its status and problem body. */
function isApiError(err: unknown): err is APIError {
  return (
    err instanceof Error &&
    typeof (err as { status?: unknown }).status === 'number' &&
    'problem' in err &&
    'headers' in err
  );
}

/**
 * The error result for a failed call, or a rethrow of what is not the
 * model's to handle: 401, 403 and 402, a caller's abort, and anything that
 * is not one of this SDK's errors — a defect, which data would hide.
 */
export function fromError(err: unknown): ToolError {
  const name = errorName(err);
  if (name !== undefined && RAISED_ERRORS.has(name)) throw err;
  // The client's own refusal of a request it can see will fail — a
  // contradiction the tool's rules did not catch first.
  if (name === 'ClientValidationError') return refused((err as Error).message);
  if (isApiError(err)) return fromStatus(err);
  // A timeout always follows sending here: a connect timeout, which proves
  // nothing left, is an `APIConnectionError` with `reachedServer: false`.
  if (name === 'APITimeoutError') return errorResult('timeout', text('errors', 'timeout_sent'));
  if (name === 'APIConnectionError') {
    return (err as { reachedServer?: unknown }).reachedServer === false
      ? errorResult('connection_error', text('errors', 'connection_unsent'), { retryable: true })
      : errorResult('connection_error', text('errors', 'connection_sent'));
  }
  if (name === 'APIResponseValidationError') {
    return errorResult('response_invalid', text('errors', 'response_invalid'), {
      requestId: (err as { requestId?: string }).requestId,
    });
  }
  throw err;
}

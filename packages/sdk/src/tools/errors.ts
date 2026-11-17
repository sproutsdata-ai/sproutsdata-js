/**
 * Which failures a model is told about, and which stop the application.
 *
 * One rule: **return what the model can act on; throw what only the application can fix.**
 *
 * - Returned, as `{ error: {...} }`: invalid model input, 404, 409, 422, 429, 5xx, timeouts and
 *   connection failures. The model can correct its arguments, wait, or tell the user.
 * - Thrown: 401, 403 and 402 ({@link APPLICATION_ERRORS}), and every error that is not the
 *   SDK's own. A model cannot fix a key or buy credits.
 *
 * Every returned error has the same six keys. `retryable` answers "would calling again,
 * unchanged, be both useful and safe?": all three tools are charged once the server has done
 * the work, so a request that may have reached the server is not retryable.
 */

import { text } from './catalog.js';
import { errorClasses, isApplicationError } from './connection.js';
import type { ToolError } from './types.js';

/** A returned error. */
export type ErrorResult = ToolError;

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 503, 504]);
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([408, 502]);

interface ErrorFields {
  readonly retryable?: boolean;
  readonly retryAfter?: number | null;
  readonly fieldErrors?: readonly string[];
  readonly requestId?: string | null;
}

/** The one error shape every tool returns. */
export function error(code: string, message: string, fields: ErrorFields = {}): ErrorResult {
  return {
    error: {
      code,
      message,
      retryable: fields.retryable ?? false,
      retry_after: fields.retryAfter ?? null,
      field_errors: [...(fields.fieldErrors ?? [])],
      request_id: fields.requestId ?? null,
    },
  };
}

/** Arguments the schema refused, every problem listed. */
export function invalidArguments(fieldErrors: readonly string[]): ErrorResult {
  return error('invalid_arguments', text('validation', 'summary'), { fieldErrors });
}

/** Arguments that fit the schema but break one of the tool's rules. */
export function refused(message: string): ErrorResult {
  return error('invalid_arguments', message);
}

/** What a returned error reads from an `APIError`, read by name: the class may be another copy's. */
interface StatusFailure {
  readonly status: number;
  readonly code: string | undefined;
  readonly title: string | undefined;
  readonly detail: string | undefined;
  readonly nextStep: string | undefined;
  readonly retryAfter: number | undefined;
  readonly requestId: string | undefined;
  readonly fieldErrors: readonly unknown[];
}

const str = (from: object, key: string): string | undefined => {
  const value: unknown = Reflect.get(from, key);
  return typeof value === 'string' ? value : undefined;
};

function statusFailure(failure: object): StatusFailure {
  const status: unknown = Reflect.get(failure, 'status');
  const retryAfter: unknown = Reflect.get(failure, 'retryAfter');
  const fieldErrors: unknown = Reflect.get(failure, 'fieldErrors');
  return {
    status: typeof status === 'number' ? status : 0,
    code: str(failure, 'code'),
    title: str(failure, 'title'),
    detail: str(failure, 'detail'),
    nextStep: str(failure, 'nextStep'),
    retryAfter: typeof retryAfter === 'number' ? retryAfter : undefined,
    requestId: str(failure, 'requestId'),
    fieldErrors: Array.isArray(fieldErrors) ? fieldErrors : [],
  };
}

/** The server's field errors as `path: problem`, with a leading `body` or `query` dropped. */
function located(entries: readonly unknown[]): string[] {
  return entries.map((entry) => {
    const loc: unknown = entry !== null && typeof entry === 'object' ? Reflect.get(entry, 'loc') : undefined;
    const msg = entry !== null && typeof entry === 'object' ? str(entry, 'msg') : undefined;
    const parts = Array.isArray(loc) ? loc.map(String) : [];
    const path = parts[0] === 'body' || parts[0] === 'query' ? parts.slice(1) : parts;
    return `${path.length > 0 ? path.join('.') : text('validation', 'root')}: ${msg ?? 'invalid'}`;
  });
}

function fromStatus(failure: StatusFailure): ErrorResult {
  const { status } = failure;
  const code = failure.code ?? `http.${String(status)}`;
  if (GATEWAY_STATUSES.has(status)) {
    return error(code, text('errors', 'gateway_no_answer', { status }), { requestId: failure.requestId ?? null });
  }
  const said = failure.detail ?? failure.title ?? text('errors', 'http_status', { status });
  return error(code, failure.nextStep === undefined ? said : `${said} ${failure.nextStep}`, {
    retryable: RETRYABLE_STATUSES.has(status),
    retryAfter: failure.retryAfter ?? null,
    fieldErrors: located(failure.fieldErrors),
    requestId: failure.requestId ?? null,
  });
}

/** A request that failed on the way: retryable only if it never reached the server. */
function fromConnection(failure: Error, timedOut: boolean): ErrorResult {
  const code = timedOut ? 'timeout' : 'connection_error';
  if (Reflect.get(failure, 'reachedServer') !== true) return error(code, text('errors', 'connection_unsent'), { retryable: true });
  return error(code, text('errors', timedOut ? 'timeout_sent' : 'connection_sent'));
}

/**
 * The error result for a failed call. The SDK's errors are recognised by class name
 * (`errorClasses`), so a client from a second copy of the package is answered the same way.
 *
 * @throws The error itself when only the application can act on it, or when it is not the
 * SDK's: a defect in calling code turned into data would be hidden.
 */
export function fromError(failure: unknown): ErrorResult {
  if (isApplicationError(failure)) throw failure;
  const names = errorClasses(failure);
  if (!(failure instanceof Error)) throw failure;
  if (names.has('ClientValidationError')) return refused(failure.message);
  if (names.has('APIError')) return fromStatus(statusFailure(failure));
  if (names.has('APIConnectionError')) return fromConnection(failure, names.has('APITimeoutError'));
  if (names.has('APIResponseValidationError')) {
    return error('response_invalid', text('errors', 'response_invalid'), { requestId: str(failure, 'requestId') ?? null });
  }
  throw failure;
}

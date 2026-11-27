/**
 * Which failures a model is told about, and which stop the application.
 *
 * One rule: **return what the model can act on; throw what only the application can fix.**
 *
 * - Returned, as `{ error: {...} }`: invalid model input, 404, 409, 422, 429, 5xx, timeouts and
 *   connection failures. The model can correct its arguments, wait, or tell the user.
 * - Thrown: 401, 403 and 402 ({@link APPLICATION_ERRORS}), a redirect (the base URL is not the
 *   API's), and every error that is not the SDK's own. A model cannot fix a key, buy credits or
 *   point the client elsewhere.
 *
 * Every returned error has the same six keys. `retryable` answers "would calling again,
 * unchanged, be both useful and safe?". All three tools are charged, and calling one again sends
 * a new request with a new idempotency key, so nothing that may have run is retryable: a request
 * that may have reached the server (a timeout, a dropped connection, a gateway's answer), an
 * internal error, or the API's own timeout. By then the client's own retries, which resend the
 * call's key and are charged once, are spent. Neither is an answer whose code says a repeat
 * cannot help. What is retryable is data: `shaping.json` `retryable_concepts`, read against the
 * error's `concept`; the concepts whose work may have run (`may_have_run_concepts`) say so in
 * their message.
 */

import { SHAPING, text } from './catalog.js';
import { errorClasses, isApplicationError } from './connection.js';
import type { ToolError } from './types.js';

/** A returned error. */
export type ErrorResult = ToolError;

const RETRYABLE_CONCEPTS: ReadonlySet<string> = new Set(SHAPING.retryable_concepts);
const MAY_HAVE_RUN_CONCEPTS: ReadonlySet<string> = new Set(SHAPING.may_have_run_concepts);

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
  readonly concept: string | undefined;
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
    concept: str(failure, 'concept'),
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

/** The server's words (detail, else title), its next step, and, where the work may have run, that a repeat can be charged. */
function statusMessage(failure: StatusFailure): string {
  const said = failure.detail ?? failure.title ?? text('errors', 'http_status', { status: failure.status });
  const message = failure.nextStep === undefined ? said : `${said} ${failure.nextStep}`;
  const mayHaveRun = failure.concept !== undefined && MAY_HAVE_RUN_CONCEPTS.has(failure.concept);
  return mayHaveRun ? `${message} ${text('errors', 'may_have_run')}` : message;
}

function fromStatus(failure: StatusFailure): ErrorResult {
  const { status } = failure;
  const code = failure.code ?? `http.${String(status)}`;
  if (failure.concept === 'gateway') {
    return error(code, text('errors', 'gateway_no_answer', { status }), { requestId: failure.requestId ?? null });
  }
  return error(code, statusMessage(failure), {
    retryable: failure.concept !== undefined && RETRYABLE_CONCEPTS.has(failure.concept),
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

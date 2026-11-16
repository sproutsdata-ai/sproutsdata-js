/**
 * What `sproutsdata/tools` and the adapters built on it share about reaching the API: the
 * connection options, the client they resolve to, and the errors only the application can fix.
 *
 * A client is recognised by a `Symbol.for` brand as well as by `instanceof`, so a client made
 * by a second copy of `sproutsdata` (an adapter's own dependency, say) is accepted as one; and
 * the SDK's errors are recognised by their class names along the prototype chain
 * ({@link errorClasses}), for the same reason: that copy throws its own classes.
 */

import { ClientValidationError, SproutsData } from '../index.js';

/** How to reach the API: a client, or the settings to build one. */
export interface ConnectionOptions {
  /** The client to call through, used as it is. The settings below then must be unset. */
  readonly client?: SproutsData | undefined;
  /** Defaults to the `SPROUTSDATA_API_KEY` environment variable. */
  readonly apiKey?: string | undefined;
  /** Defaults to `SPROUTSDATA_BASE_URL`, then production. */
  readonly baseUrl?: string | undefined;
  /** Time budget per attempt, in milliseconds. */
  readonly timeoutMs?: number | undefined;
  /** Retries for what is safe to retry. */
  readonly maxRetries?: number | undefined;
}

/** The brand every `SproutsData` client carries, whichever copy of the package made it. */
export const CLIENT_BRAND: unique symbol = Symbol.for('sproutsdata.client');

/** The errors only the application can act on: a key (401), a scope (403), credits (402). */
export const APPLICATION_ERRORS: ReadonlySet<string> = new Set([
  'AuthenticationError',
  'PermissionDeniedError',
  'InsufficientCreditsError',
]);

/** `value` is a `SproutsData` client, from this copy of the package or another. */
export function isSproutsData(value: unknown): value is SproutsData {
  if (value instanceof SproutsData) return true;
  return value !== null && typeof value === 'object' && Reflect.get(value, CLIENT_BRAND) === true;
}

/** The class names of `value` and its parents (`InvalidRequestError`, `APIError`, ...), whichever copy made it. */
export function errorClasses(value: unknown): ReadonlySet<string> {
  const names = new Set<string>();
  if (!(value instanceof Error)) return names;
  for (let proto: unknown = Object.getPrototypeOf(value); proto !== null && typeof proto === 'object'; proto = Object.getPrototypeOf(proto)) {
    const ctor: unknown = Reflect.get(proto, 'constructor');
    if (typeof ctor === 'function') names.add(ctor.name);
  }
  return names;
}

/** `value` is an error only the application can fix (its class, or a parent, is one of them). */
export function isApplicationError(value: unknown): value is Error {
  return [...errorClasses(value)].some((name) => APPLICATION_ERRORS.has(name));
}

/**
 * The client `options` describe: the one given, or one built from the settings.
 *
 * @throws {ClientValidationError} Settings beside a client (they would configure nothing), or
 * what the `SproutsData` constructor refuses (no key, a refused base URL).
 */
export function resolveClient(options: ConnectionOptions = {}): SproutsData {
  const { client, apiKey, baseUrl, timeoutMs, maxRetries } = options;
  const settings = {
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(maxRetries === undefined ? {} : { maxRetries }),
  };
  const given = Object.keys(settings);
  if (client === undefined) return new SproutsData(settings);
  if (!isSproutsData(client)) throw new TypeError('client must be a SproutsData client.');
  if (given.length > 0) {
    throw new ClientValidationError(
      `${given.join(', ')} configure a client this package builds; with client given, set them on that client instead.`,
    );
  }
  return client;
}

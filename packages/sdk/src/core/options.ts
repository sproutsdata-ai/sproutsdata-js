/**
 * The client's configuration, resolved and checked once, at construction.
 *
 * Each setting resolves in the same order: the option, then the environment variable,
 * then its deprecated spelling (with one warning naming the replacement), then the
 * default from `spec/defaults.json`. A setting that would put the key at risk, or could
 * only fail later, is refused here.
 */

import type { AnswerMeta } from './answer.js';
import { DEFAULTS } from '../generated/defaults.js';
import { FORBIDDEN_HEADERS, OWNED_HEADERS } from './constants.js';
import { ClientValidationError } from './errors.js';
import { isBrowserLike, readEnvWithFallback } from './runtime.js';

/** What a client is constructed with. Every field is optional. */
export interface ClientOptions {
  /** The API key; else `SPROUTSDATA_API_KEY`. Keys look like `sk_dsp_live_…`. */
  readonly apiKey?: string;
  /** The API's origin; else `SPROUTSDATA_BASE_URL`, else the production API. */
  readonly baseUrl?: string;
  /** Milliseconds to wait for each attempt's answer. */
  readonly timeoutMs?: number;
  /** Retries after the first attempt, where the operation's route class allows them. */
  readonly maxRetries?: number;
  /** Headers sent on every call. The SDK's own (the key, `Accept`, …) cannot be replaced. */
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  /** A `fetch` to send requests with (a proxy agent, a test double). */
  readonly fetch?: typeof globalThis.fetch;
  /** Called with the status, request id, headers and rate limit of every successful answer. */
  readonly onResponse?: (meta: AnswerMeta) => void;
}

/** The resolved configuration. */
export interface ResolvedOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly defaultHeaders: Readonly<Record<string, string>>;
  readonly fetch: typeof globalThis.fetch;
  readonly onResponse?: ((meta: AnswerMeta) => void) | undefined;
}

/** Resolve and check every setting. */
export function resolveOptions(options: ClientOptions = {}): ResolvedOptions {
  if (isBrowserLike()) {
    throw new ClientValidationError(
      'The Sprouts Data API refuses an API key sent from a browser (any request with an Origin ' +
        'header), so this SDK runs on servers only: Node.js, Deno, Bun or an edge runtime.',
    );
  }
  const apiKey = options.apiKey ?? readEnvWithFallback(DEFAULTS.env.apiKey, DEFAULTS.deprecatedEnv.apiKey);
  const baseUrl = options.baseUrl ?? readEnvWithFallback(DEFAULTS.env.baseUrl, DEFAULTS.deprecatedEnv.baseUrl);
  return {
    apiKey: checkApiKey(apiKey),
    baseUrl: baseUrl === undefined ? DEFAULTS.baseUrl : checkBaseUrl(baseUrl),
    timeoutMs: checkTimeout(options.timeoutMs ?? DEFAULTS.timeoutMs),
    maxRetries: checkRetries(options.maxRetries ?? DEFAULTS.maxRetries),
    defaultHeaders: checkHeaders(options.defaultHeaders ?? {}),
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    onResponse: options.onResponse,
  };
}

/** The key, if it is one dsp-auth could have issued; refused otherwise. The key is never echoed. */
export function checkApiKey(key: unknown): string {
  if (typeof key !== 'string' || key === '') {
    throw new ClientValidationError(
      `No API key. Pass \`apiKey\` or set ${DEFAULTS.env.apiKey}. Keys are created in the Sprouts Data ` +
        "dashboard and look like 'sk_dsp_live_…'.",
    );
  }
  if (key.startsWith(DEFAULTS.retiredApiKeyPrefix)) {
    // The server would answer a bare 401; say why instead.
    throw new ClientValidationError(
      "Test keys ('sk_dsp_test_…') were retired: every key is now a live key, and its calls are charged " +
        "to the workspace's credits. Create a key in the Sprouts Data dashboard.",
    );
  }
  if (key.length > DEFAULTS.apiKeyMaxLength || !DEFAULTS.apiKeyPattern.test(key)) {
    throw new ClientValidationError(
      "That is not a Sprouts Data API key: keys look like 'sk_dsp_live_…', at most " +
        `${String(DEFAULTS.apiKeyMaxLength)} characters.`,
    );
  }
  return key;
}

/** The base URL without a trailing slash; refused unless https (or http to a local host). */
export function checkBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ClientValidationError(`baseUrl ${JSON.stringify(raw)} is not an absolute http(s) URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ClientValidationError(`baseUrl ${JSON.stringify(raw)} is not an absolute http(s) URL.`);
  }
  if (url.protocol === 'http:' && !DEFAULTS.plainHttpHosts.includes(url.hostname)) {
    throw new ClientValidationError(
      `Refusing baseUrl ${JSON.stringify(raw)}: plain http:// would send your API key unencrypted. Use ` +
        `https:// (plain http:// is accepted only for ${DEFAULTS.plainHttpHosts.join(' and ')}).`,
    );
  }
  return raw.replace(/\/+$/, '');
}

/** A positive number of milliseconds. */
export function checkTimeout(timeoutMs: unknown): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ClientValidationError(`timeoutMs must be a positive number of milliseconds: ${String(timeoutMs)}.`);
  }
  return timeoutMs;
}

/** Zero or more retries. */
export function checkRetries(maxRetries: unknown): number {
  if (typeof maxRetries !== 'number' || !Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new ClientValidationError(`maxRetries must be zero or more: ${String(maxRetries)}.`);
  }
  return maxRetries;
}

/** Headers a caller may add: none the SDK sets itself, and no Origin or Referer. */
export function checkHeaders(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  for (const name of Object.keys(headers)) {
    const lowered = name.toLowerCase();
    if (FORBIDDEN_HEADERS.has(lowered)) {
      throw new ClientValidationError(
        `Refusing a '${name}' header: the API refuses an API key on any request that carries one.`,
      );
    }
    if (OWNED_HEADERS.has(lowered)) throw new ClientValidationError(`The SDK sets the '${name}' header itself.`);
  }
  return { ...headers };
}

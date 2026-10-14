/**
 * Every fixed value the SDK is configured by, in one place: names, defaults,
 * retry and polling behaviour. `tests/spec.test.ts` holds these to
 * `spec/defaults.json`.
 *
 * Server-side limits — page sizes, list lengths, string lengths,
 * vocabularies — are deliberately not mirrored here (contract 02 §11): the
 * server names the offending field on every refusal, and a stale local copy
 * would refuse requests the server accepts.
 *
 * Nothing here is read from the environment or computed at import time, so
 * importing this module has no side effects.
 */

import type { EntityCategory } from './types';

// -- Names ------------------------------------------------------------------

/** The product token of the `User-Agent` header. */
export const USER_AGENT_PRODUCT = 'sproutsdata-js';

/** The API key, read when `apiKey` is not passed. */
export const ENV_API_KEY = 'SPROUTSDATA_API_KEY';
/** The API origin, read when `baseUrl` is not passed. */
export const ENV_BASE_URL = 'SPROUTSDATA_BASE_URL';
/** Read after {@link ENV_API_KEY}, with a deprecation warning. Removed at 1.0. */
export const DEPRECATED_ENV_API_KEY = 'DSP_API_KEY';
/** Read after {@link ENV_BASE_URL}, with a deprecation warning. Removed at 1.0. */
export const DEPRECATED_ENV_BASE_URL = 'DSP_BASE_URL';

// -- Connection defaults ----------------------------------------------------

/** The production API. */
export const DEFAULT_BASE_URL = 'https://api.sproutsdata.ai';

/** Hosts that may be reached over plain `http://` — local development only. */
export const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1'];

/** Time budget per attempt, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Retries after the first attempt (three attempts in all). */
export const DEFAULT_MAX_RETRIES = 2;

/**
 * Backoff before retry `n` (1-based) is full jitter: a uniform draw from
 * `[0, min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2^(n-1)))` — the same formula
 * as the Python SDK (`spec/defaults.json` `backoff`).
 */
export const INITIAL_BACKOFF_MS = 500;
export const MAX_BACKOFF_MS = 8_000;

/**
 * A `Retry-After` up to this long is slept in full before the retry. A longer
 * one — a daily or monthly quota resetting hours away — is raised at once
 * with the value attached, never slept through.
 */
export const RETRY_AFTER_CAP_MS = 60_000;

/**
 * `err.cause.code` values (anywhere in the cause chain) that prove a request
 * never left this process: nothing was charged and nothing was filed, so any
 * route may be retried. Every other failure counts as "may have been sent".
 */
export const NOT_SENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * Longest silence tolerated on a run's event stream: four times the server's
 * 15 s heartbeat.
 */
export const STREAM_IDLE_TIMEOUT_MS = 60_000;

/** Rows a cursor can page through before the server refuses the next page. */
export const MAX_PAGINATION_DEPTH = 10_000;

/**
 * The server's page size when a request sends no `limit` — also what a search's
 * base price covers (its first ten results). Used only to avoid asking for rows
 * `maxResults` would discard; the server's default stays the authority.
 */
export const DEFAULT_PAGE_SIZE = 10;

// -- Keys and headers -------------------------------------------------------

/**
 * `sk_<platform>_<live|test>_<secret>`. Issued keys are `sk_dsp_…`; any
 * platform segment is accepted so a new prefix needs no SDK release.
 */
export const API_KEY_PATTERN = /^sk_[a-z0-9]+_(live|test)_[A-Za-z0-9_-]+$/;

/**
 * Never sent with an API key: the server answers any key-authenticated
 * request carrying either one with `403 auth.browser_origin`. Lower-cased.
 */
export const FORBIDDEN_HEADERS: readonly string[] = ['origin', 'referer'];

/**
 * Names the integration making the call — `langchain/0.4.0`, `js-tools/0.4.0`
 * (contract 02 §10). The `User-Agent` says which SDK sent a request; this says
 * which framework or tool layer above it did, which the `User-Agent` cannot.
 * Set only through the `integration` option, never as a raw header.
 */
export const HEADER_CLIENT = 'X-SproutsData-Client';

/**
 * Sent on every request as `X-Dsp-Source: sdk/js`. The API counts traffic
 * carrying `sdk/...` as SDK usage rather than hand-written HTTP calls made with
 * the same key. Fixed: the integration making the call has `X-SproutsData-Client`.
 */
export const HEADER_SOURCE = 'X-Dsp-Source';
export const SOURCE = 'sdk/js';

/** `<integration>/<version>`, one token each side of the slash. */
export const INTEGRATION_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._+-]+$/;

/** The caller's id for one request, and the id the server answers with. */
export const HEADER_REQUEST_ID = 'X-Request-Id';

/**
 * What the server keeps as a caller's request id (contract 02 §10). Anything
 * else it silently replaces with its own, which would break the correlation
 * the caller asked for — so the SDK refuses it before sending. The same
 * pattern as the Python SDK.
 */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Sent on `runs.create`, where the server requires it and recognises a
 * repeat by it, and on every billed call (contract 02 §4).
 */
export const HEADER_IDEMPOTENCY_KEY = 'Idempotency-Key';

/**
 * Prefix of the `Idempotency-Key` the SDK generates: for `runs.create` when it
 * gets none, and for every billed call.
 */
export const IDEMPOTENCY_KEY_PREFIX = 'sdk-';

// -- Agent runs -------------------------------------------------------------

/** `runs.wait`: the whole wait's default deadline. */
export const RUN_WAIT_DEADLINE_MS = 900_000;
/** `runs.wait`: the first poll interval, grown by `RUN_POLL_MULTIPLIER` up to `RUN_POLL_MAX_MS`. */
export const RUN_POLL_INITIAL_MS = 3_000;
export const RUN_POLL_MULTIPLIER = 1.5;
export const RUN_POLL_MAX_MS = 15_000;
/** The shortest poll interval `runs.wait` accepts, so a typo cannot hammer the API. */
export const MIN_POLL_INTERVAL_MS = 250;

// -- Routing ----------------------------------------------------------------

/** The two categories whose filter vocabulary is typed (`filterValues`), not per-vertical. */
export const GTM_CATEGORIES: readonly EntityCategory[] = ['company', 'person'];

/** What `search` sends when the caller names no `category` — the Python SDK's default too. */
export const DEFAULT_SEARCH_CATEGORY: EntityCategory = 'company';

/**
 * The `category` that asks the server to classify the query itself. Never
 * sent: the SDK leaves `category` off the body, the MCP server's convention.
 */
export const AUTO_CATEGORY = 'auto';

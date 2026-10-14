/**
 * The client a toolkit or a retriever calls through.
 *
 * A client the caller supplies is used through a copy that names this
 * package in `X-SproutsData-Client` and shares the caller's settings; the
 * caller's own client is not changed. Otherwise one is built from the
 * connection options. Either way it exists from construction, so a missing
 * key or a refused base URL throws `ClientValidationError` where the toolkit
 * or retriever is built, rather than in the middle of an agent run: the model
 * can fix neither. The `SproutsData` constructor also refuses a browser-like
 * environment, where the API would answer `403 auth.browser_origin`.
 */

import { SproutsData } from 'sproutsdata';

import { INTEGRATION } from './version';

/** How to reach the API. */
export interface SproutsDataConnection {
  /**
   * The client to call through, used through a copy that names this package
   * in `X-SproutsData-Client`. When set, the options below are ignored.
   */
  client?: SproutsData;
  /** Defaults to the `SPROUTSDATA_API_KEY` environment variable. */
  apiKey?: string;
  /** Defaults to `SPROUTSDATA_BASE_URL`, then production. */
  baseUrl?: string;
  /** Time budget per attempt, in milliseconds. */
  timeoutMs?: number;
  /** Retries for what is safe to retry. */
  maxRetries?: number;
}

export function connect({ client, apiKey, baseUrl, timeoutMs, maxRetries }: SproutsDataConnection): SproutsData {
  if (client !== undefined) return client.withOptions({ integration: INTEGRATION });
  return new SproutsData({ apiKey, baseUrl, timeoutMs, maxRetries, integration: INTEGRATION });
}

/**
 * The local stack sproutsdata-py runs (`make e2e-up` there): its settings, as `python -m
 * e2e.seed` wrote them, and a client for it. Every live test skips when the stack is absent.
 */

import { existsSync, readFileSync } from 'node:fs';

import { SproutsData } from '../../src/client.js';

const ENV_FILE = new URL('../../../../../sproutsdata-py/e2e/.state/env', import.meta.url).pathname;

/** The seeded stack's settings, or `undefined` when there is none. */
export const STACK: Readonly<Record<string, string>> | undefined = existsSync(ENV_FILE)
  ? Object.fromEntries(
      readFileSync(ENV_FILE, 'utf8')
        .split('\n')
        .filter((line) => line.includes('='))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    )
  : undefined;

function setting(name: string): string {
  const value = STACK?.[name];
  if (value === undefined) throw new Error(`the seeded stack has no ${name}`);
  return value;
}

/** A client for the stack: its full-scope key, unless another is given. */
export function client(options: { readonly key?: string; readonly baseUrl?: string } = {}): SproutsData {
  return new SproutsData({ apiKey: options.key ?? setting('SPROUTSDATA_E2E_KEY'), baseUrl: options.baseUrl ?? setting('SPROUTSDATA_E2E_BASE_URL') });
}

/** The same request with no SDK in between: what the server itself answers. */
export async function raw(method: string, path: string, body?: unknown, headers: Readonly<Record<string, string>> = {}): Promise<Response> {
  const init: RequestInit = { method, headers: { 'X-API-Key': setting('SPROUTSDATA_E2E_KEY'), 'Content-Type': 'application/json', ...headers } };
  return fetch(`${setting('SPROUTSDATA_E2E_BASE_URL')}${path}`, body === undefined ? init : { ...init, body: JSON.stringify(body) });
}

/**
 * Make the fault proxy answer `path` with `status`, `times` times. With `forward`, each request
 * still reaches the server, and only its answer is lost.
 */
export async function arm(path: string, status: number, times = 1, { forward = false }: { readonly forward?: boolean } = {}): Promise<void> {
  const answer = await fetch(`${setting('SPROUTSDATA_E2E_FAULT_URL')}/__fake/arm`, { method: 'POST', body: JSON.stringify({ path, status, times, forward }) });
  if (!answer.ok) throw new Error(`the fault proxy answered ${String(answer.status)}`);
}

export { setting };

/** The local stack sproutsdata-py runs (`make e2e-up` there), as `python -m e2e.seed` wrote it. */

import { existsSync, readFileSync } from 'node:fs';

import { SproutsData } from 'sproutsdata';

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

/** A client for the stack's full-scope key. */
export function client(): SproutsData {
  const apiKey = STACK?.['SPROUTSDATA_E2E_KEY'];
  const baseUrl = STACK?.['SPROUTSDATA_E2E_BASE_URL'];
  if (apiKey === undefined || baseUrl === undefined) throw new Error('the seeded stack has no key or base URL');
  return new SproutsData({ apiKey, baseUrl });
}

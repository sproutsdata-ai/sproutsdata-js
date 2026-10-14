/**
 * The SDK held to the vendored spec (`spec/`, synced from sproutsdata-py): the
 * files are the pinned ones, and the defaults, the retry table, the error
 * taxonomy, the record types and the public surface all agree with them.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as constants from '../src/constants';
import { CODE_CONCEPTS, STATUS_CONCEPTS } from '../src/error-codes.gen';
import { APIConnectionError, APIError, APITimeoutError, type SproutsDataError } from '../src/errors';
import { ErrorCode, SproutsData, VERSION } from '../src/index';
import { shouldRetry, type RouteClass } from '../src/retry';
import { TEST_KEY } from './helpers';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPEC = join(ROOT, 'spec');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [relative(SPEC, path).split(sep).join('/')];
  });
}

describe('spec/PIN.json', () => {
  const pin = readJson<{ source: string; files: Record<string, string> }>(join(SPEC, 'PIN.json'));

  it('pins every vendored file, and nothing else', () => {
    const vendored = listFiles(SPEC).filter((path) => path !== 'PIN.json').sort();
    expect(vendored).toEqual(Object.keys(pin.files).sort());
  });

  it('matches every vendored file byte for byte (re-sync from sproutsdata-py; never edit spec/)', () => {
    for (const [path, digest] of Object.entries(pin.files)) {
      const actual = createHash('sha256').update(readFileSync(join(SPEC, path))).digest('hex');
      expect(actual, path).toBe(digest);
    }
  });
});

describe('spec/defaults.json', () => {
  const defaults = readJson<{
    base_url: string;
    plain_http_hosts: string[];
    api_key_pattern: string;
    env: { api_key: string; base_url: string; deprecated: { js: { api_key: string; base_url: string } } };
    timeout_seconds: number;
    max_retries: number;
    backoff: { initial_seconds: number; cap_seconds: number };
    retry_after_cap_seconds: number;
    stream_idle_timeout_seconds: number;
    run_wait: {
      deadline_seconds: number;
      poll_initial_seconds: number;
      poll_multiplier: number;
      poll_max_seconds: number;
    };
  }>(join(SPEC, 'defaults.json'));

  it('is what the SDK applies', () => {
    expect(constants.DEFAULT_BASE_URL).toBe(defaults.base_url);
    expect(constants.LOOPBACK_HOSTS).toEqual(defaults.plain_http_hosts);
    expect(constants.API_KEY_PATTERN.source).toBe(defaults.api_key_pattern);
    expect(constants.ENV_API_KEY).toBe(defaults.env.api_key);
    expect(constants.ENV_BASE_URL).toBe(defaults.env.base_url);
    expect(constants.DEPRECATED_ENV_API_KEY).toBe(defaults.env.deprecated.js.api_key);
    expect(constants.DEPRECATED_ENV_BASE_URL).toBe(defaults.env.deprecated.js.base_url);
    expect(constants.DEFAULT_TIMEOUT_MS).toBe(defaults.timeout_seconds * 1_000);
    expect(constants.DEFAULT_MAX_RETRIES).toBe(defaults.max_retries);
    expect(constants.INITIAL_BACKOFF_MS).toBe(defaults.backoff.initial_seconds * 1_000);
    expect(constants.MAX_BACKOFF_MS).toBe(defaults.backoff.cap_seconds * 1_000);
    expect(constants.RETRY_AFTER_CAP_MS).toBe(defaults.retry_after_cap_seconds * 1_000);
    expect(constants.STREAM_IDLE_TIMEOUT_MS).toBe(defaults.stream_idle_timeout_seconds * 1_000);
    expect(constants.RUN_WAIT_DEADLINE_MS).toBe(defaults.run_wait.deadline_seconds * 1_000);
    expect(constants.RUN_POLL_INITIAL_MS).toBe(defaults.run_wait.poll_initial_seconds * 1_000);
    expect(constants.RUN_POLL_MULTIPLIER).toBe(defaults.run_wait.poll_multiplier);
    expect(constants.RUN_POLL_MAX_MS).toBe(defaults.run_wait.poll_max_seconds * 1_000);
  });
});

describe('spec/retry-policy.json', () => {
  interface Outcome {
    outcome: string;
    network?: string[];
    status?: number[];
    codes?: string[];
    safe: 'retry' | 'raise';
    billed: 'retry' | 'raise';
    keyed: 'retry' | 'raise';
    once: 'retry' | 'raise';
  }
  const policy = readJson<{ classes: RouteClass[]; retry_after_cap_seconds: number; outcomes: Outcome[] }>(
    join(SPEC, 'retry-policy.json'),
  );

  const NOT_SENT = ['connect_refused', 'dns_failure', 'connect_timeout'];
  const status = (code: number, problemCode?: string, headers: Record<string, string> = {}) =>
    APIError.from(code, problemCode === undefined ? undefined : { code: problemCode }, headers);

  /** Failures that fall under each outcome row, as the transport would build them. */
  function failuresFor(row: Outcome): SproutsDataError[] {
    const cap = policy.retry_after_cap_seconds;
    switch (row.outcome) {
      case 'rate_limited':
        return [status(429), status(429, 'quota.burst_exceeded', { 'retry-after': String(cap) })];
      case 'rate_limited_long':
        return [status(429, 'quota.monthly_exhausted', { 'retry-after': String(cap + 1) })];
      case 'internal_error':
        return [status(500, 'internal'), status(500)];
      default:
        return [
          ...(row.network ?? []).map((kind) =>
            kind === 'read_timeout'
              ? new APITimeoutError('timed out', { timeoutMs: 1 })
              : new APIConnectionError(kind, { reachedServer: !NOT_SENT.includes(kind) }),
          ),
          ...(row.status ?? []).map((code) => status(code)),
          ...(row.codes ?? []).map((code) => status(CODE_STATUS.get(code) ?? 500, code)),
        ];
    }
  }

  const CODE_STATUS = new Map(
    readJson<{ codes: Array<{ code: string; status: number }> }>(join(SPEC, 'error-codes.json')).codes.map(
      (entry) => [entry.code, entry.status],
    ),
  );

  it('names the four classes the transport knows', () => {
    expect(policy.classes).toEqual(['safe', 'billed', 'keyed', 'once']);
  });

  it.each(policy.outcomes.map((row) => [row.outcome, row]))('%s is decided as the table says', (_name, row) => {
    const failures = failuresFor(row);
    expect(failures.length).toBeGreaterThan(0);
    for (const failure of failures) {
      for (const routeClass of policy.classes) {
        expect(shouldRetry(failure, routeClass), `${failure.message} on ${routeClass}`).toBe(
          row[routeClass] === 'retry',
        );
      }
    }
  });
});

describe('spec/error-codes.json', () => {
  const spec = readJson<{
    codes: Array<{ code: string; status: number; concept: string }>;
    status_fallbacks: Record<string, string>;
  }>(join(SPEC, 'error-codes.json'));

  it('ErrorCode lists every code, and only those', () => {
    expect(Object.values(ErrorCode).sort()).toEqual(spec.codes.map((c) => c.code).sort());
    expect(Object.values(ErrorCode)).toHaveLength(53);
  });

  it('every code maps to its concept, and every status fallback is honoured', () => {
    for (const entry of spec.codes) expect(CODE_CONCEPTS.get(entry.code), entry.code).toBe(entry.concept);
    for (const [key, concept] of Object.entries(spec.status_fallbacks)) {
      if (/^\d+$/.test(key)) expect(STATUS_CONCEPTS.get(Number(key)), key).toBe(concept);
    }
  });

  it('a known code raises the same class at its own status and at any other', () => {
    for (const entry of spec.codes) {
      const own = APIError.from(entry.status, { code: entry.code }, {});
      const other = APIError.from(entry.status === 418 ? 419 : 418, { code: entry.code }, {});
      expect(other.constructor, entry.code).toBe(own.constructor);
    }
  });
});

describe('spec/openapi.json records', () => {
  const ROOTS = [
    'CompanyRecord',
    'PersonRecord',
    'PatentRecord',
    'NewsRecord',
    'TrendRecord',
    'MarketReportRecord',
    'FundingRecord',
    'AcademicReportRecord',
    'JobOpeningRecord',
  ];
  const schemas = readJson<{ components: { schemas: Record<string, unknown> } }>(join(SPEC, 'openapi.json'))
    .components.schemas;

  function closure(): string[] {
    const seen = new Set<string>();
    const visit = (name: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      for (const [, ref] of JSON.stringify(schemas[name]).matchAll(/"#\/components\/schemas\/([^"]+)"/g)) {
        visit(ref!);
      }
    };
    ROOTS.forEach(visit);
    return [...seen].sort();
  }

  it('records.ts names every record schema and every model they reference', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/records.ts', import.meta.url)), 'utf8');
    const aliases = [...source.matchAll(/^export type (\w+) = Schema<'(\w+)'>/gm)];
    expect(aliases.every(([, alias, schema]) => alias === schema)).toBe(true);
    expect(aliases.map(([, alias]) => alias!).sort()).toEqual(closure());
  });

  it('the company and person records carry the backend field counts', () => {
    const fields = (name: string) => Object.keys((schemas[name] as { properties: object }).properties).length;
    expect(fields('CompanyRecord')).toBe(61);
    expect(fields('PersonRecord')).toBe(63);
  });
});

describe('spec/surface-map.json', () => {
  const map = readJson<{
    groups: Array<{ group: string; js: string[] }>;
    absent: { js: string[] };
  }>(join(SPEC, 'surface-map.json'));
  const client = new SproutsData({ apiKey: TEST_KEY, fetch: async () => new Response('{}') });

  it('every js path exists on the client as a method', () => {
    for (const group of map.groups) {
      for (const path of group.js) {
        const target = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], client);
        expect(typeof target, `${group.group}: client.${path}`).toBe('function');
      }
    }
  });

  it('the retired namespaces are absent', () => {
    for (const name of map.absent.js) expect(name in client, name).toBe(false);
  });
});

describe('VERSION', () => {
  it('equals packages/sdk/package.json version', () => {
    const pkg = readJson<{ version: string }>(fileURLToPath(new URL('../package.json', import.meta.url)));
    expect(VERSION).toBe(pkg.version);
  });
});

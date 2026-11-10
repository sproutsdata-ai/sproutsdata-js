/** The generated tables say exactly what their spec files say. */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DEFAULTS } from '../../src/generated/defaults.js';
import { ERROR_CODES, STATUS_FALLBACKS } from '../../src/generated/error-codes.js';
import { OPERATIONS } from '../../src/generated/operations.js';
import { OUTCOMES, RETRY_AFTER_CAP_MS } from '../../src/generated/retry-policy.js';

const spec = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../../spec/${name}`, import.meta.url), 'utf8'));

interface Route {
  method: string;
  path: string;
  name: string;
  class: string;
  response: string;
  idempotency: string;
  paging?: { style: string; items: string; cursor_in?: string; binds_limit?: boolean };
}

const camel = (name: string): string => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** The generated paging, in the spec's spelling, for comparison. */
function pagingOf(op: (typeof OPERATIONS)[keyof typeof OPERATIONS]): Route['paging'] {
  if (!('paging' in op)) return undefined;
  const paging = op.paging;
  return {
    style: paging.style,
    items: paging.items,
    ...('cursorIn' in paging ? { cursor_in: paging.cursorIn } : {}),
    ...('bindsLimit' in paging ? { binds_limit: paging.bindsLimit } : {}),
  };
}

describe('generated tables', () => {
  it('has one operation per route, with the route\'s facts', () => {
    const routes = (spec('routes.json') as { routes: Route[] }).routes;
    expect(Object.keys(OPERATIONS).sort()).toEqual(routes.map((r) => camel(r.name)).sort());
    for (const route of routes) {
      const op = OPERATIONS[camel(route.name) as keyof typeof OPERATIONS];
      expect([op.method, op.path, op.routeClass, op.response, op.idempotency]).toEqual([
        route.method,
        route.path,
        route.class,
        route.response,
        route.idempotency,
      ]);
      expect(pagingOf(op)).toEqual(route.paging);
    }
  });

  it('maps every error code as the spec does', () => {
    const errors = spec('error-codes.json') as {
      codes: { code: string; status: number; concept: string; retry: boolean }[];
      status_fallbacks: Record<string, string>;
    };
    expect(ERROR_CODES).toEqual(Object.fromEntries(errors.codes.map((c) => [c.code, { status: c.status, concept: c.concept, retry: c.retry }])));
    const fallbacks = Object.entries(errors.status_fallbacks).filter(([status]) => /^\d+$/.test(status));
    expect(STATUS_FALLBACKS).toEqual(Object.fromEntries(fallbacks.map(([status, concept]) => [Number(status), concept])));
  });

  it('keeps the retry policy\'s rows in order', () => {
    const policy = spec('retry-policy.json') as {
      retry_after_cap_seconds: number;
      classes: string[];
      outcomes: Record<string, unknown>[];
    };
    expect(RETRY_AFTER_CAP_MS).toBe(policy.retry_after_cap_seconds * 1000);
    expect(OUTCOMES.map((o) => o.name)).toEqual(policy.outcomes.map((r) => r['outcome']));
    for (const [index, row] of policy.outcomes.entries()) {
      const outcome = OUTCOMES[index];
      expect(outcome?.statuses).toEqual(row['status'] ?? []);
      expect(outcome?.retryAfter).toBe(row['retry_after'] ?? null);
      expect(outcome?.decisions).toEqual(Object.fromEntries(policy.classes.map((c) => [c, row[c]])));
    }
  });

  it('turns the defaults\' seconds into milliseconds', () => {
    const defaults = spec('defaults.json') as {
      base_url: string;
      timeout_seconds: number;
      max_retries: number;
      export_wait: { deadline_seconds: number };
    };
    expect(DEFAULTS.baseUrl).toBe(defaults.base_url);
    expect(DEFAULTS.timeoutMs).toBe(defaults.timeout_seconds * 1000);
    expect(DEFAULTS.maxRetries).toBe(defaults.max_retries);
    expect(DEFAULTS.exportWait.deadlineMs).toBe(defaults.export_wait.deadline_seconds * 1000);
    expect(DEFAULTS.apiKeyPattern.test('sk_dsp_test_abc')).toBe(true);
    expect(DEFAULTS.apiKeyPattern.test('sk_other_test_abc')).toBe(false);
  });

  it('generates a type for every type in the model IR', () => {
    const ir = spec('models.json') as { types: Record<string, unknown> };
    const wire = readFileSync(new URL('../../src/generated/wire.ts', import.meta.url), 'utf8');
    const exported = new Set([...wire.matchAll(/^export (?:interface|type) (\w+)/gm)].map((m) => m[1]));
    expect([...exported].sort()).toEqual(Object.keys(ir.types).sort());
  });
});

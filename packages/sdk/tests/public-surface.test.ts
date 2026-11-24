/** The public surface (Z2-Z6): browsers refused, what is never sent, what is exported, and the response hook. */

import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import * as sdk from '../src/index.js';
import { SproutsData } from '../src/client.js';
import type { AnswerMeta } from '../src/core/answer.js';
import { recorded } from './support/answers.js';
import { BASE_URL, recordingFetch, FIXTURE_KEY } from './support/fakes.js';

const ERRORS = [
  'SproutsDataError', 'ClientValidationError', 'WaitTimeoutError', 'ExportFailedError', 'APIConnectionError', 'APITimeoutError',
  'RedirectRefusedError', 'APIUserAbortError', 'APIResponseValidationError', 'APIError', 'AuthenticationError', 'PermissionDeniedError',
  'WorkspaceRequiredError', 'InsufficientCreditsError', 'WalletFrozenError', 'InvalidRequestError', 'OrgChartCompanyAmbiguousError',
  'CursorInvalidError', 'CursorExpiredError', 'PaginationDepthExceededError', 'NotFoundError', 'ConflictError', 'ListNameTakenError',
  'RateLimitError', 'FeatureNotAvailableError', 'ServiceUnavailableError', 'UpstreamTimeoutError', 'InternalServerError',
  'ResultsExpiredError', 'ConcurrencyLimitError', 'CreditsRefusedError',
] as const;

describe('the public surface', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('Z2: there is no browser mode, and a browser is refused', () => {
    Reflect.set(globalThis, 'window', { document: {} });
    expect(() => new SproutsData({ apiKey: FIXTURE_KEY, baseUrl: BASE_URL, dangerouslyAllowBrowser: true } as never)).toThrow(sdk.ClientValidationError);
    expect(() => new SproutsData({ apiKey: FIXTURE_KEY, baseUrl: BASE_URL })).toThrow('runs on servers only');
  });

  it('Z3: no analytics header is sent, and the User-Agent is', async () => {
    const { fetch, sent } = recordingFetch([recorded('coverage', 'all')]);
    await new SproutsData({ apiKey: FIXTURE_KEY, baseUrl: BASE_URL, fetch }).coverage();
    const headers = sent[0]?.headers;
    expect(headers?.has('x-dsp-source')).toBe(false);
    expect(headers?.has('x-sproutsdata-client')).toBe(false);
    expect(headers?.get('user-agent')).toMatch(/^sproutsdata-js\//);
  });

  it('Z4: the package exports the client, every error class and the helpers', () => {
    for (const name of ERRORS) expect(typeof sdk[name]).toBe('function');
    expect(typeof sdk.SproutsData).toBe('function');
    for (const helper of ['lookupRef', 'totalFor', 'entityHit', 'missingValues', 'recordsOf', 'canAfford'] as const) expect(typeof sdk[helper]).toBe('function');
  });

  it('Z6: onResponse sees every answer, at the client and per call', async () => {
    const client: AnswerMeta[] = [];
    const call: AnswerMeta[] = [];
    const { fetch } = recordingFetch([recorded('search', 'company'), recorded('coverage', 'all')]);
    const sproutsdata = new SproutsData({ apiKey: FIXTURE_KEY, baseUrl: BASE_URL, fetch, onResponse: (meta) => client.push(meta) });
    await sproutsdata.search({ query: 'x' }, { onResponse: (meta) => call.push(meta) });
    await sproutsdata.coverage();
    expect(client.map((meta) => meta.status)).toEqual([200, 200]);
    expect(call).toHaveLength(1);
    expect(call[0]?.requestId).toBeTruthy();
    expect(call[0]?.rateLimit.limit).toBe(Number(recorded('search', 'company').headers?.['ratelimit-limit']));
  });
});

describe('the edge smoke', () => {
  it('Z5: calls every resource family in workerd (scripts/smoke-edge.mjs)', () => {
    const smoke = readFileSync(new URL('../../../scripts/smoke-edge.mjs', import.meta.url), 'utf8');
    const client = new SproutsData({ apiKey: FIXTURE_KEY, baseUrl: BASE_URL });
    const resources = Object.entries(Object.getOwnPropertyDescriptors(SproutsData.prototype)).filter(([, d]) => d.get !== undefined).map(([name]) => name);
    expect(resources).toHaveLength(10);
    for (const name of resources) expect(smoke).toContain(`client.${name}.`);
    for (const method of ['search', 'filterValues', 'coverage']) expect(smoke).toContain(`client.${method}(`);
    expect(typeof client.runs).toBe('object');
  });
});

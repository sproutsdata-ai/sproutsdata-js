import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientValidationError } from '../../src/core/errors.js';
import { checkBaseUrl, checkHeaders, checkRetries, checkTimeout, resolveOptions } from '../../src/core/options.js';
import { isBrowserLike, newIdempotencyKey, readEnv, readEnvWithFallback, userAgent, warnOnce } from '../../src/core/runtime.js';
import { redactKey } from '../../src/core/redact.js';
import { TEST_KEY } from '../support/fakes.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('options', () => {
  it('resolve from the options first, then the environment', () => {
    const resolved = resolveOptions({ apiKey: TEST_KEY, baseUrl: 'https://api.example.com/', timeoutMs: 5, maxRetries: 0 });
    expect([resolved.baseUrl, resolved.timeoutMs, resolved.maxRetries]).toEqual(['https://api.example.com', 5, 0]);
    vi.stubEnv('SPROUTSDATA_API_KEY', TEST_KEY);
    vi.stubEnv('SPROUTSDATA_BASE_URL', 'http://localhost:8001');
    expect(resolveOptions().baseUrl).toBe('http://localhost:8001');
    expect(typeof resolveOptions().fetch).toBe('function');
  });

  it('read a deprecated variable with one warning', () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    vi.stubEnv('DSP_API_KEY', TEST_KEY);
    expect(resolveOptions().apiKey).toBe(TEST_KEY);
    expect(resolveOptions().apiKey).toBe(TEST_KEY);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '', 'sk_other_live_abc', 'sk_dsp_prod_abc', `sk_dsp_live_${'x'.repeat(200)}`])(
    'refuse a key dsp-auth could not have issued: %s',
    (apiKey) => {
      vi.stubEnv('SPROUTSDATA_API_KEY', '');
      expect(() => resolveOptions(apiKey === undefined ? {} : { apiKey })).toThrow(ClientValidationError);
    },
  );

  it.each(['api.example.com', 'ftp://api.example.com', 'http://api.example.com'])('refuse a base URL that would expose the key: %s', (url) => {
    expect(() => checkBaseUrl(url)).toThrow(ClientValidationError);
  });

  it('refuse bad timeouts, retries and headers', () => {
    for (const bad of [0, -1, Number.NaN, '5']) expect(() => checkTimeout(bad)).toThrow(ClientValidationError);
    for (const bad of [-1, 1.5, '1']) expect(() => checkRetries(bad)).toThrow(ClientValidationError);
    for (const name of ['Origin', 'referer', 'X-API-Key', 'accept']) expect(() => checkHeaders({ [name]: 'x' })).toThrow(ClientValidationError);
    expect(checkHeaders({ 'X-Team': 'a' })).toEqual({ 'X-Team': 'a' });
  });

  it('refuse to construct in a browser', () => {
    vi.stubGlobal('window', { document: {} });
    expect(isBrowserLike()).toBe(true);
    expect(() => resolveOptions({ apiKey: TEST_KEY })).toThrow(/servers only/);
  });
});

describe('runtime', () => {
  it('reads an unset, empty or unreadable variable as unset', () => {
    vi.stubEnv('SPROUTSDATA_X', '');
    expect(readEnv('SPROUTSDATA_X')).toBeUndefined();
    vi.stubGlobal('process', { get env(): never { throw new Error('denied'); } });
    expect(readEnv('ANY')).toBeUndefined();
    expect(readEnvWithFallback('A', 'B')).toBeUndefined();
  });

  it('warns once per code', () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    warnOnce('SPROUTSDATA_TEST_ONCE', 'once');
    warnOnce('SPROUTSDATA_TEST_ONCE', 'once');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('names the runtime in the User-Agent', () => {
    expect(userAgent()).toMatch(/^sproutsdata-js\/\d+\.\d+\.\d+ \(node\//);
    vi.stubGlobal('Deno', { version: { deno: '2.1' }, build: { os: 'linux' } });
    expect(userAgent()).toContain('(deno/2.1; linux)');
    vi.stubGlobal('Deno', { version: { deno: '2.1' } });
    expect(userAgent()).toContain('(deno/2.1; unknown)');
    vi.unstubAllGlobals();
    vi.stubGlobal('Bun', { version: '1.2' });
    expect(userAgent()).toMatch(/\(bun\/1\.2; /);
    vi.unstubAllGlobals();
    vi.stubGlobal('process', { versions: {} });
    expect(userAgent()).toContain('(unknown/unknown; unknown)');
    vi.stubGlobal('process', { platform: undefined, versions: { node: '22' } });
    expect(userAgent()).toContain('(node/22; unknown)');
    vi.stubGlobal('Bun', { version: '1' });
    vi.stubGlobal('process', undefined);
    expect(userAgent()).toContain('(bun/1; unknown)');
    vi.stubGlobal('Bun', { get version(): never { throw new Error('locked'); } });
    expect(userAgent()).toContain('(unknown/unknown; unknown)');
  });

  it('makes a fresh idempotency key per call', () => {
    expect(newIdempotencyKey()).toMatch(/^sdk-[0-9a-f]{32}$/);
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });

  it('redacts a key to its first three parts', () => {
    expect(redactKey(TEST_KEY)).toBe('sk_dsp_test_***');
    expect(redactKey('not_a_key')).toBe('***');
  });
});

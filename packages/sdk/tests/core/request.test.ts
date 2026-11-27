import { describe, expect, it } from 'vitest';

import { OPERATIONS } from '../../src/generated/operations.js';
import { ClientValidationError } from '../../src/core/errors.js';
import { HeaderMap, lowered } from '../../src/core/headers.js';
import { buildHeaders, buildUrl, encodeSegment, fillPath } from '../../src/core/request.js';
import { FIXTURE_KEY } from '../support/fakes.js';

const search = { ...OPERATIONS.search, name: 'search' };
const creditsQuote = { ...OPERATIONS.creditsQuote, name: 'creditsQuote' };
const runsCreate = { ...OPERATIONS.runsCreate, name: 'runsCreate' };

describe('request', () => {
  it('encodes a path value so it cannot address another route', () => {
    expect(fillPath('/v1/lists/{list_id}/items', { list_id: 'a/b c' })).toBe('/v1/lists/a%2Fb%20c/items');
    for (const bad of ['', '.', '..', 5, undefined]) expect(() => encodeSegment(bad, 'id')).toThrow(ClientValidationError);
  });

  it('drops unset query values and repeats a list', () => {
    const url = buildUrl('https://api.test', '/v1/x', { a: 1, b: undefined, c: null, d: ['p', 'q'] });
    expect(url.search).toBe('?a=1&d=p&d=q');
    expect(buildUrl('https://api.test', '/v1/x', undefined).search).toBe('');
  });

  it('puts the SDK\'s own headers last, whatever a default spells them', () => {
    const headers = buildHeaders(search, FIXTURE_KEY, { 'x-team': 'a', 'user-agent': 'mine' }, {}, true);
    expect(headers['X-API-Key']).toBe(FIXTURE_KEY);
    expect(headers['x-team']).toBe('a');
    expect(headers['user-agent']).toBeUndefined();
    expect(headers['User-Agent']).toMatch(/^sproutsdata-js\//);
    expect([headers['Accept'], headers['Content-Type']]).toEqual(['application/json', 'application/json']);
  });

  it('asks each response kind for its media type', () => {
    const exportOp = { ...OPERATIONS.listsExport, name: 'listsExport' };
    const events = { ...OPERATIONS.runsEvents, name: 'runsEvents' };
    expect(buildHeaders(exportOp, FIXTURE_KEY, {}, {}, false)['Accept']).toBe('text/csv, application/json');
    const streamHeaders = buildHeaders(events, FIXTURE_KEY, {}, { lastEventId: '7' }, false);
    expect([streamHeaders['Accept'], streamHeaders['Last-Event-ID']]).toEqual(['text/event-stream', '7']);
  });

  it('refuses a request id the server would replace', () => {
    expect(buildHeaders(search, FIXTURE_KEY, {}, { requestId: 'req:1.a-b_c' }, false)['X-Request-Id']).toBe('req:1.a-b_c');
    expect(() => buildHeaders(search, FIXTURE_KEY, {}, { requestId: 'has space' }, false)).toThrow(ClientValidationError);
  });

  it('sends an idempotency key on keyed operations only', () => {
    expect(buildHeaders(creditsQuote, FIXTURE_KEY, {}, {}, false)['Idempotency-Key']).toBeUndefined();
    // A billed read reads one too: a retry with it is charged once.
    expect(buildHeaders(search, FIXTURE_KEY, {}, {}, false)['Idempotency-Key']).toMatch(/^sdk-/);
    expect(buildHeaders(runsCreate, FIXTURE_KEY, {}, {}, false)['Idempotency-Key']).toMatch(/^sdk-/);
    expect(buildHeaders(runsCreate, FIXTURE_KEY, {}, { idempotencyKey: 'mine' }, false)['Idempotency-Key']).toBe('mine');
    expect(() => buildHeaders(creditsQuote, FIXTURE_KEY, {}, { idempotencyKey: 'k' }, false)).toThrow(/does not take/);
  });

  it('takes a key the API takes, and refuses any other before sending', () => {
    for (const good of ['k', 'x'.repeat(120), 'nightly-2026-11-28', 'job:7.retry_1', 'sdk-0f']) {
      expect(buildHeaders(runsCreate, FIXTURE_KEY, {}, { idempotencyKey: good }, false)['Idempotency-Key']).toBe(good);
    }
    // Non-ASCII could not even be written into a header: the error is the SDK's, not fetch's.
    for (const bad of ['', 'x'.repeat(121), 'line\nbreak', 'two words', 'a/b', 'caf\u00e9', 'k\u2028', 'key\n', 7]) {
      expect(() => buildHeaders(runsCreate, FIXTURE_KEY, {}, { idempotencyKey: bad as string }, false)).toThrow(/1 to 120 letters/);
    }
  });

  it('refuses a header fetch could not send, without echoing its value', () => {
    const map = new HeaderMap();
    map.set('X-Bad', 'line\nbreak');
    expect(() => map.toObject()).toThrow(/cannot be sent/);
    expect(lowered(new Headers({ 'X-Request-Id': 'r' }))).toEqual({ 'x-request-id': 'r' });
  });
});

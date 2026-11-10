import { describe, expect, it } from 'vitest';

import { rateLimitOf, readAnswer } from '../../src/core/answer.js';
import { APIResponseValidationError } from '../../src/core/errors.js';

describe('answers', () => {
  it('decode JSON with the request id and the rate limit', () => {
    const answer = readAnswer('search', 'json', 200, { 'x-request-id': 'r', 'ratelimit-limit': '10', 'x-ratelimit-remaining': '9', 'ratelimit-reset': '30' }, '{"a":1}');
    expect(answer).toEqual({ kind: 'json', json: { a: 1 }, meta: { status: 200, headers: expect.any(Object) as object, requestId: 'r', rateLimit: { limit: 10, remaining: 9, resetSeconds: 30 } } });
    expect(rateLimitOf({ 'ratelimit-limit': 'ten' }).limit).toBeUndefined();
  });

  it('read an export as a file or a job', () => {
    expect(readAnswer('x', 'csv_or_job', 200, { 'content-type': 'text/csv; charset=utf-8' }, '﻿a,b\n')).toMatchObject({ kind: 'csv', text: 'a,b\n' });
    expect(readAnswer('x', 'csv_or_job', 202, { 'content-type': 'application/json' }, '{"job_id":"j"}')).toMatchObject({ kind: 'json', json: { job_id: 'j' } });
    expect(readAnswer('x', 'csv', 200, {}, '{"a":1}').kind).toBe('json');
  });

  it('read no content as empty', () => {
    expect(readAnswer('x', 'json', 204, {}, '').kind).toBe('empty');
    expect(readAnswer('x', 'empty', 200, {}, 'ignored').kind).toBe('empty');
    expect(readAnswer('x', 'json', 200, {}, '').kind).toBe('empty');
  });

  it('refuse a success that is not JSON', () => {
    expect(() => readAnswer('search', 'json', 200, {}, '<html>')).toThrow(APIResponseValidationError);
  });
});

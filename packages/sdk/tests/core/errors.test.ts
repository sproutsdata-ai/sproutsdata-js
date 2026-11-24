import { describe, expect, it } from 'vitest';

import {
  APIConnectionError,
  APIError,
  APIResponseValidationError,
  APITimeoutError,
  APIUserAbortError,
  ConcurrencyLimitError,
  ConflictError,
  CreditsRefusedError,
  InsufficientCreditsError,
  InvalidRequestError,
  NotFoundError,
  OrgChartCompanyAmbiguousError,
  PermissionDeniedError,
  RateLimitError,
  ResultsExpiredError,
  ServiceUnavailableError,
} from '../../src/core/errors.js';
import { conceptFor, decodeErrorBody, errorFromAnswer, parseRetryAfter } from '../../src/core/problem.js';
import { NOW } from '../support/fakes.js';

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, headers, body, retryAfter: undefined });

describe('errors', () => {
  it('makes the new classes kinds of the ones callers already catch', () => {
    expect(new ResultsExpiredError(answer(410, {}))).toBeInstanceOf(NotFoundError);
    expect(new ConcurrencyLimitError(answer(429, {}))).toBeInstanceOf(RateLimitError);
    expect(new CreditsRefusedError(answer(503, {}))).toBeInstanceOf(ServiceUnavailableError);
  });

  it.each<[number, string | undefined, abstract new (...args: never[]) => APIError]>([
    [410, 'agents.results_expired', ResultsExpiredError],
    [410, 'enrichment.results_expired', ResultsExpiredError],
    [410, undefined, ResultsExpiredError],
    [429, 'quota.concurrency_exceeded', ConcurrencyLimitError],
    [503, 'credits.refused', CreditsRefusedError],
    [404, 'enrichment.job_not_found', NotFoundError],
    [409, 'enrichment.idempotency_key_reused', ConflictError],
    [403, 'credits.purchase_not_allowed', PermissionDeniedError],
    [422, 'relationship.filter_value_unknown', InvalidRequestError],
  ])('raises each new code as its class: %i %s', (status, code, cls) => {
    const error = errorFromAnswer(status, {}, code === undefined ? { status } : { status, code }, NOW);
    expect(error.constructor).toBe(cls);
  });

  it('names the code, the detail and the request id', () => {
    const error = new APIError(answer(422, { code: 'request.invalid', title: 'Invalid request', detail: 'limit: too big', request_id: 'req_1' }));
    expect(error.message).toBe('Invalid request (request.invalid) - limit: too big - request_id=req_1');
    expect(new APIError(answer(503, undefined)).message).toBe('HTTP 503 (503)');
    expect(error.name).toBe('APIError');
    expect(error.reachedServer).toBe(true);
  });

  it('keeps the next step, after the detail in the message', () => {
    const body = {
      code: 'credits.insufficient',
      title: 'Insufficient credits',
      detail: 'This search needs 2 credits; 0.5 are available.',
      next_step: "Top up the workspace's credits in the dashboard, then retry.",
    };
    const error = new InsufficientCreditsError(answer(402, body, { 'x-request-id': 'req_1' }));
    expect(error.nextStep).toBe(body.next_step);
    expect(error.message).toBe(
      "Insufficient credits (credits.insufficient) - This search needs 2 credits; 0.5 are available. - Top up the workspace's credits in the dashboard, then retry. - request_id=req_1",
    );
    expect(new InsufficientCreditsError(answer(402, { ...body, next_step: null })).nextStep).toBeUndefined();
  });

  it('explains a redirect as refused', () => {
    expect(new APIError(answer(307, undefined, { location: 'https://x.example' })).message).toContain('redirected to https://x.example');
    expect(new APIError(answer(301, undefined)).message).toContain('with no Location');
  });

  it('keeps only well-formed field errors, from the top-level errors', () => {
    const errors = [{ loc: ['body', 'limit', 0, true], msg: 'too big', type: 'x' }, { loc: ['q'], msg: 'bad' }, { msg: 'no loc' }, 'junk'];
    const error = new APIError(answer(422, { errors }));
    expect(error.fieldErrors).toEqual([{ loc: ['body', 'limit', 0], msg: 'too big', type: 'x' }, { loc: ['q'], msg: 'bad' }]);
    expect(new APIError(answer(422, { errors: 'x' })).fieldErrors).toEqual([]);
  });

  it('reads typed accessors from extra and tolerates bad values', () => {
    const credits = new InsufficientCreditsError(answer(402, { extra: { available_credits: 0, required_credits: 1.5 } }));
    expect([credits.availableCredits, credits.requiredCredits]).toEqual([0, 1.5]);
    expect(new InsufficientCreditsError(answer(402, { extra: { available_credits: '1' } })).availableCredits).toBeUndefined();
    const limited = new RateLimitError(answer(429, { extra: { limit: 10, window: 'minute', operation: 'POST /v1/search', scope: 'workspace' } }));
    expect([limited.limit, limited.window, limited.operation, limited.scope]).toEqual([10, 'minute', 'POST /v1/search', 'workspace']);
    expect(new RateLimitError(answer(429, {})).window).toBeUndefined();
    const ambiguous = new OrgChartCompanyAmbiguousError(answer(422, { extra: { candidates: [{ company_ref: 'cr_1' }, { name: 'no ref' }, 'x'] } }));
    expect(ambiguous.candidates).toEqual([{ company_ref: 'cr_1' }]);
    expect(new OrgChartCompanyAmbiguousError(answer(422, { extra: { candidates: 'x' } })).candidates).toEqual([]);
  });

  it('carries what the caller needs on the other errors', () => {
    const timeout = new APITimeoutError('slow', { timeoutMs: 5, lastEventId: '7' });
    expect([timeout.timeoutMs, timeout.lastEventId, timeout.reachedServer]).toEqual([5, '7', true]);
    expect(new APITimeoutError('slow', { timeoutMs: 5 }).lastEventId).toBeUndefined();
    expect(new APIConnectionError('down').reachedServer).toBe(true);
    expect(new APIUserAbortError().message).toContain('aborted');
    expect(new APIResponseValidationError('bad', { status: 200, requestId: 'r' }).requestId).toBe('r');
  });
});

describe('problem documents', () => {
  it('maps a code first, then its status, then nothing', () => {
    expect(conceptFor(409, 'lists.name_taken')).toBe('list_name_taken');
    expect(conceptFor(409, 'lists.invented_later')).toBe('conflict');
    expect(conceptFor(418, undefined)).toBeUndefined();
  });

  it('reads Retry-After as seconds or a date', () => {
    expect(parseRetryAfter(undefined, NOW)).toBeUndefined();
    expect(parseRetryAfter('30', NOW)).toBe(30);
    expect(parseRetryAfter('-5', NOW)).toBe(0);
    expect(parseRetryAfter('soon', NOW)).toBeUndefined();
    expect(parseRetryAfter(new Date(NOW + 90_000).toUTCString(), NOW)).toBe(90);
    expect(parseRetryAfter(new Date(NOW - 90_000).toUTCString(), NOW)).toBe(0);
  });

  it('decodes an error body as JSON, else text, else nothing', () => {
    expect(decodeErrorBody('{"a":1}')).toEqual({ a: 1 });
    expect(decodeErrorBody('<html>')).toBe('<html>');
    expect(decodeErrorBody('')).toBeUndefined();
  });

  it('raises by status when the body is no problem document', () => {
    expect(errorFromAnswer(404, {}, '<html>Not Found</html>', NOW)).toBeInstanceOf(NotFoundError);
    const unknown = errorFromAnswer(418, { 'retry-after': '2' }, null, NOW);
    expect(unknown.constructor).toBe(APIError);
    expect(unknown.retryAfter).toBe(2);
  });
});

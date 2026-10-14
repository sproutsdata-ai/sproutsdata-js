import { describe, expect, it } from 'vitest';

import {
  APIConnectionError,
  APIError,
  APIResponseValidationError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  CursorInvalidError,
  FeatureNotAvailableError,
  InvalidRequestError,
  IdempotencyConflictError,
  SproutsData,
  ErrorCode,
  InsufficientCreditsError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
  RequestTooLargeError,
  ServiceUnavailableError,
  UpstreamTimeoutError,
} from '../src/index';
import { TEST_KEY, envelope, fetchQueue, jsonResponse, networkError, problemResponse } from './helpers';

function makeClient(fetchImpl: typeof globalThis.fetch, options: Partial<ConstructorParameters<typeof SproutsData>[0]> = {}) {
  return new SproutsData({
    apiKey: TEST_KEY,
    baseUrl: 'https://dsp.example.test',
    fetch: fetchImpl,
    maxRetries: 0,
    ...options,
  });
}

describe('error mapping', () => {
  it('maps 401 to AuthenticationError with code and request_id', async () => {
    const client = makeClient(
      fetchQueue(
        problemResponse(401, {
          code: ErrorCode.AUTH_UNAUTHORIZED,
          title: 'Unauthorized',
          detail: 'Authentication required.',
          request_id: 'req_401',
        }),
      ),
    );
    const err = await client.search({ query: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    const apiErr = err as AuthenticationError;
    expect(apiErr.status).toBe(401);
    expect(apiErr.code).toBe('auth.unauthorized');
    expect(apiErr.requestId).toBe('req_401');
    expect(apiErr.message).toContain('auth.unauthorized');
    expect(apiErr.message).toContain('req_401');
  });

  it('maps 403 to PermissionDeniedError', async () => {
    const client = makeClient(
      fetchQueue(problemResponse(403, { code: ErrorCode.AUTH_INSUFFICIENT_SCOPE })),
    );
    await expect(client.credits.usage()).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('maps 402 to InsufficientCreditsError and never retries it', async () => {
    const fetchMock = fetchQueue(
      problemResponse(402, { code: ErrorCode.CREDITS_INSUFFICIENT }),
    );
    const client = makeClient(fetchMock, { maxRetries: 3 });
    await expect(client.search({ query: 'x' })).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 422 to InvalidRequestError with the problem body attached', async () => {
    const client = makeClient(
      fetchQueue(
        problemResponse(422, {
          code: ErrorCode.REQUEST_INVALID,
          extra: { grantable: ['dsp.search.read'] },
        }),
      ),
    );
    const err = (await client.search({ query: 'x' }).catch((e: unknown) => e)) as InvalidRequestError;
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect(err.problem?.extra).toEqual({ grantable: ['dsp.search.read'] });
  });

  it('maps 5xx to InternalServerError even without a JSON body', async () => {
    const client = makeClient(
      fetchQueue(new Response('<html>bad gateway</html>', { status: 500 })),
    );
    const err = (await client.search({ query: 'x' }).catch((e: unknown) => e)) as InternalServerError;
    expect(err).toBeInstanceOf(InternalServerError);
    expect(err.status).toBe(500);
    expect(err.problem).toBeUndefined();
  });

  it('maps idempotency.in_flight to IdempotencyConflictError', async () => {
    const client = makeClient(
      fetchQueue(problemResponse(409, { code: ErrorCode.IDEMPOTENCY_IN_FLIGHT })),
    );
    const err = (await client.runs
      .create({ query: 'x' }, { idempotencyKey: 'intent-1' })
      .catch((e: unknown) => e)) as IdempotencyConflictError;
    expect(err).toBeInstanceOf(IdempotencyConflictError);
    expect(err.code).toBe(ErrorCode.IDEMPOTENCY_IN_FLIGHT);
  });

  it('chooses the class by code first, whatever the status says', async () => {
    const client = makeClient(
      fetchQueue(
        // Body mismatch on a replayed key is a request problem (422 in the spec).
        problemResponse(409, { code: ErrorCode.IDEMPOTENCY_FINGERPRINT_MISMATCH }),
        problemResponse(422, { code: ErrorCode.PAGINATION_CURSOR_INVALID }),
        problemResponse(501, { code: ErrorCode.NOT_IMPLEMENTED }),
        problemResponse(413, { code: ErrorCode.REQUEST_TOO_LARGE }),
      ),
    );
    const errors = [];
    for (let i = 0; i < 4; i++) errors.push(await client.search({ query: 'x' }).catch((e: unknown) => e));
    expect(errors[0]).toBeInstanceOf(InvalidRequestError);
    expect(errors[1]).toBeInstanceOf(CursorInvalidError);
    expect(errors[1]).toBeInstanceOf(InvalidRequestError);
    expect(errors[2]).toBeInstanceOf(FeatureNotAvailableError);
    expect(errors[2]).not.toBeInstanceOf(InternalServerError);
    expect(errors[3]).toBeInstanceOf(RequestTooLargeError);
  });

  it('falls back to the status for an unknown code, and to APIError for an unknown status', async () => {
    const client = makeClient(
      fetchQueue(
        problemResponse(503, { code: 'upstream.invented_later' }),
        problemResponse(504, {}),
        new Response('<html>teapot</html>', { status: 418 }),
        new Response('', { status: 505 }),
      ),
    );
    const errors = [];
    for (let i = 0; i < 4; i++) errors.push(await client.credits.retrieve().catch((e: unknown) => e));
    expect(errors[0]).toBeInstanceOf(ServiceUnavailableError);
    expect(errors[1]).toBeInstanceOf(UpstreamTimeoutError);
    expect(errors[2]!.constructor).toBe(APIError);
    expect((errors[2] as APIError).status).toBe(418);
    expect(errors[3]!.constructor).toBe(APIError);
  });

  it('reads requestId from X-Request-Id first, then the body', async () => {
    const client = makeClient(
      fetchQueue(
        problemResponse(404, { request_id: 'req_body' }, { 'x-request-id': 'req_header' }),
        problemResponse(500, { request_id: 'req_body_only' }),
        new Response('<html>Bad Gateway</html>', {
          status: 502,
          headers: { 'x-request-id': 'req_from_header' },
        }),
      ),
    );
    const ids = [];
    for (let i = 0; i < 3; i++) {
      ids.push(((await client.credits.retrieve().catch((e: unknown) => e)) as APIError).requestId);
    }
    expect(ids).toEqual(['req_header', 'req_body_only', 'req_from_header']);
  });

  it('exposes fieldErrors and puts the field paths in the message', async () => {
    const client = makeClient(
      fetchQueue(
        problemResponse(422, {
          code: ErrorCode.REQUEST_INVALID,
          title: 'Validation failed',
          extra: {
            errors: [
              { loc: ['body', 'limt'], msg: 'Extra inputs are not permitted', type: 'extra_forbidden' },
              { loc: ['body', 'filters', 'industry', 0], msg: 'Input should be a valid string' },
              'not an entry',
            ],
          },
        }),
      ),
    );
    const err = (await client.search({ query: 'x' }).catch((e: unknown) => e)) as InvalidRequestError;
    expect(err.fieldErrors).toEqual([
      { loc: ['body', 'limt'], msg: 'Extra inputs are not permitted', type: 'extra_forbidden' },
      { loc: ['body', 'filters', 'industry', 0], msg: 'Input should be a valid string' },
    ]);
    expect(err.message).toContain('body.limt: Extra inputs are not permitted');
    expect(err.message).toContain('body.filters.industry.0: Input should be a valid string');
  });

  it('exposes available, required and actionType on InsufficientCreditsError', async () => {
    const client = makeClient(
      fetchQueue(
        problemResponse(402, {
          code: ErrorCode.CREDITS_INSUFFICIENT,
          extra: { available: 0, required: 1, action_type: 'dsp.search.fast' },
        }),
        problemResponse(402, { code: ErrorCode.CREDITS_INSUFFICIENT }),
      ),
    );
    const err = (await client.search({ query: 'x' }).catch((e: unknown) => e)) as InsufficientCreditsError;
    expect([err.available, err.required, err.actionType]).toEqual([0, 1, 'dsp.search.fast']);
    const bare = (await client.search({ query: 'x' }).catch((e: unknown) => e)) as InsufficientCreditsError;
    expect([bare.available, bare.required, bare.actionType]).toEqual([undefined, undefined, undefined]);
  });

  it('never throws while mapping a body that is not a problem document', async () => {
    const client = makeClient(
      fetchQueue(
        new Response('[1, 2]', { status: 400 }),
        new Response('{"code": 7, "extra": {"errors": "nope"}}', { status: 422 }),
      ),
    );
    const first = (await client.search({ query: 'x' }).catch((e: unknown) => e)) as APIError;
    expect(first).toBeInstanceOf(InvalidRequestError);
    expect(first.problem).toBeUndefined();
    const second = (await client.search({ query: 'x' }).catch((e: unknown) => e)) as APIError;
    expect(second).toBeInstanceOf(InvalidRequestError);
    expect(second.code).toBeUndefined();
    expect(second.fieldErrors).toEqual([]);
  });
});

describe('success bodies', () => {
  it('prefers the X-Request-Id header for meta.request_id', async () => {
    const client = makeClient(fetchQueue(jsonResponse(envelope(), 200, { 'x-request-id': 'req_hdr' })));
    const page = await client.search({ query: 'x' });
    expect(page.meta.request_id).toBe('req_hdr');
  });

  it('reports an unparseable success body as APIResponseValidationError, not a connection error', async () => {
    const fetchMock = fetchQueue(
      new Response('{"results": [', { status: 200, headers: { 'x-request-id': 'req_bad' } }),
    );
    const client = makeClient(fetchMock, { maxRetries: 2 });
    const err = (await client.credits.retrieve().catch((e: unknown) => e)) as APIResponseValidationError;
    expect(err).toBeInstanceOf(APIResponseValidationError);
    expect(err).not.toBeInstanceOf(APIConnectionError);
    expect(err.status).toBe(200);
    expect(err.requestId).toBe('req_bad');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('retries', () => {
  it('retries 429 honoring Retry-After, then succeeds', async () => {
    const fetchMock = fetchQueue(
      problemResponse(429, { code: ErrorCode.QUOTA_BURST_EXCEEDED }, { 'retry-after': '0' }),
      jsonResponse(envelope()),
    );
    const client = makeClient(fetchMock, { maxRetries: 1 });
    const page = await client.search({ query: 'x' });
    expect(page.total).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces RateLimitError with retryAfter once retries are exhausted', async () => {
    const client = makeClient(
      fetchQueue(
        problemResponse(429, { code: ErrorCode.QUOTA_DAILY_EXHAUSTED }, { 'retry-after': '7' }),
      ),
    );
    const err = (await client.search({ query: 'x' }).catch((e: unknown) => e)) as RateLimitError;
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfter).toBe(7);
    expect(err.code).toBe('quota.daily_exhausted');
  });

  it('retries 503 and a connection that was never made, even on a billed call', async () => {
    const fetchMock = fetchQueue(
      networkError('ECONNREFUSED'),
      problemResponse(503, { code: ErrorCode.AUTH_UNAVAILABLE }, { 'retry-after': '0' }),
      jsonResponse(envelope()),
    );
    const client = makeClient(fetchMock, { maxRetries: 2 });
    await expect(client.search({ query: 'x' })).resolves.toMatchObject({ total: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws APIConnectionError (reachedServer: false) when connections keep being refused', async () => {
    const fetchMock = fetchQueue(networkError('ENOTFOUND'), networkError('EAI_AGAIN'));
    const client = makeClient(fetchMock, { maxRetries: 1 });
    const err = (await client.search({ query: 'x' }).catch((e: unknown) => e)) as APIConnectionError;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.reachedServer).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not repeat a billed call that may have reached the server, and says why', async () => {
    const fetchMock = fetchQueue(new TypeError('fetch failed'), jsonResponse(envelope()));
    const client = makeClient(fetchMock, { maxRetries: 2 });
    const err = (await client.search({ query: 'x' }).catch((e: unknown) => e)) as APIConnectionError;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err.reachedServer).toBe(true);
    expect(err.message).toMatch(/may have reached the server and been charged/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('repeats a free call after the same failure', async () => {
    const fetchMock = fetchQueue(networkError('ECONNRESET'), jsonResponse({ spendable: 1 }));
    const client = makeClient(fetchMock, { maxRetries: 2 });
    await expect(client.credits.retrieve()).resolves.toMatchObject({ spendable: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('finds the not-sent code anywhere in the cause chain', async () => {
    const deep = new TypeError('fetch failed', {
      cause: new Error('connect failed', { cause: Object.assign(new Error('x'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) }),
    });
    const happyEyeballs = new TypeError('fetch failed', {
      cause: Object.assign(new AggregateError([networkError('ECONNREFUSED'), networkError('ECONNREFUSED')]), {}),
    });
    const fetchMock = fetchQueue(deep, happyEyeballs, jsonResponse(envelope()));
    const client = makeClient(fetchMock, { maxRetries: 2 });
    await expect(client.search({ query: 'x' })).resolves.toMatchObject({ total: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never sends a header fetch would reject, and does not echo its value', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock, { maxRetries: 2 });
    const err = await client
      .credits.retrieve({ headers: { 'X-Trace': 'secret\nvalue' } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('ClientValidationError');
    expect((err as Error).message).toContain('X-Trace');
    expect((err as Error).message).not.toContain('secret');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not retry 400', async () => {
    const fetchMock = fetchQueue(problemResponse(400, { code: ErrorCode.REQUEST_INVALID }));
    const client = makeClient(fetchMock, { maxRetries: 3 });
    await expect(client.search({ query: 'x' })).rejects.toBeInstanceOf(InvalidRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('raises a Retry-After beyond 60 s at once, with the value attached', async () => {
    const fetchMock = fetchQueue(
      problemResponse(429, { code: ErrorCode.QUOTA_MONTHLY_EXHAUSTED }, { 'retry-after': '32400' }),
      problemResponse(429, { code: ErrorCode.QUOTA_MONTHLY_EXHAUSTED }, { 'retry-after': 'Wed, 01 Jan 2031 00:00:00 GMT' }),
    );
    const client = makeClient(fetchMock, { maxRetries: 2 });
    const seconds = (await client.credits.retrieve().catch((e: unknown) => e)) as RateLimitError;
    expect(seconds.retryAfter).toBe(32400);
    const date = (await client.credits.retrieve().catch((e: unknown) => e)) as RateLimitError;
    expect(date).toBeInstanceOf(RateLimitError);
    expect(date.retryAfter).toBeGreaterThan(60);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never retries credits.unknown_action, and never retries a 500 on feedback', async () => {
    const fetchMock = fetchQueue(
      problemResponse(500, { code: ErrorCode.CREDITS_UNKNOWN_ACTION }),
      problemResponse(500, { code: ErrorCode.INTERNAL }),
    );
    const client = makeClient(fetchMock, { maxRetries: 2 });
    await expect(client.search({ query: 'x' })).rejects.toBeInstanceOf(InternalServerError);
    await expect(
      client.feedback.create({ subject_ref: { kind: 'request', id: 'req_1' }, target: { kind: 'result_set' } }),
    ).rejects.toBeInstanceOf(InternalServerError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says a charge or a duplicate may have happened when a billed or feedback 502 or 408 is not repeated', async () => {
    const gateway = (status: number) => new Response('<html>Bad Gateway</html>', { status });
    const fetchMock = fetchQueue(gateway(502), gateway(408), gateway(502));
    const client = makeClient(fetchMock, { maxRetries: 2 });

    const billed = (await client.search({ query: 'x' }).catch((e: unknown) => e)) as APIError;
    expect(billed).toBeInstanceOf(APIError);
    expect(billed.reachedServer).toBe(true);
    expect(billed.message).toMatch(/may have reached the server and been charged/);

    const timedOut = (await client.search({ query: 'x' }).catch((e: unknown) => e)) as APIError;
    expect(timedOut.status).toBe(408);
    expect(timedOut.message).toMatch(/been charged/);

    const report = (await client.feedback
      .create({ subject_ref: { kind: 'request', id: 'req_1' }, target: { kind: 'result_set' } })
      .catch((e: unknown) => e)) as APIError;
    expect(report.message).toMatch(/may have reached the server and been recorded/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('adds no consequence note to an error that is not "sent, no answer"', async () => {
    const client = makeClient(fetchQueue(problemResponse(404, { code: 'history.not_found' })));
    const err = (await client.search({ query: 'x' }).catch((e: unknown) => e)) as APIError;
    expect(err.reachedServer).toBe(true);
    expect(err.message).not.toMatch(/may have reached the server/);
  });
});

describe('timeouts and aborts', () => {
  const hang: typeof globalThis.fetch = (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted', 'AbortError')),
      );
    });

  it('times out with APITimeoutError, and a billed call is not repeated after it', async () => {
    let attempts = 0;
    const counted: typeof globalThis.fetch = (input, init) => {
      attempts++;
      return hang(input, init);
    };
    const client = makeClient(counted, { timeoutMs: 20, maxRetries: 2 });
    const err = (await client.search({ query: 'x' }).catch((e: unknown) => e)) as APITimeoutError;
    expect(err).toBeInstanceOf(APITimeoutError);
    expect(err.reachedServer).toBe(true);
    expect(err.timeoutMs).toBe(20);
    expect(attempts).toBe(1);
  });

  it('covers the body read: a body that stalls after the headers times out', async () => {
    const stalling: typeof globalThis.fetch = async (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"spendable":'));
          init?.signal?.addEventListener('abort', () =>
            controller.error(new DOMException('The operation was aborted', 'AbortError')),
          );
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client = makeClient(stalling, { timeoutMs: 20 });
    await expect(client.credits.retrieve()).rejects.toBeInstanceOf(APITimeoutError);
  });

  it('a caller abort during the body read is APIUserAbortError', async () => {
    const controller = new AbortController();
    const stalling: typeof globalThis.fetch = async (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          init?.signal?.addEventListener('abort', () =>
            stream.error(new DOMException('The operation was aborted', 'AbortError')),
          );
          setTimeout(() => controller.abort(), 5);
        },
      });
      return new Response(body, { status: 200 });
    };
    const client = makeClient(stalling, { timeoutMs: 10_000 });
    await expect(client.credits.retrieve({ signal: controller.signal })).rejects.toBeInstanceOf(
      APIUserAbortError,
    );
  });

  it('honors a caller-provided AbortSignal', async () => {
    const client = makeClient(hang, { timeoutMs: 10_000 });
    const controller = new AbortController();
    const pending = client.search({ query: 'x' }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(APIUserAbortError);
  });

  it('supports per-request timeout override', async () => {
    const client = makeClient(hang, { timeoutMs: 10_000 });
    await expect(
      client.search({ query: 'x' }, { timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(APITimeoutError);
  });
});

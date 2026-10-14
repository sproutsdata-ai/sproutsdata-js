import { describe, expect, it } from 'vitest';

import { APIError, ClientValidationError, ErrorCode, InvalidRequestError, SproutsData } from '../src/index';
import { TEST_KEY, envelope, fetchQueue, jsonResponse, problemResponse } from './helpers';

function makeClient(fetchImpl: typeof globalThis.fetch) {
  return new SproutsData({
    apiKey: TEST_KEY,
    baseUrl: 'https://dsp.example.test/backend',
    fetch: fetchImpl,
    maxRetries: 0,
  });
}

describe('members.resolve', () => {
  it('POSTs the email to /v1/members/resolve and reads a member', async () => {
    const body = {
      found: true,
      user_id: 42,
      email: 'ada@example.test',
      role: 'dsp_developer',
      state: 'active',
      meta: envelope().meta,
    };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const member = await client.members.resolve('Ada@Example.test');
    expect(member.found).toBe(true);
    expect(member.user_id).toBe(42);
    expect(member.state).toBe('active');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/members/resolve');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ email: 'Ada@Example.test' });
  });

  it('returns found: false as an answer, not an error', async () => {
    const body = {
      found: false,
      user_id: null,
      email: 'stranger@example.test',
      role: null,
      state: 'unknown',
      meta: envelope().meta,
    };
    const client = makeClient(fetchQueue(jsonResponse(body)));
    const member = await client.members.resolve('stranger@example.test');
    expect(member.found).toBe(false);
    expect(member.state).toBe('unknown');
  });

  it('surfaces "could not determine" as an error, never as found: false', async () => {
    // The server answers an unconfigured environment 503 `request.unsupported`.
    // The class follows the code (contract §5.2); the status stays 503.
    const client = makeClient(
      fetchQueue(problemResponse(503, { code: ErrorCode.REQUEST_UNSUPPORTED, title: 'Not configured' })),
    );
    const failure = (await client.members.resolve('ada@example.test').catch((e: unknown) => e)) as APIError;
    expect(failure).toBeInstanceOf(InvalidRequestError);
    expect(failure.status).toBe(503);
    expect(failure.code).toBe(ErrorCode.REQUEST_UNSUPPORTED);
  });

  it('refuses an empty email before any request', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(client.members.resolve('  ')).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

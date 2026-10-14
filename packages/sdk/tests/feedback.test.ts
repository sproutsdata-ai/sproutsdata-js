import { describe, expect, it } from 'vitest';

import { SproutsData, ClientValidationError, ErrorCode, NotFoundError } from '../src/index';
import { TEST_KEY, fetchQueue, jsonResponse, problemResponse } from './helpers';

function makeClient(fetchImpl: typeof globalThis.fetch, options: { maxRetries?: number } = {}) {
  return new SproutsData({
    apiKey: TEST_KEY,
    baseUrl: 'https://dsp.example.test/backend',
    fetch: fetchImpl,
    maxRetries: 0,
    ...options,
  });
}

const created = {
  feedback_id: 'fb_01',
  created_at: '2026-09-15T10:00:00Z',
  target_verified: true,
  tag_vocab_version: 2,
};

describe('feedback.create', () => {
  it('POSTs the report to /v1/feedback and reads the 201 body', async () => {
    const fetchMock = fetchQueue(jsonResponse(created, 201));
    const client = makeClient(fetchMock);
    const result = await client.feedback.create({
      subject_ref: { kind: 'request', id: 'req_01JB' },
      target: { kind: 'result', entity_id: 'c_1', entity_type: 'company' },
      tags: ['wrong_entity', 'other'],
      comment: 'A payments company, not a lender.',
      expected: { should_include: ['lender.com'], note: 'Lenders only.' },
    });
    expect(result.feedback_id).toBe('fb_01');
    expect(result.target_verified).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/feedback');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({
      subject_ref: { kind: 'request', id: 'req_01JB' },
      target: { kind: 'result', entity_id: 'c_1', entity_type: 'company' },
      tags: ['wrong_entity', 'other'],
      comment: 'A payments company, not a lender.',
      expected: { should_include: ['lender.com'], note: 'Lenders only.' },
    });
  });

  it('refuses structural mistakes before any request', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    const subject = { kind: 'request' as const, id: 'req_01JB' };
    await expect(
      client.feedback.create({
        subject_ref: undefined as unknown as typeof subject,
        target: { kind: 'result_set' },
      }),
    ).rejects.toThrow(/subject_ref/);
    await expect(
      client.feedback.create({ subject_ref: { kind: 'request', id: '' }, target: { kind: 'result_set' } }),
    ).rejects.toThrow(/subject_ref\.id/);
    await expect(
      client.feedback.create({ subject_ref: subject, target: { kind: 'result' } }),
    ).rejects.toThrow(/entity_id.*required/);
    await expect(
      client.feedback.create({
        subject_ref: subject,
        target: { kind: 'result_set', entity_id: 'c_1' },
      }),
    ).rejects.toThrow(/must be omitted/);
    await expect(
      client.feedback.create({ subject_ref: subject, target: { kind: 'result_set' }, tags: [''] }),
    ).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves lengths, counts, vocabularies and the comment rule to the server (contract §11)', async () => {
    const fetchMock = fetchQueue(jsonResponse(created, 201));
    const client = makeClient(fetchMock);
    // A 128-character id: the server's limit, which a mirrored 64 once refused.
    await client.feedback.create({
      subject_ref: { kind: 'request', id: 'r'.repeat(128) },
      target: { kind: 'result_set' },
      tags: [...Array.from({ length: 11 }, () => 'missing'), 'other'],
      sentiment: 'meh' as unknown as 'bad',
      expected: { should_exclude: Array.from({ length: 201 }, (_, i) => `d${i}.com`) },
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.subject_ref.id).toHaveLength(128);
    expect(body.tags).toHaveLength(12);
  });

  it('is not filed twice: a report that may have landed is never retried', async () => {
    const fetchMock = fetchQueue(new TypeError('fetch failed'), jsonResponse({}, 201));
    const client = makeClient(fetchMock, { maxRetries: 2 });
    const err = await client.feedback
      .create({ subject_ref: { kind: 'request', id: 'req_1' }, target: { kind: 'result_set' } })
      .catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/may have reached the server and been recorded/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps a 404 to NotFoundError with code feedback.subject_not_found', async () => {
    const fetchMock = fetchQueue(
      problemResponse(404, { code: 'feedback.subject_not_found', title: 'No such request' }),
    );
    const client = makeClient(fetchMock);
    const failure = await client.feedback
      .create({ subject_ref: { kind: 'agent_run', id: 'run_x' }, target: { kind: 'result_set' } })
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(NotFoundError);
    expect((failure as NotFoundError).code).toBe(ErrorCode.FEEDBACK_SUBJECT_NOT_FOUND);
  });
});

describe('feedback.list', () => {
  const view = {
    feedback_id: 'fb_01',
    subject_kind: 'request',
    subject_id: 'req_01JB',
    target_kind: 'result',
    target_entity_id: 'c_1',
    sentiment: 'bad',
    tags: ['wrong_entity'],
    tag_vocab_version: 2,
    comment: null,
    expected: null,
    target_verified: true,
    status: 'new',
    created_at: '2026-09-15T10:00:00Z',
    subject: {
      query: 'lenders in Germany',
      action_type: 'dsp.search.fast',
      occurred_at: '2026-09-15T09:59:00Z',
      status: 'ok',
      result_count: 25,
      result_total: 1200,
      result_total_is_estimate: true,
      run_id: 42,
    },
  };

  it('GETs /v1/feedback with the serialized filters and offset', async () => {
    const body = { results: [view], total: 7, limit: 5, offset: 5 };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const page = await client.feedback.list({
      subject_id: 'req_01JB',
      status: 'new',
      tag: 'wrong_entity',
      subject_kind: 'request',
      limit: 5,
      offset: 5,
    });
    expect(page.total).toBe(7);
    expect(page.results[0]!.subject!.run_id).toBe(42);
    const parsed = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(parsed.pathname).toBe('/backend/v1/feedback');
    expect(parsed.searchParams.get('subject_id')).toBe('req_01JB');
    expect(parsed.searchParams.get('status')).toBe('new');
    expect(parsed.searchParams.get('tag')).toBe('wrong_entity');
    expect(parsed.searchParams.get('subject_kind')).toBe('request');
    expect(parsed.searchParams.get('limit')).toBe('5');
    expect(parsed.searchParams.get('offset')).toBe('5');
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('GET');
  });

  it('leaves limit, offset and status vocabularies to the server', async () => {
    const fetchMock = fetchQueue(jsonResponse({ results: [], total: 0, limit: 500, offset: -1 }));
    const client = makeClient(fetchMock);
    await client.feedback.list({ limit: 500, offset: -1, status: 'open' as unknown as 'new' });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get('limit')).toBe('500');
    expect(url.searchParams.get('status')).toBe('open');
  });
});

describe('feedback.tags', () => {
  it('GETs /v1/feedback/tags and reads the vocabulary', async () => {
    const body = {
      version: 2,
      tags: [
        {
          tag: 'other',
          applies_to: 'any',
          label: 'Something else',
          description: 'None of these fit.',
          requires_comment: true,
        },
      ],
    };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const vocabulary = await client.feedback.tags();
    expect(vocabulary.version).toBe(2);
    expect(vocabulary.tags[0]!.requires_comment).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/feedback/tags');
    expect(init!.method).toBe('GET');
  });
});

describe('feedback.create — help reports', () => {
  it('sends a help report with no subject', async () => {
    const fetchMock = fetchQueue(jsonResponse(created, 201));
    await makeClient(fetchMock).feedback.create({
      context: 'help',
      target: { kind: 'result_set' },
      comment: 'The export button does nothing.',
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      context: 'help',
      target: { kind: 'result_set' },
      comment: 'The export button does nothing.',
    });
  });

  it('accepts a tag instead of a comment, and a subject when there is one', async () => {
    const fetchMock = fetchQueue(jsonResponse(created, 201));
    await makeClient(fetchMock).feedback.create({
      context: 'help',
      subject_ref: { kind: 'request', id: 'req_1' },
      target: { kind: 'result_set' },
      tags: ['other'],
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.subject_ref).toEqual({ kind: 'request', id: 'req_1' });
    expect(body.tags).toEqual(['other']);
  });

  it.each([
    ['no comment or tag', { context: 'help', target: { kind: 'result_set' }, comment: '  ' }],
    ['one record', { context: 'help', target: { kind: 'result', entity_id: 'c_1' }, comment: 'x' }],
    ['another context', { context: 'support', target: { kind: 'result_set' }, comment: 'x' }],
    ['no subject outside help', { target: { kind: 'result_set' }, comment: 'x' }],
  ])('refuses %s before sending', async (_label, params) => {
    const fetchMock = fetchQueue();
    await expect(
      makeClient(fetchMock).feedback.create(params as Parameters<SproutsData['feedback']['create']>[0]),
    ).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('feedback.votes', () => {
  const view = {
    vote_id: 'vote_1',
    request_id: 'req_1',
    level: 'result_set',
    entity_category: 'company',
    entity_id: null,
    vote: 'dislike',
    reason_code: 'too_few',
    text: null,
    created_at: '2026-10-14T00:00:00Z',
  };

  it('PUTs a vote on a whole answer, inferring the level', async () => {
    const fetchMock = fetchQueue(jsonResponse({ vote: view, changed: true }));
    const cast = await makeClient(fetchMock).feedback.votes.cast({
      request_id: 'req_1',
      vote: 'dislike',
      entity_category: 'company',
      reason_code: 'too_few',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/feedback/votes');
    expect(init!.method).toBe('PUT');
    expect(JSON.parse(init!.body as string)).toEqual({
      request_id: 'req_1',
      vote: 'dislike',
      entity_category: 'company',
      reason_code: 'too_few',
      level: 'result_set',
    });
    expect((init!.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined();
    expect(cast.changed).toBe(true);
  });

  it('flags one record with its id and text', async () => {
    const fetchMock = fetchQueue(
      jsonResponse({ vote: { ...view, level: 'result', entity_id: 'stripe.com', vote: 'flag' }, changed: false }),
    );
    const cast = await makeClient(fetchMock).feedback.votes.cast({
      request_id: 'req_1',
      vote: 'flag',
      entity_category: 'company',
      entity_id: 'stripe.com',
      reason_code: 'outdated',
      text: 'Acquired in 2025',
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.level).toBe('result');
    expect(body.entity_id).toBe('stripe.com');
    expect(cast.changed).toBe(false);
  });

  it.each([
    ['a record vote without its record', { request_id: 'r', vote: 'flag', entity_category: 'company', level: 'result' }],
    [
      'a set vote naming a record',
      { request_id: 'r', vote: 'like', entity_category: 'company', entity_id: 'a.com', level: 'result_set' },
    ],
    ['text without a reason', { request_id: 'r', vote: 'dislike', entity_category: 'company', text: 'meh' }],
    ['no answer id', { request_id: ' ', vote: 'like', entity_category: 'company' }],
  ])('refuses %s before sending', async (_label, params) => {
    const fetchMock = fetchQueue();
    await expect(
      makeClient(fetchMock).feedback.votes.cast(
        params as Parameters<SproutsData['feedback']['votes']['cast']>[0],
      ),
    ).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the vote vocabulary to the server', async () => {
    const fetchMock = fetchQueue(problemResponse(422, { code: 'request.invalid' }));
    await expect(
      makeClient(fetchMock).feedback.votes.cast({ request_id: 'r', vote: 'love', entity_category: 'company' }),
    ).rejects.toThrow();
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).vote).toBe('love');
  });

  it('retries a vote after a server error, since a repeat changes nothing', async () => {
    const fetchMock = fetchQueue(
      problemResponse(500, { code: 'internal' }),
      jsonResponse({ vote: view, changed: false }),
    );
    await makeClient(fetchMock, { maxRetries: 2 }).feedback.votes.cast({
      request_id: 'r',
      vote: 'dislike',
      entity_category: 'company',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([null, ''])('treats an entity_id of %j as none', async (entityId) => {
    const fetchMock = fetchQueue(jsonResponse({ vote: { ...view, vote: 'like' }, changed: true }));
    await makeClient(fetchMock).feedback.votes.cast({
      request_id: 'req_1',
      vote: 'like',
      entity_category: 'company',
      entity_id: entityId as unknown as string,
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.level).toBe('result_set');
    expect('entity_id' in body).toBe(false);
  });

  it("lists this key's votes on one answer", async () => {
    const fetchMock = fetchQueue(jsonResponse({ request_id: 'req_1', votes: [view] }));
    const votes = await makeClient(fetchMock).feedback.votes.list('req_1');
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe('/backend/v1/feedback/votes');
    expect(url.searchParams.get('request_id')).toBe('req_1');
    expect(votes.votes[0]!.vote).toBe('dislike');
  });

  it('refuses to list without an answer id', async () => {
    const fetchMock = fetchQueue();
    await expect(makeClient(fetchMock).feedback.votes.list('')).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

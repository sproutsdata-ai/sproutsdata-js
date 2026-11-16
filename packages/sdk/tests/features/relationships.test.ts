/** Relationships (R1-R6): find, reach, institutions and ask. */

import { describe, expect, it } from 'vitest';

import { ClientValidationError, InvalidRequestError } from '../../src/core/errors.js';
import { Relationships } from '../../src/resources/relationships.js';
import type { ReachEnvelope, RelationshipRequest } from '../../src/types/index.js';
import { assertValidRequest, recorded, recordedBody, respond } from '../support/answers.js';
import { collect, rig } from '../support/rig.js';

const REACH = recordedBody<ReachEnvelope>('relationships_reach', 'person_to_company');
const PERSON = { li_url: 'https://www.linkedin.com/in/e2e-person' };
const STRIPE = { value: 'stripe.com', by: 'domain' } as const;

const reachPage = (rows: number, cursor: string | null): ReachEnvelope => ({ ...REACH, results: Array.from({ length: rows }, () => REACH.results).flat().slice(0, rows), next_cursor: cursor, has_more: cursor !== null });

describe('relationships', () => {
  it('R1: reach targets carry id', async () => {
    const targets = [{ index: 0, value: 'stripe.com', id: 'd1_stripe', domain: 'stripe.com', name: 'Stripe', total: 4 }];
    const r = rig([respond('relationships_reach', 200, { ...reachPage(1, null), targets })]);
    const page = await new Relationships(r.transport).reach({ person: PERSON, target_company: STRIPE, limit: 2 });
    expect(page.targets?.[0]?.id).toBe('d1_stripe');
    expect(r.body()).toEqual({ person: PERSON, target_company: STRIPE, limit: 2 });
    assertValidRequest('relationships_reach', r.body());
  });

  it('R2: ask reads its cost from meta', async () => {
    const r = rig([recorded('relationships_ask', 'in_words')]);
    const answer = await new Relationships(r.transport).ask({ query: 'who at Stripe used to work at Adyen' });
    expect(answer.meta.credits_charged).toBe(2);
    expect(answer.credits_charged).toBeNull();
    expect(answer.route).toBe('relationships');
  });

  it('R3: reach keeps the first page size and trims locally', async () => {
    const r = rig([respond('relationships_reach', 200, reachPage(5, 'c1')), respond('relationships_reach', 200, reachPage(5, 'c2'))]);
    const rows = await collect(new Relationships(r.transport).iterReach({ person: PERSON, target_company: STRIPE, limit: 5, maxResults: 7 }));
    expect(rows).toHaveLength(7);
    expect(r.sent.map((s) => (s.body as { limit: number }).limit)).toEqual([5, 5]);
    expect((r.body(1) as { cursor: string }).cursor).toBe('c1');
  });

  it('R3: a short maxResults asks page one for fewer', async () => {
    const r = rig([respond('relationships_reach', 200, reachPage(3, 'c1'))]);
    const rows = await collect(new Relationships(r.transport).iterReach({ person: PERSON, target_company: STRIPE, maxResults: 3 }));
    expect(rows).toHaveLength(3);
    expect((r.body() as { limit: number }).limit).toBe(3);
    expect(r.sent).toHaveLength(1);
  });

  it('R4: an anchor that matched nothing is an invalid request', async () => {
    const problem = { type: 'about:blank', title: 'Anchor not found', status: 422, code: 'relationship.anchor_not_found', detail: "nothing matched 'nope.example'", request_id: 'r' };
    const r = rig([respond('relationships', 422, problem)]);
    const error = await new Relationships(r.transport).find({ companies: [STRIPE, { value: 'nope.example' }] }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(InvalidRequestError);
    expect((error as InvalidRequestError).code).toBe('relationship.anchor_not_found');
  });

  it('R5: ask pages by sending the nested cursor back', async () => {
    const r = rig([recorded('relationships_ask', 'in_words')]);
    await new Relationships(r.transport).ask({ query: 'who at Stripe used to work at Adyen', limit: 5, cursor: 'c1' });
    expect(r.body()).toEqual({ query: 'who at Stripe used to work at Adyen', limit: 5, cursor: 'c1' });
    assertValidRequest('relationships_ask', r.body());
  });

  it('R6: find and institutions page and send no idempotency key', async () => {
    const first = recordedBody<{ results: unknown[]; next_cursor: string }>('relationships', 'between_companies');
    const r = rig([respond('relationships', 200, first), respond('relationships', 200, { ...first, next_cursor: null, has_more: false }), recorded('relationships_institutions', 'shared')]);
    const relationships = new Relationships(r.transport);
    const rows = await collect(relationships.iterFind({ companies: [STRIPE, { value: 'adyen.com', by: 'domain' }], limit: 2 }));
    await relationships.institutions({ companies: [STRIPE, { value: 'adyen.com' }], institution_type: 'education' });
    expect(rows).toHaveLength(2 * first.results.length);
    expect((r.body(1) as { cursor: string }).cursor).toBe(first.next_cursor);
    expect(r.sent.every((s) => !s.headers.has('idempotency-key'))).toBe(true);
    for (const [index, op] of ['relationships', 'relationships', 'relationships_institutions'].entries()) assertValidRequest(op, r.body(index));
  });

  it.each([
    [{}, 'provide `query` for a question in words'],
    [{ query: 'x', companies: [STRIPE] }, 'not both: companies'],
    [{ query: 'x', exclude_current: true }, 'not both: exclude_current'],
    [{ companies: [STRIPE] }, 'takes exactly two companies'],
    [{ relation: 'via_institution', companies: [STRIPE] }, 'needs at least one institution'],
    [{ relation: 'via_institution', companies: [STRIPE, STRIPE] }, 'takes exactly one company'],
    [{ relation: 'via_institution', companies: [STRIPE], institutions: [{ value: 'MIT' }], institutions_combine: 'all' }, 'two or more institutions'],
  ])('R6: find refuses what the server refuses (%#)', async (params, reason) => {
    const r = rig([]);
    await expect(new Relationships(r.transport).find(params as RelationshipRequest)).rejects.toThrow(reason);
    expect(r.sent).toHaveLength(0);
  });

  it('R3: reach refuses a profile that is not a person, and people on the target', async () => {
    const relationships = new Relationships(rig([]).transport);
    await expect(relationships.reach({ person: { li_url: 'https://linkedin.com/company/x' }, target_company: STRIPE })).rejects.toThrow('LinkedIn *person* URL');
    await expect(relationships.reach({ person: PERSON, target_company: { ...STRIPE, people: { seniority: ['VP'] } } })).rejects.toBeInstanceOf(ClientValidationError);
  });
});

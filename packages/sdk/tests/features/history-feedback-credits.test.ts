/** History (H1-H4), feedback (B1-B6) and credits (K1-K3). */

import { describe, expect, it } from 'vitest';

import { ClientValidationError, InsufficientCreditsError, WalletFrozenError } from '../../src/core/errors.js';
import { Credits } from '../../src/resources/credits.js';
import { Feedback } from '../../src/resources/feedback.js';
import { EFFORT_NAMES } from '../../src/requests/effort.js';
import { canAfford } from '../../src/resources/helpers.js';
import { History } from '../../src/resources/history.js';
import { Search } from '../../src/resources/search.js';
import type { HistoryParams, QuoteIn, VoteParams } from '../../src/types/index.js';
import { assertValidRequest, recorded, recordedBody, respond } from '../support/answers.js';
import { collect, rig } from '../support/rig.js';

const RECENT = recordedBody<{ next_cursor: string; results: { id: string; credits_charged: string | null }[] }>('history_list', 'recent');
const MINE = recordedBody<{ results: unknown[] }>('feedback_list', 'mine');
const TARGET = { kind: 'result_set' } as const;
const SUBJECT = { kind: 'request', id: '7a7acf7908514371b0fa2966a16158bd' } as const;

describe('history', () => {
  it('H1: history pages on next_cursor, with no meta and no has_more', async () => {
    const r = rig([respond('history_list', 200, RECENT), respond('history_list', 200, { ...RECENT, next_cursor: null })]);
    const rows = await collect(new History(r.transport).iterList({ limit: 50 }));
    expect(rows).toHaveLength(2 * RECENT.results.length);
    expect(r.query(1)).toEqual({ limit: '50', cursor: RECENT.next_cursor });
    expect(RECENT).not.toHaveProperty('meta');
    expect(RECENT).not.toHaveProperty('has_more');
  });

  it('H2: costs may be null, decimals are strings, and ids go back as they are', async () => {
    const r = rig([recorded('history_list', 'recent'), recorded('history_retrieve', 'one_run')]);
    const history = new History(r.transport);
    const page = await history.list();
    const first = page.results[0];
    await history.retrieve(first?.id ?? '');
    expect(page.results.some((row) => row.credits_charged === null)).toBe(true);
    expect(page.results.filter((row) => row.credits_charged !== null).every((row) => typeof row.credits_charged === 'string')).toBe(true);
    expect(first?.id).toMatch(/^\d+$/);
    expect(r.sent[1]?.url.pathname).toMatch(new RegExp(`/v1/usage/history/${first?.id ?? ''}$`));
  });

  it('H3: action_type takes one action', async () => {
    const r = rig([recorded('history_list', 'recent')]);
    const history = new History(r.transport);
    await history.list({ action_type: 'dsp.search.fast', from: new Date(Date.UTC(2026, 10, 1)), to: '2026-11-11T00:00:00Z' });
    await expect(history.list({ action_type: ['a', 'b'] } as unknown as HistoryParams)).rejects.toThrow('action_type takes one action');
    expect(r.query()).toEqual({ action_type: 'dsp.search.fast', from: '2026-11-01T00:00:00.000Z', to: '2026-11-11T00:00:00Z' });
    expect(r.sent).toHaveLength(1);
  });

  it('H4: snapshot_state, and the resolved search', async () => {
    const detail = { ...recordedBody('history_retrieve', 'one_run'), snapshot_state: 'continuation' };
    const r = rig([respond('history_retrieve', 200, detail), recorded('history_metrics', 'workspace')]);
    const history = new History(r.transport);
    const run = await history.retrieve('69');
    const metrics = await history.metrics({ from: '2026-11-01T00:00:00Z' });
    expect(run.snapshot_state).toBe('continuation');
    // Kept for searches only (dsp-backend 2f4973b); the recorded run is an org chart.
    expect(run.resolved_search).toBeNull();
    expect(typeof metrics.total_credits).toBe('string');
    expect(r.query(1)).toEqual({ from: '2026-11-01T00:00:00Z' });
  });
});

describe('feedback', () => {
  it('B1: reports page by cursor', async () => {
    const r = rig([respond('feedback_list', 200, { ...MINE, next_cursor: 'c1' }), respond('feedback_list', 200, MINE)]);
    const feedback = new Feedback(r.transport);
    const rows = await collect(feedback.iterList({ limit: 100 }));
    expect(rows).toHaveLength(2 * MINE.results.length);
    expect(r.query(1)).toEqual({ limit: '100', cursor: 'c1' });
    await expect(feedback.list({ limit: 101 })).rejects.toThrow('limit must be an integer between 1 and 100');
  });

  it('B2: reports read subject_ref and target', async () => {
    const r = rig([recorded('feedback_list', 'mine')]);
    const page = await new Feedback(r.transport).list();
    expect(page.results[0]?.subject_ref?.kind).toBe('request');
    expect(page.results[0]?.target.kind).toBe('result_set');
  });

  it('B3: create is keyed, and a report with no subject is a help report', async () => {
    const busy = { type: 'about:blank', title: 'Busy', status: 503, code: 'service.unavailable', detail: 'busy', request_id: 'r' };
    const r = rig([respond('feedback_create', 503, busy, { 'retry-after': '1' }), recorded('feedback_create', 'on_a_search'), recorded('feedback_create', 'on_a_search')]);
    const feedback = new Feedback(r.transport);
    await feedback.create({ target: TARGET, subject_ref: SUBJECT, comment: 'e2e' });
    await feedback.create({ target: TARGET, comment: 'how do I page?' }, { idempotencyKey: 'help-1' });
    const keys = r.sent.map((s) => s.headers.get('idempotency-key'));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe('help-1');
    expect(r.body(2)).not.toHaveProperty('subject_ref');
    for (const index of [0, 1, 2]) assertValidRequest('feedback_create', r.body(index));
    await expect(feedback.create({ target: TARGET, tags: ['other'] })).rejects.toThrow('`other` needs a comment');
  });

  it('B4: list takes only a page', async () => {
    const r = rig([recorded('feedback_list', 'mine')]);
    await new Feedback(r.transport).list({ limit: 5, cursor: 'c1' });
    expect(r.query()).toEqual({ limit: '5', cursor: 'c1' });
  });

  it('B5: tags read level', async () => {
    const r = rig([recorded('feedback_tags', 'vocabulary')]);
    const tags = await new Feedback(r.transport).tags();
    expect(tags.tags.every((tag) => ['result', 'result_set', 'any'].includes(tag.level))).toBe(true);
    expect(tags.tags[0]).not.toHaveProperty('applies_to');
  });

  it('B6: votes like a result set and flag a result', async () => {
    const r = rig([recorded('feedback_vote', 'result_set_like'), recorded('feedback_vote', 'result_flag'), recorded('feedback_votes_list', 'on_a_search')]);
    const { votes } = new Feedback(r.transport);
    await votes.cast({ request_id: 'rid', level: 'result_set', vote: 'like', entity_category: 'company' });
    await votes.cast({ request_id: 'rid', level: 'result', vote: 'flag', entity_category: 'company', entity_id: 'example-1.de', reason_code: 'wrong_company' });
    const listed = await votes.list({ request_id: 'rid' });
    expect(r.body(0)).toEqual({ request_id: 'rid', level: 'result_set', vote: 'like', entity_category: 'company' });
    for (const index of [0, 1]) assertValidRequest('feedback_vote', r.body(index));
    expect(r.query(2)).toEqual({ request_id: 'rid' });
    expect(listed.votes[0]).not.toHaveProperty('created_at');
  });

  it.each([
    [{ level: 'result', vote: 'like', entity_id: 'x' }, 'takes only a `flag`'],
    [{ level: 'result', vote: 'flag' }, 'naming its `entity_id`'],
    [{ level: 'result_set', vote: 'flag' }, 'takes `like` or `dislike`'],
    [{ level: 'result_set', vote: 'like', reason_code: 'stale' }, 'a `like` takes no reason'],
    [{ level: 'result_set', vote: 'dislike', text: 'why' }, '`text` comes after a reason'],
  ])('B6: votes refuse what the server refuses (%#)', async (fields, reason) => {
    const r = rig([]);
    await expect(new Feedback(r.transport).votes.cast({ request_id: 'rid', entity_category: 'company', ...fields } as VoteParams)).rejects.toThrow(reason);
    expect(r.sent).toHaveLength(0);
  });
});

describe('credits', () => {
  it('K1: the balance, and canAfford on available', async () => {
    // An agent run holds 17.
    const held = { ...recordedBody<object>('credits_retrieve', 'balance'), balance: 919.215, reserved: 17, available: 902.215 };
    const r = rig([respond('credits_retrieve', 200, held)]);
    const balance = await new Credits(r.transport).retrieve();
    expect([balance.balance, balance.reserved, balance.available, balance.debt]).toEqual([919.215, 17, 902.215, 0]);
    expect([balance.status, balance.has_paid, balance.stale]).toEqual(['active', false, false]);
    expect(canAfford(balance, 902.215)).toBe(true);
    expect(canAfford(balance, 910)).toBe(false);
  });

  it('K4: a quote sends what was set and reads the price', async () => {
    const r = rig([recorded('credits_quote', 'search_page'), recorded('credits_quote', 'agent_run')]);
    const credits = new Credits(r.transport);
    const page = await credits.quote({ operation: 'search', rows: 25, start: 10 });
    const run = await credits.quote({ operation: 'agent_run', effort: 'detailed' });
    expect(r.body(0)).toEqual({ operation: 'search', rows: 25, start: 10 });
    expect(r.body(1)).toEqual({ operation: 'agent_run', effort: 'detailed' });
    expect([page.basis, run.basis]).toEqual(['page', 'run']);
    expect(page.credits).toBeGreaterThan(0);
    expect(run.covered).not.toBeNull();
  });

  it.each(Object.entries(EFFORT_NAMES))('K4: an earlier effort name is quoted by its new one: %s', async (earlier, current) => {
    const r = rig([recorded('credits_quote', 'agent_run')]);
    await new Credits(r.transport).quote({ operation: 'agent_run', effort: earlier as NonNullable<QuoteIn['effort']> });
    expect(r.body()).toEqual({ operation: 'agent_run', effort: current });
  });

  it('K4: an enrichment quote takes up to thirty thousand values', async () => {
    const r = rig([recorded('credits_quote', 'search_page')]);
    await new Credits(r.transport).quote({ operation: 'enrichment', rows: 30_000 });
    expect(r.body()).toEqual({ operation: 'enrichment', rows: 30_000 });
  });

  it('K4: an enrichment quote by fields prices each field at its own price', async () => {
    const r = rig([recorded('credits_quote', 'enrichment')]);
    const quote = await new Credits(r.transport).quote({ operation: 'enrichment', rows: 3, fields: ['EMAIL', 'PHONE'] });
    expect(r.body()).toEqual({ operation: 'enrichment', rows: 3, fields: ['EMAIL', 'PHONE'] });
    expect([quote.basis, quote.credits]).toEqual(['values_up_to', 30]); // an email 1 and a phone 9, for 3 records
  });

  it.each([
    [{ operation: 'agent_run' }, /`effort` is required for agent_run/],
    [{ operation: 'search', effort: 'high' }, /`effort` is required for agent_run/],
    [{ operation: 'similar', rows: 101 }, /a page holds at most 100 rows/],
    [{ operation: 'lookup', rows: 1001 }, /a lookup takes at most 1,000 records/],
    [{ operation: 'enrichment', rows: 30_001 }, /rows/],
    [{ operation: 'search', fields: ['EMAIL'] }, /`fields` applies to enrichment only/],
    [{ operation: 'enrichment', fields: ['EMAIL', 'EMAIL'] }, /`fields` must not repeat/],
    [{ operation: 'enrichment', fields: [] }, /fields/],
    [{ operation: 'enrichment', fields: ['NAME'] }, /fields/],
    [{ operation: 'enrichment', rows: 10_001, fields: ['EMAIL'] }, /a job takes at most 10,000 rows/],
    [{ operation: 'refund' }, /operation/],
  ])('K4: a quote the server would refuse is refused locally: %j', async (params, message) => {
    const r = rig([]);
    await expect(new Credits(r.transport).quote(params as QuoteIn)).rejects.toThrow(message);
    expect(r.sent).toHaveLength(0);
  });

  it('K4: a lookup quote takes up to a thousand records', async () => {
    const r = rig([recorded('credits_quote', 'search_page')]);
    await new Credits(r.transport).quote({ operation: 'lookup', rows: 1000 });
    expect(r.body(0)).toEqual({ operation: 'lookup', rows: 1000 });
  });

  it('K2: transactions page by cursor, with signed credits', async () => {
    const first = { ...recordedBody<{ results: { kind: string; credits: number }[] }>('credits_transactions', 'first_page'), next_cursor: 'c1' };
    const r = rig([respond('credits_transactions', 200, first), respond('credits_transactions', 200, { ...first, next_cursor: null }), recorded('credits_transactions', 'first_page')]);
    const credits = new Credits(r.transport);
    const rows = await collect(credits.iterTransactions({ limit: 50 }));
    const page = await credits.transactions({ limit: 10, cursor: 'c9' });
    expect(rows).toHaveLength(2 * first.results.length);
    expect([r.query(1), r.query(2)]).toEqual([{ limit: '50', cursor: 'c1' }, { limit: '10', cursor: 'c9' }]);
    expect(page.results.filter((row) => row.kind === 'charge').every((row) => row.credits < 0)).toBe(true);
    await expect(credits.transactions({ limit: 0 })).rejects.toBeInstanceOf(ClientValidationError);
  });

  it('K3: a frozen wallet throws its class and is never retried', async () => {
    const problem = { type: 'about:blank', title: 'Wallet frozen', status: 402, code: 'credits.wallet_frozen', detail: 'frozen', request_id: 'r' };
    const r = rig([respond('search', 402, problem)]);
    const error = await new Search(r.transport).search({ query: 'x' }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WalletFrozenError);
    expect(error).toBeInstanceOf(InsufficientCreditsError);
    expect(r.sent).toHaveLength(1);
  });
});

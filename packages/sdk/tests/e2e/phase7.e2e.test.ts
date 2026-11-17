/** Phase 7 live: history, feedback, credits and quotes on the real stack. */

import { describe, expect, it } from 'vitest';

import { ClientValidationError, NotFoundError } from '../../src/core/errors.js';
import { canAfford } from '../../src/resources/helpers.js';
import type { ReportView } from '../../src/types/index.js';
import { collect } from '../support/rig.js';
import { client, raw, setting, STACK } from './stack.js';

/**
 * A report once the history has recorded its subject: dsp-backend writes history rows in
 * background batches after the answer, so a report on a request made a moment ago answers
 * `feedback.subject_not_found` until the batch lands.
 */
async function reported(report: () => Promise<ReportView>): Promise<ReportView> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return await report();
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return report();
}

describe.skipIf(STACK === undefined)('phase 7, live', () => {
  it('history pages past page one, and a row is retrieved by its id', async () => {
    const sdk = client();
    const rows = await collect(sdk.history.iterList({ limit: 5, maxResults: 12 }));
    const detail = await sdk.history.retrieve(rows[0]?.id ?? '');
    const metrics = await sdk.history.metrics();
    expect(rows).toHaveLength(12);
    expect(detail.id).toBe(rows[0]?.id);
    expect(metrics.total_requests).toBeGreaterThan(0);
  });

  it('feedback: reports, tags and votes', async () => {
    const sdk = client();
    const page = await sdk.search({ query: 'robotics', limit: 1 });
    const requestId = page.meta.request_id;
    const report = await reported(() => sdk.feedback.create({ target: { kind: 'result_set' }, subject_ref: { kind: 'request', id: requestId }, comment: 'e2e' }));
    const help = await sdk.feedback.create({ target: { kind: 'result_set' }, comment: 'how do I page?' });
    const reports = await collect(sdk.feedback.iterList({ limit: 1, maxResults: 2 }));
    const tags = await sdk.feedback.tags();
    const liked = await sdk.feedback.votes.cast({ request_id: requestId, level: 'result_set', vote: 'like', entity_category: 'company' });
    const flagged = await sdk.feedback.votes.cast({ request_id: requestId, level: 'result', vote: 'flag', entity_category: 'company', entity_id: page.results[0]?.id ?? '' });
    const votes = await sdk.feedback.votes.list({ request_id: requestId });
    expect(report.subject_ref).not.toBeNull();
    expect(help.subject_ref).toBeNull();
    expect(reports).toHaveLength(2);
    expect(tags.tags.length).toBeGreaterThan(0);
    expect([liked.vote.vote, flagged.vote.vote]).toEqual(['like', 'flag']);
    expect(votes.votes).toHaveLength(2);
  });

  it('a search writes a charge into the ledger', async () => {
    const sdk = client();
    const balance = await sdk.credits.retrieve();
    const newest = (await sdk.credits.transactions({ limit: 1 })).results[0]?.id;
    await sdk.search({ query: 'robotics in Germany', limit: 1 });
    const after = (await sdk.credits.transactions({ limit: 10 })).results;
    const fresh = after.slice(0, after.findIndex((row) => row.id === newest));
    const charge = fresh.find((row) => row.kind === 'charge');
    expect(charge?.credits).toBeLessThan(0);
    expect(charge?.action?.startsWith('dsp.search')).toBe(true);
    expect(canAfford(balance, 0.5)).toBe(true);
  });

  it('a quote is what the meter then charges', async () => {
    const sdk = client();
    const quote = await sdk.credits.quote({ operation: 'search', rows: 1 });
    const page = await sdk.search({ query: 'robotics', limit: 1 });
    expect(quote.basis).toBe('page');
    // `available` and `covered` rest on a balance read moments ago: null on a cold cache.
    if (quote.available !== null) expect(quote.covered).toBe(quote.available >= quote.credits);
    expect(page.meta.credits_charged).toBe(quote.credits);
    expect(page.meta.credits_balance).not.toBeNull();
  });

  it('a quote the SDK refuses is the server\'s refusal', async () => {
    await expect(client().credits.quote({ operation: 'agent_run' })).rejects.toBeInstanceOf(ClientValidationError);
    expect((await raw('POST', '/v1/credits/quote', { operation: 'agent_run' })).status).toBe(422);
  });

  it('an error says what to do next', async () => {
    const failure: unknown = await client().history.retrieve('999999999').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NotFoundError);
    const error = failure as NotFoundError;
    expect(error.code).toBe('history.not_found');
    expect(error.nextStep).toBeTruthy();
    expect(error.message).toContain(error.nextStep ?? '');
  });

  it('a retired test key is refused by the server too', async () => {
    // The SDK refuses `sk_dsp_test_` before sending (`checkApiKey`); dsp-auth refuses one at
    // exchange, which reaches the caller as a bare 401.
    const answer = await fetch(`${setting('SPROUTSDATA_E2E_BASE_URL')}/v1/credits`, {
      headers: { 'X-API-Key': 'sk_dsp_test_' + 'retired-e2e-key' },
    });
    const body = (await answer.json()) as { code: string };
    expect(answer.status).toBe(401);
    expect(body.code.startsWith('auth.')).toBe(true);
  });
});

/**
 * Enrichment live: jobs, lookups and their refusals through the real backend and ledger.
 *
 * The stack's fake dsp-enrichment answers by its inputs (sproutsdata-py
 * `e2e/fake_enrichment.py`): a name with `MISSING` is not found, a LinkedIn URL with `CACHED`
 * is already held (and free), an `external_id` with `SLOW` outlasts a lookup, and the cursor
 * `e2e-expired` reads rows that are no longer kept. Prices are the backend's defaults: an
 * email 1 credit, a phone number 9.
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ClientValidationError, ConflictError, InvalidRequestError, NotFoundError, PermissionDeniedError, ResultsExpiredError } from '../../src/core/errors.js';
import { collect } from '../support/rig.js';
import { client, raw, setting, STACK } from './stack.js';

const ADA = { full_name: 'Ada Example', company_domain: 'example-1.de', external_id: 'row-1' };
const FOUND = [ADA, { linkedin_url: 'https://www.linkedin.com/in/e2e-cached', external_id: 'CACHED-2' }];
const MISSED = { full_name: 'MISSING Person', company_domain: 'example-3.de' };
const QUICK = { pollIntervalMs: 100 };

describe.skipIf(STACK === undefined)('enrichment, live', () => {
  it('a job from start to its rows is charged for the values found', async () => {
    const sdk = client();
    const handle = await sdk.enrichment.create({ items: [...FOUND, MISSED], fields: ['EMAIL', 'PHONE'], name: 'e2e' });
    const job = await sdk.enrichment.wait(handle.job_id, QUICK);
    const rows = await collect(sdk.enrichment.iterResults(handle.job_id));
    const listed = await sdk.enrichment.list({ limit: 100 });
    // The engine ends a batch with a miss `completed_with_errors`; it reads `completed`.
    expect(job.status).toBe('completed');
    // Each value found live at its field's price, the cached ones and the misses free.
    expect([job.credits_charged, job.credits_used, job.values_found]).toEqual([10, 10, 2]);
    expect(rows.map((row) => row.credits)).toEqual([10, 0, 0]);
    expect(rows.map((row) => row.values_found)).toEqual([2, 0, 0]);
    expect(rows.map((row) => row.outcome)).toEqual(['found', 'found', 'not_found']);
    const summary = listed.results.find((j) => j.job_id === handle.job_id);
    expect([summary?.status, summary?.values_found]).toEqual(['completed', 2]);
  });

  it('a lookup answers in the call, and one that did not finish becomes a job', async () => {
    const sdk = client();
    const found = await sdk.enrichment.lookup({ items: [ADA, MISSED], fields: ['EMAIL'] });
    const cut = await sdk.enrichment.lookup({ items: [{ ...ADA, external_id: 'SLOW-1' }], fields: ['EMAIL'] });
    const ended = await sdk.enrichment.wait(cut.job_id, QUICK);
    expect(found.complete).toBe(true);
    expect(found.results.map((row) => row.outcome)).toEqual(['found', 'not_found']);
    // The engine's reason, mapped; a found value's (which names its vendor) is never sent.
    expect(found.results.map((row) => row.fields['EMAIL']?.reason ?? null)).toEqual([null, 'not_found']);
    expect(found.meta.credits_charged).toBe(1); // the miss is free
    expect([found.values_found, found.results.map((row) => row.values_found)]).toEqual([1, [1, 0]]);
    expect(cut.complete).toBe(false);
    expect(ended.status).toBe('completed');
  });

  it('a key replays its job and refuses another body', async () => {
    const sdk = client();
    const idempotencyKey = `e2e-replay-${randomUUID().slice(0, 8)}`;
    const first = await sdk.enrichment.create({ items: FOUND, fields: ['EMAIL'] }, { idempotencyKey });
    const again = await sdk.enrichment.create({ items: FOUND, fields: ['EMAIL'] }, { idempotencyKey });
    expect(again.job_id).toBe(first.job_id);
    expect(again.reused).toBe(true);
    await expect(sdk.enrichment.create({ items: FOUND, fields: ['PHONE'] }, { idempotencyKey })).rejects.toBeInstanceOf(ConflictError);
  });

  it('a job is cancelled, and cancelling it again reads it', async () => {
    const sdk = client();
    const handle = await sdk.enrichment.create({ entity: 'accounts', items: [{ company_name: 'Example 9' }], fields: ['DOMAIN'] });
    expect((await sdk.enrichment.cancel(handle.job_id)).status).toBe('cancelled');
    expect((await sdk.enrichment.cancel(handle.job_id)).status).toBe('cancelled');
  });

  it("expired rows, an unknown job and a local refusal are the server's", async () => {
    const sdk = client();
    const handle = await sdk.enrichment.create({ items: [ADA], fields: ['EMAIL'] });
    await expect(sdk.enrichment.results(handle.job_id, { cursor: 'e2e-expired' })).rejects.toBeInstanceOf(ResultsExpiredError);
    const missing = await sdk.enrichment.retrieve(randomUUID()).catch((err: unknown) => err);
    expect(missing).toBeInstanceOf(NotFoundError);
    expect((missing as NotFoundError).code).toBe('enrichment.job_not_found');
    const wrong = { entity: 'accounts', items: [{ company_name: 'A' }], fields: ['EMAIL'] } as const;
    await expect(sdk.enrichment.lookup(wrong)).rejects.toThrow(ClientValidationError);
    await expect(sdk.enrichment.lookup(wrong)).rejects.toThrow('accounts are enriched for');
    expect((await raw('POST', '/v1/enrichment/lookups', wrong)).status).toBe(422);
  });

  it('a key with the default scopes cannot enrich', async () => {
    const sdk = client({ key: setting('SPROUTSDATA_E2E_DEFAULT_SCOPES_KEY') });
    await expect(sdk.enrichment.lookup({ items: [ADA], fields: ['EMAIL'] })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('a quote holds every value asked for at its price, up to a job\'s most', async () => {
    const fields = ['EMAIL', 'PHONE'] as const;
    const quote = await client().credits.quote({ operation: 'enrichment', rows: 4, fields });
    expect(quote.basis).toBe('values_up_to');
    expect(quote.credits).toBe(40);
    const over = client().credits.quote({ operation: 'enrichment', rows: 10_000, fields });
    await expect(over).rejects.toThrow(InvalidRequestError);
    await expect(over).rejects.toThrow(/holds at most 30,000/);
  });
});

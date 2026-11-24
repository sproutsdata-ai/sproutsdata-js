/** Enrichment (E1-E7): a job from its start to its rows, a lookup in the call, and refusals. */

import { describe, expect, it } from 'vitest';

import { ClientValidationError, ConflictError, NotFoundError, ResultsExpiredError, WaitTimeoutError } from '../../src/core/errors.js';
import { FIELDS, jobBody, lookupBody } from '../../src/requests/enrichment.js';
import { Enrichment } from '../../src/resources/enrichment.js';
import type { EnrichmentJob, EnrichmentJobRequest, EnrichmentJobResults, EnrichmentLookupRequest } from '../../src/types/index.js';
import { assertValidRequest, recorded, recordedBody, respond } from '../support/answers.js';
import { collect, rig, type Rig } from '../support/rig.js';

const ITEMS = [{ full_name: 'Ada Example', company_domain: 'example-1.de', external_id: 'row-1' }];
const PERSON = { full_name: 'Ada Example', company_domain: 'example-1.de' };
const COMPANY = { company_domain: 'example-1.de' };
const JOB = recordedBody<EnrichmentJob>('enrichment_retrieve', 'completed');
const state = (status: string): Record<string, unknown> => ({ ...JOB, status });
const UNAVAILABLE = { type: 'about:blank', title: 'Unavailable', status: 503, code: 'service.unavailable', detail: 'busy', request_id: 'r' };

/** A clock whose time moves only by what it sleeps. */
function timed(r: Rig): void {
  let now = 0;
  r.clock.now = () => now;
  r.clock.sleep = (ms) => {
    r.clock.sleeps.push(ms);
    now += ms;
    return Promise.resolve();
  };
}

describe('enrichment', () => {
  it('E1: a job sends what was asked, with a key it keeps on a retry', async () => {
    const r = rig([respond('enrichment_create', 503, UNAVAILABLE, { 'retry-after': '1' }), recorded('enrichment_create', 'contacts')]);
    const handle = await new Enrichment(r.transport).create({ items: ITEMS, fields: ['EMAIL'], name: 'Prospects' });
    const keys = r.sent.map((s) => s.headers.get('idempotency-key'));
    expect(handle.job_id).toBeTruthy();
    expect(keys[0]).toMatch(/^sdk-/);
    expect(keys[1]).toBe(keys[0]);
    expect(r.body()).toEqual({ items: ITEMS, fields: ['EMAIL'], name: 'Prospects' });
    assertValidRequest('enrichment_create', r.body());
  });

  it("E1: a caller's key is sent as is, and one reused with another body conflicts", async () => {
    const r = rig([recorded('enrichment_create', 'key_reused')]);
    const error = await new Enrichment(r.transport).create({ items: ITEMS, fields: ['PHONE'] }, { idempotencyKey: 'nightly-1' }).catch((err: unknown) => err);
    expect(r.sent[0]?.headers.get('idempotency-key')).toBe('nightly-1');
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe('enrichment.idempotency_key_reused');
  });

  it('E2: wait polls until the job ends, on the spec rhythm', async () => {
    const r = rig([respond('enrichment_retrieve', 200, state('queued')), respond('enrichment_retrieve', 200, state('cancelling')), respond('enrichment_retrieve', 200, state('completed'))]);
    const job = await new Enrichment(r.transport).wait(JOB.job_id, {}, { requestId: 'poll-1' });
    expect(job.credits_charged).toBe(JOB.credits_charged);
    expect(r.clock.sleeps).toEqual([2000, 3000]);
    expect(r.sent.every((s) => s.headers.get('x-request-id') === 'poll-1')).toBe(true);
  });

  it('E2: a failed job is returned, and a slow one times out with the last state', async () => {
    const failed = rig([respond('enrichment_retrieve', 200, state('failed'))]);
    expect((await new Enrichment(failed.transport).wait(JOB.job_id)).status).toBe('failed');
    const slow = rig([respond('enrichment_retrieve', 200, state('running'))]);
    timed(slow);
    const error = await new Enrichment(slow.transport).wait(JOB.job_id, { maxWaitMs: 120_000 }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WaitTimeoutError);
    expect((error as WaitTimeoutError).message).toContain('still running');
    expect((error as WaitTimeoutError).last).toMatchObject({ status: 'running' });
  });

  it('E2: wait keeps the spec rhythm by default (spec/defaults.json enrichmentWait)', async () => {
    const slow = rig([respond('enrichment_retrieve', 200, state('running'))]);
    timed(slow);
    await expect(new Enrichment(slow.transport).wait(JOB.job_id)).rejects.toBeInstanceOf(WaitTimeoutError);
    expect(slow.clock.sleeps.slice(0, 4)).toEqual([2000, 3000, 4500, 6750]);
    expect(Math.max(...slow.clock.sleeps)).toBe(30_000);
    expect(slow.clock.sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(1_800_000);
  });

  it('E3: rows page by cursor, and an expired page says so', async () => {
    const page = recordedBody<EnrichmentJobResults>('enrichment_results', 'first_page');
    const r = rig([respond('enrichment_results', 200, { ...page, has_more: true, next_cursor: 'c2' }), respond('enrichment_results', 200, { ...page, has_more: false, next_cursor: null }), recorded('enrichment_results', 'expired')]);
    const enrichment = new Enrichment(r.transport);
    const rows = await collect(enrichment.iterResults(JOB.job_id, { limit: 500 }));
    expect(rows).toHaveLength(page.results.length * 2);
    expect(r.query(1)).toEqual({ limit: '500', cursor: 'c2' });
    await expect(enrichment.results(JOB.job_id, { cursor: 'old' })).rejects.toBeInstanceOf(ResultsExpiredError);
  });

  it("E3: the workspace's jobs list by status", async () => {
    const r = rig([recorded('enrichment_list', 'all')]);
    const page = await new Enrichment(r.transport).list({ status: 'completed', limit: 50 });
    expect(r.query()).toEqual({ status: 'completed', limit: '50' });
    expect(page.results.length).toBeGreaterThan(0);
  });

  it('E3: iterList follows the cursor with the same status, and stops at maxResults', async () => {
    const page = recordedBody<{ results: readonly unknown[] }>('enrichment_list', 'all');
    const r = rig([respond('enrichment_list', 200, { ...page, has_more: true, next_cursor: 'c2' }), recorded('enrichment_list', 'all')]);
    const jobs = await collect(new Enrichment(r.transport).iterList({ status: 'completed', maxResults: page.results.length + 1 }));
    expect(jobs).toHaveLength(page.results.length + 1);
    expect(r.query(1)).toMatchObject({ status: 'completed', cursor: 'c2' });
  });

  it('E3: pages are bounded locally', async () => {
    const r = rig([]);
    const enrichment = new Enrichment(r.transport);
    await expect(enrichment.list({ limit: 101 })).rejects.toThrow('limit must be an integer between 1 and 100');
    await expect(enrichment.results(JOB.job_id, { limit: 501 })).rejects.toThrow('limit must be an integer between 1 and 500');
    expect(r.sent).toHaveLength(0);
  });

  it('E4: a job is read or cancelled by id', async () => {
    const r = rig([recorded('enrichment_cancel', 'cancelled'), recorded('enrichment_retrieve', 'not_found')]);
    const enrichment = new Enrichment(r.transport);
    const cancelled = await enrichment.cancel('0'.repeat(32));
    expect(cancelled.status).toBe('cancelled');
    expect(r.sent[0]?.url.pathname.endsWith('/cancel')).toBe(true);
    const error = await enrichment.retrieve('1'.repeat(32)).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).code).toBe('enrichment.job_not_found');
  });

  it('E5: a lookup is answered in the call, and charged once by its key', async () => {
    const r = rig([recorded('enrichment_lookup', 'complete')]);
    const found = await new Enrichment(r.transport).lookup({ items: ITEMS, fields: ['EMAIL', 'PHONE'] });
    expect(found.complete).toBe(true);
    expect(r.sent[0]?.headers.get('idempotency-key')).toMatch(/^sdk-/);
    assertValidRequest('enrichment_lookup', r.body());
  });

  it('E5: a lookup that did not finish became a job', async () => {
    const r = rig([recorded('enrichment_lookup', 'became_job')]);
    const answer = await new Enrichment(r.transport).lookup({ items: ITEMS, fields: ['EMAIL'], wait_seconds: 0.5 });
    expect(answer.complete).toBe(false);
    expect(answer.results[0]?.incomplete).toEqual(['EMAIL']);
    expect((r.body() as { wait_seconds: number }).wait_seconds).toBe(0.5);
  });

  it.each<[Partial<EnrichmentJobRequest>, string | RegExp]>([
    [{ items: [PERSON], fields: ['EMAIL', 'EMAIL'] }, 'fields: fields must not repeat'],
    [{ items: [{ ...PERSON, company_id: 'c1' }], fields: ['EMAIL'] }, "items.0: ['company_id'] do not apply to contacts"],
    [{ entity: 'accounts', items: [{ ...COMPANY, full_name: 'x' }], fields: ['DOMAIN'] }, "items.0: ['full_name'] do not apply to accounts"],
    [{ items: [{ ...PERSON, fields: ['PHONE'] }], fields: ['EMAIL'] }, 'items.0.fields must be a subset of fields'],
    [{ items: [PERSON], fields: ['DOMAIN'] }, 'contacts are enriched for EMAIL, PHONE'],
    [{ entity: 'accounts', items: [COMPANY], fields: ['EMAIL'] }, 'accounts are enriched for DOMAIN, LINKEDIN_URL, PHONE'],
    [{ entity: 'accounts', items: [COMPANY], fields: ['DOMAIN'], verify_mode: 'strict' }, 'verify_mode applies to contacts only'],
    [{ items: [], fields: ['EMAIL'] }, 'items'],
    [{ items: [PERSON], fields: [] }, 'fields'],
    [{ items: [PERSON], fields: ['EMAIL'], name: 'x'.repeat(121) }, 'name'],
  ])('E7: a job the server would refuse is refused locally (%#)', (params, reason) => {
    expect(() => jobBody(params as EnrichmentJobRequest)).toThrow(reason);
    expect(() => jobBody(params as EnrichmentJobRequest)).toThrow(ClientValidationError);
  });

  it.each<[Partial<EnrichmentLookupRequest> & Record<string, unknown>, string]>([
    [{ items: Array.from({ length: 21 }, () => PERSON), fields: ['EMAIL'] }, 'items'],
    [{ items: [PERSON], fields: ['EMAIL'], wait_seconds: 21 }, 'wait_seconds'],
    [{ items: [PERSON], fields: ['EMAIL'], wait_seconds: 0 }, 'wait_seconds: at least 0.1'],
    [{ items: [PERSON], fields: ['EMAIL'], name: 'a lookup has no name' }, 'name'],
  ])('E7: a lookup takes up to 20 items and a wait it can keep (%#)', (params, reason) => {
    expect(() => lookupBody(params as EnrichmentLookupRequest)).toThrow(reason);
  });

  it('E7: a body that holds is sent with its defaults left to the server', () => {
    const job = { items: [PERSON, { ...PERSON, fields: ['PHONE'] as const }], fields: ['EMAIL', 'PHONE'] } as const;
    expect(jobBody(job)).toEqual(job);
    assertValidRequest('enrichment_create', jobBody(job));
    assertValidRequest('enrichment_lookup', lookupBody({ items: [COMPANY], fields: ['DOMAIN'], entity: 'accounts', wait_seconds: 0.1 }));
  });

  it('E7: the fields each entity takes are the generated ones', () => {
    // A Record over each generated union fails to compile when the API adds a member.
    const entities: Readonly<Record<NonNullable<EnrichmentJobRequest['entity']>, true>> = { contacts: true, accounts: true };
    const named: Readonly<Record<EnrichmentJobRequest['fields'][number], true>> = { EMAIL: true, PHONE: true, DOMAIN: true, LINKEDIN_URL: true };
    expect(Object.keys(FIELDS).sort()).toEqual(Object.keys(entities).sort());
    expect(new Set(Object.values(FIELDS).flatMap((set) => [...set]))).toEqual(new Set(Object.keys(named)));
  });
});

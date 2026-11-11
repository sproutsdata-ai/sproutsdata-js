/** Saved lists (L1-L7) and exports (X1-X6). */

import { describe, expect, it } from 'vitest';

import { APIResponseValidationError, ClientValidationError, ConflictError, ExportFailedError, InvalidRequestError, ListNameTakenError, NotFoundError, WaitTimeoutError } from '../../src/core/errors.js';
import { Exports, SearchExport } from '../../src/resources/exports.js';
import { Lists } from '../../src/resources/lists.js';
import type { ExportJobView, ItemRef } from '../../src/types/index.js';
import { assertValidRequest, recorded, recordedBody, respond } from '../support/answers.js';
import { collect, rig } from '../support/rig.js';

const ITEM: ItemRef = { entity_category: 'company', entity_id: 'example-1.de' };
const JOB = recordedBody<ExportJobView>('exports_retrieve', 'done');
const job = (status: string, changes: Record<string, unknown> = {}): Record<string, unknown> => ({ ...JOB, status, ...changes });
const problem = (status: number, code: string): Record<string, unknown> => ({ type: 'about:blank', title: code, status, code, detail: code, request_id: 'r' });

describe('lists', () => {
  it('L1: created_by and added_by are strings', async () => {
    const r = rig([recorded('lists_create', 'companies'), recorded('lists_items', 'first_page')]);
    const lists = new Lists(r.transport);
    const created = await lists.create({ name: 'Prospects', entity_category: 'company' });
    const items = await lists.items('l1');
    expect(typeof created.created_by).toBe('string');
    expect(items.items[0]?.added_by).toMatch(/^user:/);
  });

  it('L2: entity_category on create, not_found on add', async () => {
    const r = rig([recorded('lists_create', 'companies'), recorded('lists_add_items', 'added')]);
    const lists = new Lists(r.transport);
    await lists.create({ name: 'Prospects', entity_category: 'company' });
    const added = await lists.addItems('l1', { items: [ITEM] });
    expect(r.body(0)).toEqual({ name: 'Prospects', entity_category: 'company' });
    expect(added.not_found).toBeGreaterThanOrEqual(0);
    assertValidRequest('lists_create', r.body(0));
    assertValidRequest('lists_add_items', r.body(1));
  });

  it('L3: a taken name is a conflict, and create is never retried', async () => {
    const r = rig([recorded('lists_create', 'name_taken')]);
    const error = await new Lists(r.transport).create({ name: 'e2e PROSPECTS' }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ListNameTakenError);
    expect(error).toBeInstanceOf(ConflictError);
    const timedOut = rig([{ network: 'reset_after_send' }, recorded('lists_create', 'companies')]);
    await expect(new Lists(timedOut.transport).create({ name: 'Prospects' })).rejects.toThrow();
    expect([r.sent.length, timedOut.sent.length]).toEqual([1, 1]);
  });

  it('L4: a category mismatch is an invalid request', async () => {
    const r = rig([respond('lists_add_items', 422, problem(422, 'lists.category_mismatch'))]);
    const error = await new Lists(r.transport).addItems('l1', { items: [{ entity_category: 'person', entity_id: 'x' }] }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(InvalidRequestError);
  });

  it('L5: the item cap carries no extra', async () => {
    const r = rig([respond('lists_add_items', 409, problem(409, 'lists.item_cap_reached'))]);
    const error = await new Lists(r.transport).addItems('l1', { items: [ITEM] }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).extra).toEqual({});
  });

  it('L6: a thousand items per request, and names are not blank', async () => {
    const r = rig([recorded('lists_add_items', 'added')]);
    const lists = new Lists(r.transport);
    await lists.addItems('l1', { items: Array.from({ length: 1000 }, () => ITEM) });
    await expect(lists.addItems('l1', { items: Array.from({ length: 1001 }, () => ITEM) })).rejects.toThrow('items: must be at most 1000 entries');
    await expect(lists.create({ name: '   ' })).rejects.toThrow('a list needs a name');
    await expect(lists.removeItems('l1', { items: 'example-1.de' as unknown as ItemRef[] })).rejects.toBeInstanceOf(ClientValidationError);
    expect(r.sent).toHaveLength(1);
  });

  it('L7: items page by cursor, and items are named', async () => {
    const first = { ...recordedBody<{ items: unknown[] }>('lists_items', 'first_page'), next_cursor: 'c1' };
    const r = rig([respond('lists_items', 200, first), respond('lists_items', 200, { ...first, next_cursor: null }), recorded('lists_remove_items', 'removed'), recorded('lists_rename', 'renamed'), recorded('lists_list', 'all'), recorded('lists_delete', 'deleted')]);
    const lists = new Lists(r.transport);
    const rows = await collect(lists.iterItems('l1', { limit: 25 }));
    await lists.removeItems('l1', { items: [ITEM] });
    const renamed = await lists.rename('l1', { name: 'Renamed' });
    const all = await lists.list();
    await lists.delete('l1');
    expect(rows).toHaveLength(2 * first.items.length);
    expect(r.query(1)).toEqual({ limit: '25', cursor: 'c1' });
    expect(renamed.name).toBeTruthy();
    expect(all.lists).toBeDefined();
    expect(r.sent.slice(2).map((s) => s.method)).toEqual(['DELETE', 'PATCH', 'GET', 'DELETE']);
  });
});

describe('exports', () => {
  it('X1: an export is a file or a job, by its status', async () => {
    const r = rig([recorded('lists_export', 'file'), recorded('lists_export', 'job')]);
    const lists = new Lists(r.transport);
    const small = await lists.export('l1', { limit: 5 });
    const large = await lists.export('l1');
    expect(small.kind).toBe('file');
    expect(small.kind === 'file' && small.csv.startsWith('entity_category,entity_id')).toBe(true);
    expect(large.kind === 'job' && large.job.status).toBe('queued');
  });

  it('X1: an answer that is neither is thrown', async () => {
    const r = rig([{ status: 204 }, { status: 200, body: { not: 'csv' } }]);
    await expect(new Lists(r.transport).export('l1')).rejects.toBeInstanceOf(APIResponseValidationError);
    await expect(new Exports(r.transport).download('j1')).rejects.toBeInstanceOf(APIResponseValidationError);
  });

  it('X2: list export takes offset and limit', async () => {
    const r = rig([recorded('lists_export', 'file')]);
    await new Lists(r.transport).export('l1', { offset: 10, limit: 5 });
    expect(r.body()).toEqual({ offset: 10, limit: 5 });
    assertValidRequest('lists_export', r.body());
  });

  it("X3: search export takes items and the search's request id", async () => {
    const r = rig([recorded('search_export', 'file')]);
    const result = await new SearchExport(r.transport).searchExport({ items: [ITEM], request_id: '7a7acf79' });
    expect(result.kind).toBe('file');
    expect(r.body()).toEqual({ items: [ITEM], request_id: '7a7acf79' });
    assertValidRequest('search_export', r.body());
    await expect(new SearchExport(r.transport).searchExport({ items: 'x' as unknown as ItemRef[] })).rejects.toThrow('items must be a list');
  });

  it('X4: wait polls to done, and download reads the file', async () => {
    const csv = '\uFEFFentity_category,entity_id\r\ncompany,example-1.de\r\n';
    const r = rig([respond('exports_retrieve', 200, job('queued')), respond('exports_retrieve', 200, job('running')), respond('exports_retrieve', 200, job('done')), { status: 200, raw_body: csv, content_type: 'text/csv; charset=utf-8' }]);
    const exports = new Exports(r.transport);
    const done = await exports.wait('j1', { pollIntervalMs: 500 });
    const text = await exports.download('j1');
    expect(done.status).toBe('done');
    expect(r.clock.sleeps).toEqual([500, 750]);
    expect(text).toBe('entity_category,entity_id\r\ncompany,example-1.de\r\n');
  });

  it('X4: wait keeps the spec rhythm by default (spec/defaults.json exportWait)', async () => {
    const slow = rig([respond('exports_retrieve', 200, job('running'))]);
    let now = 0;
    slow.clock.now = () => now;
    slow.clock.sleep = (ms) => {
      slow.clock.sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    };
    await expect(new Exports(slow.transport).wait('j1')).rejects.toBeInstanceOf(WaitTimeoutError);
    expect(slow.clock.sleeps.slice(0, 5)).toEqual([2000, 3000, 4500, 6750, 10_000]);
    expect(Math.max(...slow.clock.sleeps)).toBe(10_000);
    expect(now).toBeGreaterThan(890_000);
    expect(now).toBeLessThanOrEqual(900_000);
  });

  it('X4: a failed job throws with its error, and a slow one times out', async () => {
    const failed = rig([respond('exports_retrieve', 200, job('failed', { error: 'the list was deleted' }))]);
    const error = await new Exports(failed.transport).wait('j1').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ExportFailedError);
    expect((error as ExportFailedError).message).toContain('the list was deleted');
    const slow = rig([respond('exports_retrieve', 200, job('running'))]);
    let now = 0;
    slow.clock.now = () => now;
    slow.clock.sleep = (ms) => {
      now += ms;
      return Promise.resolve();
    };
    const timeout = await new Exports(slow.transport).wait('j1', { pollIntervalMs: 10_000, maxWaitMs: 30_000 }).catch((err: unknown) => err);
    expect(timeout).toBeInstanceOf(WaitTimeoutError);
    expect((timeout as WaitTimeoutError).last).toMatchObject({ status: 'running' });
  });

  it('X5: exports read no charge', async () => {
    const r = rig([recorded('lists_export', 'file')]);
    const result = await new Lists(r.transport).export('l1');
    expect(result).not.toHaveProperty('credits_charged');
  });

  it('X6: a missing job and a too large export throw their classes', async () => {
    const missing = rig([respond('exports_retrieve', 404, problem(404, 'export.not_found'))]);
    await expect(new Exports(missing.transport).retrieve('j1')).rejects.toBeInstanceOf(NotFoundError);
    const large = rig([respond('search_export', 422, problem(422, 'export.too_large'))]);
    await expect(new SearchExport(large.transport).searchExport({ items: [ITEM] })).rejects.toBeInstanceOf(InvalidRequestError);
  });
});

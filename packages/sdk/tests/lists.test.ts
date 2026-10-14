import { describe, expect, it } from 'vitest';

import {
  APIConnectionError,
  ClientValidationError,
  ConflictError,
  IdempotencyConflictError,
  InternalServerError,
  NotFoundError,
  SproutsData,
} from '../src/index';
import type { ItemRef, SavedItem, SavedList } from '../src/index';
import { TEST_KEY, fetchQueue, jsonResponse, networkError, problemResponse } from './helpers';

const BASE = 'https://dsp.example.test/backend';
const LIST_ID = '5f0c9a52-1d1e-4f61-9a43-1b3c8a1d7e10';

function makeClient(fetchImpl: typeof globalThis.fetch, maxRetries = 0) {
  return new SproutsData({ apiKey: TEST_KEY, baseUrl: BASE, fetch: fetchImpl, maxRetries });
}

function savedList(overrides: Partial<SavedList> = {}): SavedList {
  return {
    id: LIST_ID,
    name: 'Fintech targets',
    created_by: null,
    created_at: '2026-10-14T00:00:00Z',
    updated_at: '2026-10-14T00:00:00Z',
    item_count: 2,
    ...overrides,
  };
}

function item(entityId = 'stripe.com', overrides: Partial<SavedItem> = {}): SavedItem {
  return {
    entity_category: 'company',
    entity_id: entityId,
    added_at: '2026-10-14T00:00:00Z',
    added_by: null,
    available: true,
    unavailable_reason: null,
    record: { domain: entityId, name: 'Stripe' },
    ...overrides,
  };
}

function itemsPage(items: SavedItem[], nextCursor: string | null = null) {
  return { saved_list: savedList(), items, next_cursor: nextCursor, field_tier: 'free' };
}

const STRIPE: ItemRef = { entity_category: 'company', entity_id: 'stripe.com' };

const CSV = 'entity_category,entity_id,name\r\ncompany,stripe.com,Stripe\r\n';
function csvResponse(headers: Record<string, string> = {}): Response {
  return new Response(CSV, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="fintech-targets.csv"',
      'x-export-field-tier': 'free',
      'x-export-row-count': '1',
      'x-export-skipped': '0',
      'x-credits-charged': '0.0',
      'x-request-id': 'req_export',
      ...headers,
    },
  });
}

describe('lists — read and manage', () => {
  it('lists every list with the saved-items cap', async () => {
    const fetchMock = fetchQueue(
      jsonResponse({ lists: [savedList()], saved_items: 2, saved_items_cap: 100, field_tier: 'free' }),
    );
    const lists = await makeClient(fetchMock).lists.list();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}/v1/lists`);
    expect(init!.method).toBe('GET');
    expect(lists.lists[0]!.name).toBe('Fintech targets');
    expect(lists.saved_items_cap).toBe(100);
  });

  it('creates with the name and nothing else', async () => {
    const fetchMock = fetchQueue(jsonResponse(savedList({ item_count: 0 }), 201));
    const created = await makeClient(fetchMock).lists.create('Fintech targets');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ name: 'Fintech targets' });
    expect(created.id).toBe(LIST_ID);
  });

  it('refuses a blank name before sending', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(client.lists.create('  ')).rejects.toThrow(ClientValidationError);
    await expect(client.lists.rename(LIST_ID, '')).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renames with PATCH', async () => {
    const fetchMock = fetchQueue(jsonResponse(savedList({ name: 'Renamed' })));
    const renamed = await makeClient(fetchMock).lists.rename(LIST_ID, 'Renamed');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}/v1/lists/${LIST_ID}`);
    expect(init!.method).toBe('PATCH');
    expect(JSON.parse(init!.body as string)).toEqual({ name: 'Renamed' });
    expect(renamed.name).toBe('Renamed');
  });

  it('deletes and resolves to undefined on a 204', async () => {
    const fetchMock = fetchQueue(new Response(null, { status: 204 }));
    await expect(makeClient(fetchMock).lists.delete(LIST_ID)).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init!.method).toBe('DELETE');
    expect(init!.body).toBeUndefined();
  });

  it('encodes the list id into one path segment', async () => {
    const fetchMock = fetchQueue(jsonResponse(savedList()));
    await makeClient(fetchMock).lists.rename('a/b?c', 'x');
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${BASE}/v1/lists/a%2Fb%3Fc`);
  });

  it('reports a missing list as lists.not_found', async () => {
    const fetchMock = fetchQueue(problemResponse(404, { code: 'lists.not_found', title: 'Not found' }));
    const err = await makeClient(fetchMock).lists.rename(LIST_ID, 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).code).toBe('lists.not_found');
  });

  it('does not repeat a create after a server error', async () => {
    const fetchMock = fetchQueue(
      problemResponse(500, { code: 'internal' }),
      jsonResponse(savedList(), 201),
    );
    await expect(makeClient(fetchMock, 2).lists.create('x')).rejects.toBeInstanceOf(InternalServerError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a delete that may have landed', async () => {
    const fetchMock = fetchQueue(networkError('ECONNRESET'), new Response(null, { status: 204 }));
    const err = await makeClient(fetchMock, 2).lists.delete(LIST_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIConnectionError);
    expect((err as APIConnectionError).reachedServer).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('lists — items', () => {
  it('reads one page with the cursor and limit in the query', async () => {
    const fetchMock = fetchQueue(jsonResponse(itemsPage([item()], 'aTo0Mg')));
    const page = await makeClient(fetchMock).lists.items(LIST_ID, { limit: 1, cursor: 'aTo5OQ' });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe(`/backend/v1/lists/${LIST_ID}/items`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '1', cursor: 'aTo5OQ' });
    expect(page.next_cursor).toBe('aTo0Mg');
    expect(page.items[0]!.entity_id).toBe('stripe.com');
  });

  it('keeps an unreadable item and says why', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(itemsPage([item('gone.com', { available: false, unavailable_reason: 'not_found', record: null })])),
    );
    const page = await makeClient(fetchMock).lists.items(LIST_ID);
    expect(page.items[0]!.available).toBe(false);
    expect(page.items[0]!.unavailable_reason).toBe('not_found');
  });

  it('iterItems follows the cursor and sends the request id on page one only', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(itemsPage([item('a.com')], 'c1')),
      jsonResponse(itemsPage([item('b.com')])),
    );
    const seen: string[] = [];
    for await (const row of makeClient(fetchMock).lists.iterItems(LIST_ID, { limit: 1 }, { requestId: 'mine-1' })) {
      seen.push(row.entity_id);
    }
    expect(seen).toEqual(['a.com', 'b.com']);
    const first = new URL(String(fetchMock.mock.calls[0]![0]));
    const second = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(first.searchParams.has('cursor')).toBe(false);
    expect(second.searchParams.get('cursor')).toBe('c1');
    expect(second.searchParams.get('limit')).toBe('1');
    const headersOf = (i: number) => fetchMock.mock.calls[i]![1]!.headers as Record<string, string>;
    expect(headersOf(0)['X-Request-Id']).toBe('mine-1');
    expect(headersOf(1)['X-Request-Id']).toBeUndefined();
  });

  it('adds items as the wire shape and reports the counts', async () => {
    const fetchMock = fetchQueue(
      jsonResponse({ saved_list: savedList(), added: 1, already_present: 1, suppressed: 0 }),
    );
    const person: ItemRef = { entity_category: 'person', entity_id: 'https://linkedin.com/in/ada' };
    const added = await makeClient(fetchMock).lists.addItems(LIST_ID, [STRIPE, person]);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ items: [STRIPE, person] });
    expect((init!.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined();
    expect([added.added, added.already_present, added.suppressed]).toEqual([1, 1, 0]);
  });

  it('removes items with a DELETE that carries a body', async () => {
    const fetchMock = fetchQueue(jsonResponse({ saved_list: savedList(), removed: 1 }));
    const removed = await makeClient(fetchMock).lists.removeItems(LIST_ID, [STRIPE]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}/v1/lists/${LIST_ID}/items`);
    expect(init!.method).toBe('DELETE');
    expect(JSON.parse(init!.body as string)).toEqual({ items: [STRIPE] });
    expect((init!.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(removed.removed).toBe(1);
  });

  it('sends only the two keys, so items read back can be passed as they are', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(itemsPage([item('a.com')])),
      jsonResponse({ saved_list: savedList(), removed: 1 }),
    );
    const client = makeClient(fetchMock);
    const page = await client.lists.items(LIST_ID);
    await client.lists.removeItems(LIST_ID, page.items as unknown as ItemRef[]);
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      items: [{ entity_category: 'company', entity_id: 'a.com' }],
    });
  });

  it.each([
    ['an empty list', []],
    ['not an array', STRIPE],
    ['a search hit', [{ id: 'hash', category: 'person' }]],
    ['a blank id', [{ entity_category: 'company', entity_id: ' ' }]],
  ])('refuses %s before sending', async (_label, items) => {
    const fetchMock = fetchQueue();
    await expect(
      makeClient(fetchMock).lists.addItems(LIST_ID, items as unknown as ItemRef[]),
    ).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the saved-items cap as a conflict with its numbers', async () => {
    const fetchMock = fetchQueue(
      problemResponse(409, {
        code: 'lists.item_cap_reached',
        title: 'Saved-items cap reached',
        extra: { cap: 100, saved: 99, adding: 2 },
      }),
    );
    const err = await makeClient(fetchMock, 2).lists.addItems(LIST_ID, [STRIPE]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).not.toBeInstanceOf(IdempotencyConflictError);
    expect((err as ConflictError).problem?.extra).toEqual({ cap: 100, saved: 99, adding: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries an add after a server error, since adding is idempotent', async () => {
    const fetchMock = fetchQueue(
      problemResponse(500, { code: 'internal' }),
      jsonResponse({ saved_list: savedList(), added: 0, already_present: 1, suppressed: 0 }),
    );
    const added = await makeClient(fetchMock, 2).lists.addItems(LIST_ID, [STRIPE]);
    expect(added.already_present).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('CSV export', () => {
  it('exports a list as bytes with what the headers say', async () => {
    const fetchMock = fetchQueue(csvResponse());
    const exported = await makeClient(fetchMock).lists.export(LIST_ID);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}/v1/lists/${LIST_ID}/export`);
    expect(init!.method).toBe('POST');
    expect(init!.body).toBeUndefined();
    expect((init!.headers as Record<string, string>).Accept).toBe('text/csv, application/problem+json');
    expect(exported.content).toBeInstanceOf(Uint8Array);
    expect(exported.text()).toBe(CSV);
    expect(exported.filename).toBe('fintech-targets.csv');
    expect(exported.field_tier).toBe('free');
    expect([exported.row_count, exported.skipped, exported.credits_charged]).toEqual([1, 0, 0]);
    expect(exported.request_id).toBe('req_export');
  });

  it('is billed: it carries a key and a lost answer is not repeated', async () => {
    const fetchMock = fetchQueue(networkError('ECONNRESET'), csvResponse());
    const err = await makeClient(fetchMock, 2).lists.export(LIST_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(/^sdk-[0-9a-f]{32}$/);
  });

  it('leaves a missing header empty rather than guessing', async () => {
    const fetchMock = fetchQueue(new Response('', { status: 200, headers: { 'content-type': 'text/csv' } }));
    const exported = await makeClient(fetchMock).lists.export(LIST_ID);
    expect(exported.content).toHaveLength(0);
    expect([exported.filename, exported.row_count, exported.credits_charged]).toEqual([null, null, null]);
  });

  it('treats export.not_enabled as not found and does not retry it', async () => {
    const fetchMock = fetchQueue(problemResponse(404, { code: 'export.not_enabled', title: 'Not found' }));
    const err = await makeClient(fetchMock, 2).lists.export(LIST_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).code).toBe('export.not_enabled');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exports chosen search results with the source search', async () => {
    const fetchMock = fetchQueue(csvResponse());
    const exported = await makeClient(fetchMock).searchExport(
      { items: [STRIPE], request_id: 'req_search' },
      { requestId: 'mine-1' },
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${BASE}/v1/search/export`);
    expect(JSON.parse(init!.body as string)).toEqual({ items: [STRIPE], request_id: 'req_search' });
    expect((init!.headers as Record<string, string>)['X-Request-Id']).toBe('mine-1');
    expect(exported.row_count).toBe(1);
  });

  it('omits the source search when none is given', async () => {
    const fetchMock = fetchQueue(csvResponse());
    await makeClient(fetchMock).searchExport({ items: [STRIPE] });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ items: [STRIPE] });
  });
});

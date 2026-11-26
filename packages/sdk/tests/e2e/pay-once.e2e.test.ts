/**
 * Live: whole records are paid for once, and saved lists need their own scopes.
 *
 * The seed's paid workspace bought credits through the real purchase flow, so it sees whole records
 * and pays the lookup price the first time it sees each one; the free workspace sees the search-row
 * fields and pays nothing. The Python suite runs first against the same workspaces, so these tests
 * take records it never touches (`example-60.de` on).
 */

import { describe, expect, it } from 'vitest';

import { GatewayError, PermissionDeniedError } from '../../src/core/errors.js';
import type { ItemRef } from '../../src/types/index.js';
import { arm, client, setting, STACK } from './stack.js';

const companies = (from: number, count: number): ItemRef[] =>
  Array.from({ length: count }, (_, i) => ({ entity_category: 'company', entity_id: `example-${String(from + i)}.de` }));

async function newList(key: string): Promise<string> {
  const created = await client({ key }).lists.create({ name: `e2e pay once js ${crypto.randomUUID().slice(0, 8)}`, entity_category: 'company' });
  return created.id;
}

describe.skipIf(STACK === undefined)('whole records are paid for once, live', () => {
  it('a paid workspace pays once for each record it sees whole', async () => {
    const key = setting('SPROUTSDATA_E2E_PAID_KEY');
    const sdk = client({ key });
    const records = companies(60, 3);
    const price = (await sdk.credits.quote({ operation: 'lookup', rows: 1 })).credits;
    const listId = await newList(key);
    const added = await sdk.lists.addItems(listId, { items: records });
    const again = await sdk.lists.addItems(listId, { items: records.slice(0, 1) });
    const page = await sdk.lists.items(listId);
    const exported = await sdk.lists.export(listId, { limit: 3 });
    expect([added.added, added.credits_charged]).toEqual([3, 3 * price]);
    expect([again.already_present, again.credits_charged]).toEqual([1, 0]);
    expect([page.field_tier, page.credits_charged]).toEqual(['unlocked', 0]);
    // Unlocked when they were added: the export shows them whole, and charges nothing.
    expect(exported).toMatchObject({ kind: 'file', creditsCharged: 0, fieldTier: 'unlocked', rows: 3 });
    await sdk.lists.delete(listId);
  });

  it('a free workspace sees the search-row fields and pays nothing', async () => {
    const key = setting('SPROUTSDATA_E2E_KEY');
    const sdk = client({ key });
    const listId = await newList(key);
    const added = await sdk.lists.addItems(listId, { items: companies(63, 2) });
    const page = await sdk.lists.items(listId);
    const exported = await sdk.lists.export(listId);
    expect(added.credits_charged).toBe(0);
    expect([page.field_tier, page.credits_charged]).toEqual(['free', 0]);
    expect(exported).toMatchObject({ kind: 'file', creditsCharged: 0, fieldTier: 'free' });
    await sdk.lists.delete(listId);
  });

  it('an add whose answer is lost is not repeated, and was charged once', async () => {
    const key = setting('SPROUTSDATA_E2E_PAID_KEY');
    const sdk = client({ key });
    const records = companies(65, 2);
    const price = (await sdk.credits.quote({ operation: 'lookup', rows: 1 })).credits;
    const listId = await newList(key);
    await arm(`/v1/lists/${listId}/items`, 504, 1, { forward: true });
    const behindTheGateway = client({ key, baseUrl: setting('SPROUTSDATA_E2E_FAULT_URL') });
    const error = await behindTheGateway.lists.addItems(listId, { items: records }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).message).toContain('may have been charged');
    // The add ran behind the gateway: the records are in the list, charged once (the ledger's
    // newest charge; the balance itself is cached briefly), and adding them again is free.
    const page = await sdk.lists.items(listId);
    const ledger = await sdk.credits.transactions({ limit: 1 });
    const again = await sdk.lists.addItems(listId, { items: records });
    expect(new Set(page.items.map((item) => item.entity_id))).toEqual(new Set(records.map((r) => r.entity_id)));
    expect([ledger.results[0]?.kind, ledger.results[0]?.credits]).toEqual(['charge', -2 * price]);
    expect([again.already_present, again.credits_charged]).toEqual([2, 0]);
    await sdk.lists.delete(listId);
  });

  it('a key without the list scopes is refused by the server', async () => {
    const sdk = client({ key: setting('SPROUTSDATA_E2E_SEARCH_ONLY_KEY') });
    const error = await sdk.lists.list().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PermissionDeniedError);
    expect((error as PermissionDeniedError).code).toBe('auth.insufficient_scope');
    expect((await sdk.search({ query: 'robotics', mode: 'fast', limit: 1 })).results.length).toBeGreaterThan(0);
  });
});

/** Phase 6 live: relationships, the org chart, lists and exports on the real stack. */

import { describe, expect, it } from 'vitest';

import { ClientValidationError, ListNameTakenError, OrgChartCompanyAmbiguousError } from '../../src/core/errors.js';
import type { ItemRef, OrgChartRequest } from '../../src/types/index.js';
import { collect } from '../support/rig.js';
import { client, raw, STACK } from './stack.js';

const PERSON = { li_url: 'https://www.linkedin.com/in/e2e-person' };
const STRIPE = { value: 'stripe.com', by: 'domain' } as const;
const COMPANIES: ItemRef[] = Array.from({ length: 50 }, (_, i) => ({ entity_category: 'company', entity_id: `example-${String(i)}.de` }));

/** The data rows of a CSV file: quoted fields may hold line breaks, so a line is not a row. */
function rows(csv: string): number {
  let count = 0;
  let quoted = false;
  for (const c of csv) {
    if (c === '"') quoted = !quoted;
    else if (c === '\n' && !quoted) count += 1;
  }
  return count - 1;
}

describe.skipIf(STACK === undefined)('phase 6, live', () => {
  it('relationships: find, institutions, ask, and reach across two pages', async () => {
    const sdk = client();
    const adyen = { value: 'adyen.com', by: 'domain' } as const;
    const found = await sdk.relationships.find({ companies: [STRIPE, adyen], limit: 2 });
    const shared = await sdk.relationships.institutions({ companies: [STRIPE, adyen] });
    const asked = await sdk.relationships.ask({ query: 'who at Stripe used to work at Adyen' });
    const reached = await collect(sdk.relationships.iterReach({ person: PERSON, target_company: STRIPE, limit: 2, maxResults: 3 }));
    expect(found.results.length).toBeGreaterThan(0);
    expect(shared.meta.request_id).toBeTruthy();
    expect(asked.meta.credits_charged).not.toBeNull();
    expect(reached).toHaveLength(3);
  });

  it('the org chart, its parts, and the ambiguous company', async () => {
    const sdk = client();
    const grid = await sdk.orgChart.retrieve({ domain: 'example-1.de', metrics: ['new_joiners'] });
    const departments = await sdk.orgChart.departments({ domain: 'example-1.de' });
    const places = await sdk.orgChart.locations({ domain: 'example-1.de' });
    const taxonomy = await sdk.orgChart.taxonomy();
    const error = await sdk.orgChart.retrieve({ domain: 'twin.example' }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(OrgChartCompanyAmbiguousError);
    const ref = (error as OrgChartCompanyAmbiguousError).candidates[0]?.company_ref ?? '';
    const chosen = await sdk.orgChart.retrieve({ company_ref: ref });
    expect([grid.total, chosen.total].every((n) => n >= 0)).toBe(true);
    expect(departments.department_totals.length).toBeGreaterThan(0);
    expect(places.countries.length).toBeGreaterThan(0);
    expect(taxonomy.departments.length).toBeGreaterThan(0);
  });

  it("a cell's people are listed page by page by the chart's company_ref", async () => {
    const sdk = client();
    const grid = await sdk.orgChart.retrieve({ domain: 'example-1.de' });
    const ref = grid.company.company_ref;
    const cell = { department: 'engineering', seniority: 'senior' };
    const counted = grid.cells.find((c) => c.department.code === 'engineering')?.count;
    const people = await collect(sdk.orgChart.iterPeople({ company_ref: ref, cell, limit: 2 }));
    const first = await sdk.orgChart.people({ company_ref: ref, cell, limit: 2 });
    const moved = { company_ref: ref, cell: { department: 'sales' }, cursor: first.next_cursor };
    expect(ref).toBeTruthy();
    expect(people).toHaveLength(first.total);
    expect(first.total).toBe(counted);
    expect(people.every((p) => p.placement.seniority.code === 'senior')).toBe(true);
    expect((await raw('POST', '/v1/org-chart/people', moved)).status).toBe(422);
  });

  it('a retired org chart field is refused locally and by the server', async () => {
    await expect(client().orgChart.retrieve({ domain: 'example-1.de', country: 'germany' } as OrgChartRequest)).rejects.toBeInstanceOf(ClientValidationError);
    expect((await raw('POST', '/v1/org-chart', { domain: 'example-1.de', country: 'germany' })).status).toBe(422);
  });

  it('a list from creation to its exports and deletion', async () => {
    const sdk = client();
    const name = `e2e phase 6 js ${crypto.randomUUID().slice(0, 8)}`;
    const created = await sdk.lists.create({ name, entity_category: 'company' });
    await expect(sdk.lists.create({ name })).rejects.toBeInstanceOf(ListNameTakenError);
    const added = await sdk.lists.addItems(created.id, { items: COMPANIES });
    const items = await collect(sdk.lists.iterItems(created.id, { limit: 20 }));
    const renamed = await sdk.lists.rename(created.id, { name: `${name} renamed` });
    const small = await sdk.lists.export(created.id, { limit: 5 });
    const whole = await sdk.lists.export(created.id);
    expect(added.added).toBe(50);
    expect(items).toHaveLength(50);
    expect(renamed.name.endsWith('renamed')).toBe(true);
    expect(small.kind === 'file' && rows(small.csv)).toBe(5);
    if (whole.kind !== 'job') throw new Error('a 50-row list exports as a job on the stack');
    const done = await sdk.exports.wait(whole.job.job_id, { pollIntervalMs: 200, maxWaitMs: 30_000 });
    const csv = await sdk.exports.download(done.job_id);
    expect(rows(csv)).toBe(done.rows);
    expect((done.rows ?? 0) + (done.skipped ?? 0)).toBe(50);
    expect((await sdk.lists.removeItems(created.id, { items: COMPANIES.slice(0, 1) })).removed).toBe(1);
    await sdk.lists.delete(created.id);
  });

  it('search export answers by its size', async () => {
    const sdk = client();
    const page = await sdk.search({ query: 'robotics', limit: 1 });
    const small = await sdk.searchExport({ items: COMPANIES.slice(0, 1), request_id: page.meta.request_id });
    const large = await sdk.searchExport({ items: COMPANIES });
    expect([small.kind, large.kind]).toEqual(['file', 'job']);
  });
});

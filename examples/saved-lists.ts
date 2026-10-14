/**
 * Keep the companies a search found in a saved list, then read them back.
 *
 * A list belongs to the workspace, so every key and dashboard user of it sees
 * the same lists. Records are saved by their natural id — a company's domain
 * here — never by a search hit's `id`. Every call below is free; only the
 * search is billed.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_test_<your-key>
 *   npx tsx examples/saved-lists.ts "payments companies in Germany"
 */

import { ConflictError, NotFoundError, SproutsData, lookupRef, type ItemRef } from 'sproutsdata';

const query = process.argv.slice(2).join(' ') || 'payments companies in Germany';
const client = new SproutsData();

const page = await client.search({ query, limit: 10 });

// `lookupRef` gives a hit's natural id: { by: 'domain', value: 'stripe.com' }.
const items: ItemRef[] = [];
for (const hit of page.results) {
  const ref = lookupRef(hit);
  if (ref?.by === 'domain') items.push({ entity_category: 'company', entity_id: ref.value });
}
if (items.length === 0) throw new Error('the search found no company with a domain to save');

const saved = await client.lists.create(`From: ${query}`.slice(0, 120));
try {
  const added = await client.lists.addItems(saved.id, items);
  console.log(
    `saved ${added.added}, already there ${added.already_present}, refused (do-not-contact) ${added.suppressed}`,
  );

  for await (const item of client.lists.iterItems(saved.id, { limit: 25 })) {
    const name = item.available ? item.record?.['name'] : item.unavailable_reason;
    console.log(`  ${item.entity_id.padEnd(30)} ${String(name ?? '')}`);
  }

  try {
    const csv = await client.lists.export(saved.id);
    console.log(`exported ${csv.row_count} rows as ${csv.filename}`);
  } catch (err) {
    // `export.not_enabled` until CSV export is switched on.
    if (err instanceof NotFoundError) console.log(`no export here: ${err.code}`);
    else throw err;
  }
} catch (err) {
  // A free workspace's saved-items cap: nothing was added.
  if (err instanceof ConflictError) console.log('over the cap:', err.problem?.extra);
  else throw err;
} finally {
  await client.lists.delete(saved.id);
}

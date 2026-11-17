/**
 * Save records to a list, read them back, export them, and tidy up.
 *
 * A list belongs to the workspace, and its name is unique there. Records are saved by their own
 * id (a company's domain), never by a search row's `id`. An export comes back as a file when it
 * is small, or as a job to wait for when it is not. Every call here is free.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_live_<your-key>
 *   node examples/saved-lists.ts
 */

import { randomUUID } from 'node:crypto';

import { type ItemRef, ListNameTakenError, SproutsData } from 'sproutsdata';

const client = new SproutsData();
const name = `Example targets ${randomUUID().slice(0, 6)}`;

try {
  const saved = await client.lists.create({ name, entity_category: 'company' });
  try {
    const items: ItemRef[] = [0, 1, 2, 3, 4].map((i) => ({ entity_category: 'company', entity_id: `example-${String(i)}.de` }));
    const added = await client.lists.addItems(saved.id, { items });
    console.log(`added ${String(added.added)}, already there ${String(added.already_present)}, not found ${String(added.not_found)}`);

    for await (const item of client.lists.iterItems(saved.id, { maxResults: 5 })) {
      console.log(`  ${item.entity_id} available=${String(item.available)}`);
    }

    const result = await client.lists.export(saved.id);
    if (result.kind === 'file') {
      console.log(`exported at once: ${String(result.csv.trim().split('\n').length - 1)} rows`);
    } else {
      const job = await client.exports.wait(result.job.job_id);
      console.log(`export job ${job.status}: ${String(job.rows)} rows`);
      console.log((await client.exports.download(job.job_id)).slice(0, 80));
    }
  } finally {
    await client.lists.delete(saved.id);
  }
} catch (error) {
  if (!(error instanceof ListNameTakenError)) throw error;
  console.log(`a list named "${name}" already exists`);
}

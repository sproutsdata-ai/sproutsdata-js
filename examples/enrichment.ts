/**
 * Enrichment: emails for a few people in the call, then a job for a list of them.
 *
 * A lookup takes up to 20 people and answers in the call; anything larger is a job, started at
 * once and read until it ends. The most either can cost is held first, and only values newly
 * found are charged: a value Sprouts already holds, a miss and a person on the Do-Not-Contact
 * list cost nothing. Enrichment needs a key with the `dsp.enrichment.*` scopes, which a key
 * does not have by default.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_live_<your-key>
 *   node examples/enrichment.ts
 */

import { PermissionDeniedError, SproutsData, WaitTimeoutError } from 'sproutsdata';

const client = new SproutsData();

const people = [
  { full_name: 'Ada Example', company_domain: 'example-1.de', external_id: 'crm-1' },
  { linkedin_url: 'https://www.linkedin.com/in/e2e-cached', external_id: 'CACHED-crm-2' },
];

try {
  const quote = await client.credits.quote({ operation: 'enrichment', rows: people.length });
  console.log(`holds up to ${String(quote.credits)} credits (${quote.basis})`);

  const found = await client.enrichment.lookup({ items: people, fields: ['EMAIL'] });
  for (const row of found.results) console.log(`  ${String(row.input['external_id'])}: ${JSON.stringify(row.fields['EMAIL']?.value ?? null)}`);
  console.log(`lookup charged ${String(found.meta.credits_charged)} credits`);

  const handle = await client.enrichment.create({ items: people, fields: ['EMAIL'], name: 'Prospects' });
  const job = await client.enrichment.wait(handle.job_id, { maxWaitMs: 300_000 });
  console.log(`job ${job.job_id}: ${job.status}, ${String(job.credits_charged)} credits`);
  for await (const row of client.enrichment.iterResults(job.job_id)) console.log(`  ${String(row.idx)}: ${row.outcome}`);
} catch (error) {
  if (error instanceof PermissionDeniedError) console.log('this key cannot enrich: create one with the dsp.enrichment scopes');
  else if (error instanceof WaitTimeoutError) console.log(`still running after 5 minutes: ${JSON.stringify(error.last)}`);
  else throw error;
}

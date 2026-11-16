/**
 * Search, then fetch the full record behind the first result: the smallest useful program.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_live_<your-key>
 *   node examples/quickstart.ts
 */

import { entityHit, InsufficientCreditsError, lookupRef, recordsOf, SproutsData } from 'sproutsdata';

const client = new SproutsData(); // reads SPROUTSDATA_API_KEY

try {
  const page = await client.search({ query: 'fintech companies in Germany', limit: 10 });

  // `total` may be a floor rather than a count: say "at least" when it is.
  const estimate = page.total_is_estimate ? 'at least ' : '';
  console.log(`${estimate}${String(page.total)} matches; this page cost ${String(page.meta.credits_charged)}\n`);

  for (const hit of page.results) {
    // `id`, `category` and `score` are fields; everything else the record holds is read by key.
    const name = typeof hit['account_name'] === 'string' ? hit['account_name'] : '(unnamed)';
    console.log(`  ${name.slice(0, 40).padEnd(42)} ${String(hit.score)}`);
  }

  // An empty list means nothing reduced the answer; anything here changes its meaning.
  for (const issue of page.degradation) console.log(`\n! ${issue.reason}: ${issue.detail} (affects ${issue.impact})`);

  // Look a row up by what it carries (its domain, else its LinkedIn page), never by `id`.
  const ref = page.results[0] === undefined ? undefined : lookupRef(page.results[0]);
  if (ref === undefined) {
    console.log('\nthe first row carries nothing a lookup can take');
  } else {
    // `by: 'auto'` (the default) reads a domain or a LinkedIn URL from the value itself.
    const found = await client.entities.companies({ ids: [ref.value] });
    const entry = entityHit(found, ref.value);
    for (const record of entry === undefined ? [] : recordsOf(entry)) console.log(`\n${JSON.stringify(record).slice(0, 200)}`);
  }
  console.log(`\nrequest_id=${page.meta.request_id}`);
} catch (error) {
  if (!(error instanceof InsufficientCreditsError)) throw error;
  console.log(`need ${String(error.requiredCredits)} credits, ${String(error.availableCredits)} available`);
}

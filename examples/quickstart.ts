/**
 * Search, then fetch the full record behind the first result. The smallest
 * useful program.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_test_<your-key>
 *   npx tsx examples/quickstart.ts
 */

import { InsufficientCreditsError, SproutsData, lookupRef } from 'sproutsdata';

const client = new SproutsData(); // reads SPROUTSDATA_API_KEY

try {
  const page = await client.search({
    query: 'fintech companies in Germany',
    mode: 'auto',
    category: 'company',
    limit: 10,
  });

  // `total` may be a floor. Rendering it as exact is the mistake this flag
  // exists to prevent.
  console.log(`${page.total_is_estimate ? 'at least ' : ''}${page.total} matches\n`);

  for (const hit of page.results) {
    // Only id, category and score are guaranteed. A company names itself in
    // `account_name`; everything else is read by key.
    const name = String(hit['account_name'] ?? '(unnamed)');
    console.log(`  ${name.slice(0, 40).padEnd(42)} ${String(hit['domain'] ?? '').padEnd(30)} ${hit.score}`);
  }

  // An empty list means the server checked and found nothing wrong. It never
  // means "unknown", so it is worth surfacing when it is not empty.
  for (const issue of page.degradation) {
    console.log(`\n! ${issue.reason}: ${issue.detail} (affects ${issue.impact})`);
  }

  // A search id is not a lookup key: look the row up by what it carries.
  const first = page.results[0];
  const ref = first === undefined ? null : lookupRef(first);
  if (ref === null) {
    console.log('\nno result carries a domain or LinkedIn URL to look it up by');
  } else {
    const lookup = await client.entities.companies({ ids: [ref.value], by: ref.by });
    for (const hit of lookup.results) {
      const company = hit.matches[0];
      if (company === undefined) console.log(`\nnot found: ${hit.id}`);
      else console.log(`\n${company.account_name}: ${company.employee_count} people, ${company.industry}`);
    }
  }

  console.log(`\nrequest_id=${page.meta.request_id}`);
} catch (err) {
  if (!(err instanceof InsufficientCreditsError)) throw err;
  console.log(`need ${err.required}, have ${err.available} — top up and retry`);
}

/**
 * Sort a search instead of ranking it, and check what the server applied.
 *
 * Relevance is the default order. A sort replaces it — which is why the server
 * insists on knowing the category, refuses a field the category cannot sort
 * on, and echoes the clauses it applied in `resolved_search.sort`. Read the
 * catalogue rather than guessing at field names: it is the server's list, with
 * labels.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_test_<your-key>
 *   npx tsx examples/sorted-search.ts "payments companies in Germany"
 */

import { SproutsData } from 'sproutsdata';

const query = process.argv.slice(2).join(' ') || 'payments companies in Germany';
const client = new SproutsData();

const catalogue = await client.sorts('company');
console.log('sortable fields for company:');
for (const info of catalogue.sorts) {
  const labels = info.directions.map((d) => `${d}=${info.direction_labels[d] ?? d}`).join(', ');
  console.log(`  ${info.field.padEnd(22)} ${info.kind.padEnd(7)} ${labels}`);
}

// A sort is part of the request the cursor is signed against, so page 2 is
// ordered the same way without being asked again.
let pageNumber = 0;
for await (const page of client.searchPages(
  {
    query,
    category: 'company',
    sort: [{ field: 'employee_count', direction: 'desc' }, { field: 'founded_year' }],
    limit: 10,
  },
  { maxResults: 20 },
)) {
  pageNumber += 1;
  if (pageNumber === 1) console.log(`\napplied: ${JSON.stringify(page.resolved_search?.sort ?? [])}\n`);
  for (const hit of page.results) {
    const name = String(hit['account_name'] ?? hit.id);
    console.log(`  ${name}: ${hit['employee_count']} people, founded ${hit['founded_year']}`);
  }
}

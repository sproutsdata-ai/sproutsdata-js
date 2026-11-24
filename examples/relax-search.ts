/**
 * A search that found nothing: why, and the smallest change that finds something.
 *
 * An empty first page always says why, in a `no_match` degradation. When leaving out one filter
 * would find records, `page.suggestion` has `kind: 'relax'` and lists those filters in `without`,
 * fewest records first (the smallest change to the ask). `topic` there means the query's topic. A
 * search that finds nothing is free.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_live_<your-key>
 *   node examples/relax-search.ts
 */

import { SproutsData } from 'sproutsdata';
import type { DiscoverFilters, SearchEnvelope } from 'sproutsdata';

const client = new SproutsData();

const QUERY = 'enterprise software';
const FILTERS: DiscoverFilters = {
  geo: { places: [{ level: 'country', value: 'Iceland' }] },
  employee_count: { gte: 5000 },
};

function show(page: SearchEnvelope): void {
  for (const hit of page.results) console.log(`  ${hit.id}`);
}

let page = await client.search({ query: QUERY, filters: FILTERS, limit: 5 });
if (page.results.length > 0) {
  show(page);
} else {
  for (const entry of page.degradation) {
    if (entry.reason === 'no_match') console.log(`Nothing matched: ${entry.detail}`);
  }
  const smallest = page.suggestion?.kind === 'relax' ? page.suggestion.without?.[0] : undefined;
  if (smallest === undefined) {
    console.log('No single filter is to blame; rephrase the search.');
  } else {
    console.log(`Without ${smallest.label ?? smallest.filter}: ${smallest.total.toLocaleString('en')} records`);
    const kept = Object.fromEntries(Object.entries(FILTERS).filter(([name]) => name !== smallest.filter));
    page =
      smallest.filter === 'topic'
        ? await client.search({ filters: FILTERS, limit: 5 })
        : await client.search({ query: QUERY, filters: kept, limit: 5 });
    show(page);
  }
}

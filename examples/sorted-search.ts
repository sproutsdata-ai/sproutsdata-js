/**
 * A search in an order you choose, from the fields the server says it can sort on.
 *
 * Relevance is the default order; a sort replaces it. `client.sorts(category)` lists each field a
 * category sorts on, with a label and its default direction, so read it rather than guess a field
 * name. The server echoes the clauses it applied in `resolved_search.sort`.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_test_<your-key>
 *   node examples/sorted-search.ts
 */

import { SproutsData } from 'sproutsdata';

const client = new SproutsData();

const options = await client.sorts('company');
for (const option of options.sorts.slice(0, 5)) {
  console.log(`${option.field.padEnd(24)} ${option.label} (default ${option.default_direction})`);
}

const page = await client.search({ query: 'robotics', sort: [{ field: 'employee_count', direction: 'desc' }], limit: 5 });
for (const hit of page.results) console.log(`  ${String(hit['employee_count'])}  ${hit.id}`);
console.log(`applied: ${JSON.stringify(page.resolved_search?.sort ?? [])}`);

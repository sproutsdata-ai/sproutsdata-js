/**
 * Filters: the typed vocabulary for companies and people, and the free-form
 * filters the document categories take.
 *
 * A `company` or `person` filter with a misspelt name or a wrong shape is a
 * compile error here, and a 422 naming the filter if it gets past the compiler.
 * A document category's filters are checked by the retrieval engine, whose 422
 * may not say which key was wrong — so read their names and values first.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_test_<your-key>
 *   npx tsx examples/typed-filters.ts
 */

import { InvalidRequestError, SproutsData } from 'sproutsdata';

const client = new SproutsData();

// `company` and `person` nest each filter under its field name.
const companies = await client.search({
  category: 'company',
  filters: {
    industry: { include: ['Software & Technology'] },
    employee_count: { gte: 500, lte: 5000 },
    founded_year: { gte: 2010 },
    geo: { places: [{ value: 'Germany', level: 'country' }] },
  },
  limit: 5,
});
console.log(`companies: ${companies.total}`);

// One past job per group: "worked at Stripe for at least two years".
const alumni = await client.search({
  category: 'person',
  filters: {
    employment_history: {
      groups: [{ company: { include: [{ value: 'stripe.com', by: 'domain' }] }, tenure_gte: 2 }],
    },
    seniority: { include: ['VP', 'Director / Head'] },
  },
  limit: 5,
});
console.log(`Stripe alumni in leadership: ${alumni.total}`);

// Don't guess vocabulary values — enumerate them. Free.
const industries = await client.filterValues('industry', { level: 'parents' });
console.log(`top-level industries: ${industries.values.slice(0, 5).join(', ')}, …`);

// The document categories take their filters flat, with names of their own.
const statuses = await client.documentFilterValues('patent', 'status');
console.log(`patent statuses: ${statuses.values.join(', ')}`);

try {
  const patents = await client.search({
    category: 'patent',
    query: 'solid-state battery',
    filters: { offices: { include: ['US'] }, status: statuses.values[0] ?? 'granted' },
    limit: 5,
  });
  console.log(`patents: ${patents.total}`);
} catch (err) {
  // The engine's refusal carries its own words as `detail` and no field paths.
  if (!(err instanceof InvalidRequestError)) throw err;
  console.log(`refused: ${err.detail} (field errors: ${err.fieldErrors.length})`);
}

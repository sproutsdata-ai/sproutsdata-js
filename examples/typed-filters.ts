/**
 * Filters: a company search with the typed company filters, and a document search with its own.
 *
 * Company and person searches take `DiscoverFilters`; each document category has its own filters
 * (`NewsFilters`, `PatentFilters`, ...) and refuses the company ones. The client checks a body
 * before sending it and refuses what the server would, with the field named.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_test_<your-key>
 *   node examples/typed-filters.ts
 */

import { ClientValidationError, type DiscoverFilters, type NewsFilters, SproutsData } from 'sproutsdata';

const client = new SproutsData();

const companies: DiscoverFilters = {
  geo: { places: [{ value: 'germany', level: 'country' }] },
  employee_count: { gte: 100, lte: 5000 },
  industry: { include: ['Software & Technology'] },
};
// A date filter wraps a bound: `period` is when the article was published.
const news: NewsFilters = { published_date: { period: { preset: 'last_30_days' } } };

const page = await client.search({ query: 'payments', filters: companies, limit: 5 });
console.log(`companies: ${String(page.total)}`);
const articles = await client.search({ query: 'robotics funding', category: 'news_article', filters: news, limit: 5 });
console.log(`articles: ${String(articles.total)}`);

try {
  // A range whose bounds cross is refused here, before it costs anything.
  await client.search({ query: 'payments', filters: { employee_count: { gte: 500, lte: 10 } } });
} catch (error) {
  if (!(error instanceof ClientValidationError)) throw error;
  console.log(`refused locally: ${error.message}`);
}

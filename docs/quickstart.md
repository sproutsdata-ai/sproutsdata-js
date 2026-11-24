# Quickstart

From an API key to a search, a look-alike search and a full record, with what
each answer tells you. The other pages go deeper into one area each; the
[index](README.md) lists them.

## Before you start

You need:

1. **Node.js 22.12.0 or newer**, or another server runtime with a WHATWG
   `fetch` (Deno, Bun, an edge runtime). The SDK has no runtime dependencies.
   It refuses to run in a browser: see
   [Authentication](authentication.md#keys-are-server-side-credentials).
2. **An API key**, created in the Sprouts Data dashboard. Keys look like
   `sk_dsp_live_…`. Every key is a live key: each billed call is charged to the
   workspace's credits, and a new workspace starts with sign-up credits for
   evaluation.
3. **The scopes your calls need** on that key. See
   [Authentication](authentication.md#scopes).

## How searches are billed

A search is billed per search session. Page 1 opens a session and costs the
price list's base, which covers its first rows. A later page of the same
session costs only the rows it adds beyond those (often nothing), and a page
already paid for is free. Asking for page 1 again opens a new session and is
charged again. Every billed answer says what it cost in `meta.credits_charged`.

Look-alikes and relationships are billed by session in the same way. Lookups
are billed per record returned, org charts per call, and agent runs when
they settle. Coverage, sorts, filter values, credits, history, feedback, lists
and exports are free.

## Install

```sh
npm install sproutsdata
```

The package ships ESM and CommonJS builds, with types for both.

## Configure

```sh
export SPROUTSDATA_API_KEY=sk_dsp_live_<your-key>
```

```ts
import { SproutsData } from 'sproutsdata';

const client = new SproutsData(); // reads SPROUTSDATA_API_KEY
```

Every option, the environment variables and what the constructor refuses are
in [Authentication](authentication.md#configuration).

## Your first search

```ts
const page = await client.search({
  query: 'industrial robotics companies in Germany',
  mode: 'auto',
  limit: 10,
});

console.log(`${page.total}${page.total_is_estimate ? '+' : ''} matches; this page cost ${page.meta.credits_charged ?? 0} credits`);

for (const hit of page.results) {
  // A row always has id, category and score; the rest is the record's own fields.
  console.log(hit.id, hit.score, hit['account_name'], hit['domain']);
}
```

`category` defaults to `company`.

## Search in depth

### Choosing a mode

| Mode | What it does |
|---|---|
| `fast` (the default with a category) | What the words ask becomes filters (the filters you send win), and the description left over is matched by meaning. Billed as a basic search. |
| `auto` | The same reading, billed as an AI search. The only mode of `category: 'auto'`. |

`resolved_search` reports what the reading inferred. `deep` is no longer offered:
`mode: 'deep'` throws `ClientValidationError` before anything is sent. To have an agent
work a question out and check every row against it, start an [agent run](runs.md).

### Choosing a category

One request searches one category:

`company` · `person` · `patent` · `academic_report` · `news_article` ·
`market_report` · `trend` · `funding_round` · `job_opening`

`company` and `person` share the `DiscoverFilters` vocabulary. Every other
category is a document corpus with its own filter and sort types, and refuses
company and person filters. See [Filters](filters.md).

To let the question pick the category, pass `category: 'auto'`. Such a search
takes only `query`, `mode`, `limit` and `cursor`, and runs in `auto` mode, its
only mode; the SDK refuses anything else locally.

```ts
const page = await client.search({ category: 'auto', query: 'recent funding rounds in the payments space' });
console.log(page.resolved_search?.category);
```

### Query, filters, or both

A company or person search needs `query`, `keyword_query` or `filters`; a
document search needs `query` or filters that narrow it. The SDK refuses a
search with none of them.

```ts
// Query only
await client.search({ query: 'battery recycling startups' });

// Filters only
await client.search({
  category: 'company',
  filters: {
    industry: { include: ['Software & Technology'] },
    employee_count: { gte: 500, lte: 5000 },
    geo: { places: [{ value: 'Germany', level: 'country' }] },
  },
});

// Both: filters narrow, the query ranks
await client.search({
  query: 'battery recycling',
  filters: { geo: { places: [{ value: 'Germany', level: 'country' }] } },
});
```

The filter vocabulary and how to list the values a filter accepts are in
[Filters](filters.md). Ordering by a field instead of relevance is in
[Sorting](sorting.md).

### Keyword search

`keyword_query` searches company text, sent instead of `query`: a keyword, or
`{ and: [...] }`, `{ or: [...] }` and `{ not: ... }` nested. Companies only; the
document categories take the same tree as their `topic` filter
([Filters](filters.md#document-categories)).

```ts
const page = await client.search({
  category: 'company',
  keyword_query: { and: ['payments', { or: ['stripe', 'adyen'] }, { not: 'crypto' }] },
  filters: { geo: { places: [{ value: 'United States', level: 'country' }] } },
});
console.log(page.resolved_search?.keyword_query);
```

### Checked before sending

The SDK checks each search against the server's request models before sending
it: unknown fields, values out of range, closed vocabularies and the rules
across fields. A refused search throws `ClientValidationError`, sends nothing
and costs nothing. See [Errors and retries](errors.md#validation-detail).

## Look-alikes

"Companies like these": anchor on one or more companies. A bare string is a
domain; an anchor object names how its value reads (`by`: `domain`, `li_url` or
`name`) and how much it counts (`weight`).

```ts
const page = await client.similar({
  anchors: [
    'acme.com',
    { value: 'https://www.linkedin.com/company/globex', by: 'li_url' },
    { value: 'Initech', by: 'name', weight: 0.5 },
  ],
  combine: 'or',
  limit: 25,
});
console.log(page.total, page.results.length);
```

- `combine: 'and'` (the default) finds companies like all the anchors
  together; `'or'` finds companies like any one of them.
- `filters` take the same `DiscoverFilters` as a company search: the anchors
  decide who is similar, the filters which of those come back.
- Look-alikes are companies only; the SDK refuses another category.

The answer has the same shape as a search's.

## Full records

A search row carries the record's fields as the index holds them.
`client.entities` returns full records, one method per category:

| Method | Takes |
|---|---|
| `entities.companies` | domains, LinkedIn pages or names (`by`, default `auto`); up to 50, or up to 1,000 ids with `by: null` |
| `entities.persons` | LinkedIn URLs or names (`by`, default `auto`); the same limits |
| `entities.patents`, `entities.trends`, `entities.academicReports` | ids, up to 100 |
| `entities.news`, `entities.marketReports`, `entities.fundings`, `entities.jobOpenings` | names (the server's default), up to 50, or ids with `by: 'id'`, up to 100 |

Lookups are billed per record returned.

### From a search row to its full record

`lookupRef(hit)` says how to look a search row up: a company by its domain,
else its LinkedIn page; a person by their LinkedIn URL; a document by its
`d1_...` id. It returns `undefined` for a row with none of these. A person
row's `id` is a hash that no lookup resolves, so always go through
`lookupRef`.

```ts
import { entityHit, lookupRef, recordsOf } from 'sproutsdata';

const page = await client.search({ query: 'payments companies in Germany' });
const first = page.results[0];
const ref = first === undefined ? undefined : lookupRef(first);

if (ref !== undefined && ref.category === 'company' && (ref.by === 'domain' || ref.by === 'li_url')) {
  const answer = await client.entities.companies({ ids: [ref.value], by: ref.by });
  const hit = entityHit(answer, ref.value);
  for (const record of hit === undefined ? [] : recordsOf(hit)) console.log(record);
}
```

### Reading a lookup

A lookup answers one row per value sent, found values first (not in the order
sent). Each row has `id` (the value as sent), `found`, and `matches`: a list,
since a name can match several records. A value that matched nothing comes back
with `found: false` and no matches; it is not an error.

- `entityHit(answer, value)` finds the row for a value.
- `missingValues(answer)` lists the values that matched nothing.
- `recordsOf(hit)` reads a row's matches as typed records.

```ts
import { missingValues } from 'sproutsdata';

const answer = await client.entities.companies({
  ids: ['adyen.com', 'checkout.com', 'no-such-company.example'],
  by: 'domain',
  fields: ['account_name', 'industry', 'employee_count'],
});
console.log('not found:', missingValues(answer));
```

On company and person lookups, `fields` keeps only those fields of each record
(and its `id`). The server returns full records and the SDK applies `fields`
locally. On document lookups `fields` is sent to the server; `*` adds bulk
fields, which can be very large.

## Reading an answer

The answer carries fields that say how far to trust it:

| Field | What it tells you |
|---|---|
| `total`, `total_is_estimate` | How many matched. When `total_is_estimate` is true, `total` is a floor: show "1,200+", not "1,200". |
| `has_more`, `next_cursor` | Whether another page exists, and the cursor to fetch it. See [Pagination](pagination.md). |
| `degradation` | What the server could not do for this request, each with a `reason`, a `detail` and an `impact` (`recall`, `precision`, `freshness`, `fields`). Empty means checked and nothing degraded. |
| `resolved_search` | What the server decided the request meant: the filters an `auto` reading inferred (`filters_source`), the sort applied, any conflicts. |
| `suggestion` | Advisory, or `null`: a different `category` would probably have answered better (`kind: 'search'`; the rows still come from the search you asked for), or, on an empty first page, filters to leave out (`kind: 'relax'`, with `without`). |
| `attribution` | Which corpora the content came from, and how fresh each is. |
| `meta` | `request_id` (quote it to support), `as_of`, `credential`, `credits_charged`. |

Show degraded recall to your own users rather than hiding it:

```ts
const page = await client.search({ query: 'battery recycling startups' });
const recall = page.degradation.filter((d) => d.impact === 'recall');
if (recall.length > 0) console.warn('Results may be incomplete:', recall.map((d) => d.detail));
```

### When nothing matches

Every empty first page carries a `no_match` degradation whose `detail` says why.
When leaving out one filter would find records, `page.suggestion` says so: its
`kind` is `'relax'`, its `category` is `null`, and `without` lists those
filters, fewest records first, each with the `total` the search finds without
it. `filter` names the request field (`topic` means the query's topic) and
`label` says it in words. A search that finds nothing is free.

```ts
const filters = { geo: { places: [{ level: 'country' as const, value: 'Iceland' }] }, employee_count: { gte: 5000 } };
const empty = await client.search({ query: 'enterprise software', filters });
if (empty.suggestion?.kind === 'relax') {
  for (const option of empty.suggestion.without ?? []) console.log(`${String(option.total)} without ${option.label ?? option.filter}`);
}
```

`examples/relax-search.ts` runs the search again without the first filter
listed. Two more reasons qualify an answer that has rows:

- `sparse_filter`: an applied filter's field is held by few records (under
  5%), so a small `total` may reflect missing data rather than a narrow ask.
  The numbers are in `resolved_search.sparse_filters` (`filter`, `record_type`,
  `populated`, `of`, `share`).
- `topic_not_required`: none of the records the filters match mention the
  query's topic, so they are ranked by how close they come to it.

### What the index holds

`client.coverage()` reports what the index holds, by segment. It is free.

```ts
import { totalFor } from 'sproutsdata';

const report = await client.coverage({ category: 'company' });
for (const segment of report.segments) console.log(segment.name, segment.total, segment.with_embeddings);
console.log('companies:', totalFor(report, 'company'));
console.log('not in the index:', report.not_in_index);
```

`totalFor(report, category)` sums a category's segments without counting
people twice (people's ties to institutions are a segment of their own). A
segment's `with_embeddings` is how many records a semantic query can reach;
`null` means no vector retrieval runs against it.

## Next

- [Pagination](pagination.md): every page of a search, safely.
- [Errors and retries](errors.md): what is thrown, what is retried, and why.
- [Tools for models](tools.md): the same search as tools for OpenAI, Anthropic
  and agent frameworks.
- Runnable programs: [`examples/`](../examples/).

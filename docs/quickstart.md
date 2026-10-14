# Quickstart

From an API key to a search, a look-alike search and a full record, with what
each response is telling you. The other pages go deeper into one area each;
the [index](README.md) lists them.

## Before you start

You need three things:

1. **Node.js 18 or newer.** The SDK uses the built-in `fetch` and has no
   runtime dependencies. Bun and Deno work too: the SDK needs only a WHATWG
   `fetch`, `URL` and `AbortController`. Node is what is tested.
2. **An API key.** Keys are created in the Sprouts Data dashboard (Settings → API
   Keys) by a signed-in user, and look like `sk_dsp_live_…` or `sk_dsp_test_…`.
   The secret is shown once, at creation; store it in a secrets manager.
3. **The right scopes on that key.** See [Authentication](authentication.md#scopes).

Use a `sk_dsp_test_` key while developing. Test keys are metered and ledgered
but charged **zero credits**, and query the same records as a live key.

> **Billing in one paragraph.** A search costs 0.5 credits (`fast`) or 0.595
> (`auto`) for its first 10 results, then 0.08 or 0.085 per extra result,
> counted across all its pages, so going back is free and page size does not
> change the total. Look-alikes and relationships cost 2 credits for the first
> 10 results, then 1 per next 10; an org chart 1 flat; a lookup 1 credit per
> record found, with misses free. Agent runs hold their effort's price at start
> and settle when they finish. Credits, key usage, history, coverage, the sort
> catalogue, filter values, feedback and members are free. A call is charged
> only once its answer is ready, so an error is never charged, and every billed
> response states its cost in `meta.credits_charged`.

## Install

```sh
npm install sproutsdata
```

ESM and CommonJS, with full TypeScript types either way:

```ts
import { SproutsData } from 'sproutsdata';      // ESM / TypeScript
const { SproutsData } = require('sproutsdata'); // CommonJS
```

## Configure

```sh
export SPROUTSDATA_API_KEY=sk_dsp_test_<your-key>
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
  category: 'company',
  limit: 10,
});

console.log(`${page.total}${page.total_is_estimate ? '+' : ''} matches`);

for (const hit of page.results) {
  // Only id, category and score are guaranteed; the rest of a hit is the
  // record's own data and varies by category. A company names itself in
  // `account_name`.
  console.log(hit.id, hit.score, hit['account_name'], hit['domain']);
}
```

## Search in depth

### Choosing a mode

`mode` controls *what your words mean*, not how many results come back:

| Mode | Meaning | Cost / latency |
|---|---|---|
| `fast` (default) | **Match my words.** Lexical, no model in the request path. | 0.5 credits for the first 10 results, 0.08 per extra; fastest |
| `auto` | **Understand my intent.** A parser turns the query into structured filters. | 0.595 for the first 10, 0.085 per extra; tens of seconds on page 1, fast after |
| `deep` | **Reason about it.** Agentic, coverage-measured, one page. | The agent price of the effort it ran (today minimal, 1.02); slowest |

Use `fast` when the query is already keywords (`"payments api berlin"`), and
`auto` when it is a sentence describing what you want. In `fast` mode a
constraint stated only in words — a country, a headcount — is not applied;
`auto` applies it and reports what it inferred in `resolved_search`.

`deep` is different in kind, not just degree:

- **It searches `company` or `person`** — `company` when you name none.
  `category: 'auto'` is refused by the server: it classifies a query only
  under `mode: 'auto'`.
- **It returns one page with no cursor.** `searchPages` yields exactly one
  page, and a `cursor` on a deep search is a `501 not_implemented`
  (`FeatureNotAvailableError`).
- **It runs at the agent's minimal effort tier**, inside the server's own
  per-request budget; a larger `timeoutMs` does not change that. For exhaustive
  research with criteria and enrichment columns, start an [agent run](runs.md).
- **It reads only the query.** The server ignores `filters`, `sort`,
  `include_domains` and `exclude_domains` on a deep search — and bills it all
  the same — so the SDK refuses them locally (`ClientValidationError`, nothing
  sent). Empty ones are not refused: they ask for nothing. Put every
  constraint in the query's words, or use `auto`, which honours filters.

It fills the envelope's `coverage` block, so you can check exactly what that
page represents ([below](#the-coverage-block)).

```ts
const deep = await client.search({
  query: 'European payment processors that hold an e-money licence',
  mode: 'deep',
  category: 'company',
});
```

### Choosing a category

One request searches one category, and every returned row is that category:

`company` · `person` · `patent` · `news_article` · `trend` · `market_report` ·
`funding_round` · `academic_report` · `job_opening`

`company` and `person` are the GTM entity index. The rest are document corpora
with their own filters and freshness. A search that names no `category`
searches `company`.

You can also let the server pick: pass **`category: 'auto'`** and the SDK sends
no category, so the server classifies the query itself. That path is
deliberately narrow — `query` only, no `filters`, domain lists or `sort`, and
`mode: 'auto'` required (classification is itself a model call routing into an
already-parsed vertical). The SDK leaves those rules to the server: anything
else is a 422 naming the field.

```ts
// "what is this even about?" — the server decides company vs funding_round vs …
await client.search({
  query: 'recent funding rounds in the payments space',
  category: 'auto',
  mode: 'auto',
});
```

### Query, filters, or both

At least one of `query` and `filters` is required; the SDK refuses a request
with neither before it costs a round trip.

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

// Both: filters constrain, the query ranks
await client.search({
  query: 'battery recycling',
  filters: { geo: { places: [{ value: 'Germany', level: 'country' }] } },
});
```

The filter vocabulary, how a refused filter is reported, and how to enumerate
the values a filter accepts are in [Filters](filters.md). Ordering by a field
instead of relevance is in [Sorting](sorting.md).

### Keyword search

`keyword_query` searches company text — names, descriptions, keywords — with
a tree of keywords: a keyword, or `{ and: [...] }`, `{ or: [...] }` and
`{ not: node }`, nested up to six deep, at most 100 keywords of at most 100
characters each.

```ts
const page = await client.search({
  keyword_query: { and: ['payments', { or: ['stripe', 'adyen'] }, { not: 'crypto' }] },
  filters: { geo: { places: [{ value: 'US', level: 'country' }] } },
});
```

It takes `category: 'company'` (the default) only, never a `query` beside it and
never `mode: 'deep'`; `filters`, domain lists and `sort` combine with it. It is
billed as a `fast` search whatever the mode, and `page.resolved_search.keyword_query`
echoes the tree the server ran. The server checks the tree and names the bad
node in its 422. **Rolling out:** a deployment that does not have keyword search
yet answers 422 for the field.

### All search parameters

| Parameter | Type | Notes |
|---|---|---|
| `query` | `string` | Required unless `filters` or `keyword_query` is given. |
| `mode` | `'fast' \| 'auto' \| 'deep'` | Default `fast`. `deep`: one page, no cursor, query only. |
| `category` | `EntityCategory \| 'auto'` | Default `company`. `'auto'` (with `mode: 'auto'`, query only) asks the server to classify the query, and no category is sent. Not `'auto'` with `sort` or `deep`. |
| `filters` | `DiscoverFilters \| object` | Typed by `category`: `DiscoverFilters` for `company` / `person` (and `'auto'`), so a misspelt filter is a compile error; free-form for document categories. Refused under `deep`. |
| `include_domains` / `exclude_domains` | `string[]` | `company` / `person` / `job_opening` only. Refused under `deep`. |
| `keyword_query` | `KeywordQuery` | `company` only; see [Keyword search](#keyword-search). |
| `sort` | `SortClause[]` | `{ field, direction? }` clauses, strongest first. Not with `category: 'auto'`. Refused under `deep`. |
| `limit` | `number` | Page size; default 10, what a search's base price covers. |
| `cursor` | `string` | From a previous page's `next_cursor`. |

Numeric ranges are the server's to enforce: its 422 names the field, and the
SDK does not keep a copy that could go stale. Unknown parameters are refused
(`422 request.invalid`), never silently ignored.

## Look-alikes

"Companies like X": anchor on one or more companies and get ranked look-alikes.
Company-only: the API refuses another category rather than guessing.

```ts
const page = await client.similar({
  anchors: [
    { value: 'acme.com' },                                     // by: 'domain' (default)
    { value: 'https://linkedin.com/company/globex', by: 'li_url' },
    { value: 'Initech', by: 'name', weight: 0.5 },             // half influence
  ],
  combine: 'or',
  limit: 50,
});
```

- **`by`** — how to read the anchor value: `domain` (default), `li_url`, or
  `name`. Prefer domains; names are ambiguous.
- **`weight`** — 0 to 1, per anchor. `0` ignores the anchor, `1` gives it full
  influence.
- **`combine`** — `'and'` (default) averages the anchors into one profile:
  use it when they are examples of one ideal customer. `'or'` returns
  companies resembling any one of them: use it when they are alternatives.
  With several dissimilar anchors, `'and'` can describe a company that does
  not exist.
- **`filters`** — the same typed `DiscoverFilters` vocabulary as search.
  Anchors decide who is *similar*; filters decide which of those come back:

  ```ts
  await client.similar({
    anchors: [{ value: 'acme.com' }],
    filters: { geo: { places: [{ value: 'Germany', level: 'country' }] }, employee_count: { gte: 500 } },
  });
  ```

The response envelope is the same as a search's: the same pagination, the same
`degradation`, the same hit shape.

## Full records

A search hit is a row; `client.entities` returns the full record behind it,
fully typed. One method per category:

| Method | Endpoint | Returns |
|---|---|---|
| `client.entities.companies()` | `POST /v1/entities/companies` | `CompanyRecord` |
| `client.entities.persons()` | `POST /v1/entities/persons` | `PersonRecord` |
| `client.entities.patents()` | `POST /v1/entities/patents` | `PatentRecord` |
| `client.entities.news()` | `POST /v1/entities/news` | `NewsRecord` |
| `client.entities.trends()` | `POST /v1/entities/trends` | `TrendRecord` |
| `client.entities.marketReports()` | `POST /v1/entities/market-reports` | `MarketReportRecord` |
| `client.entities.fundings()` | `POST /v1/entities/fundings` | `FundingRecord` |
| `client.entities.academicReports()` | `POST /v1/entities/academic-reports` | `AcademicReportRecord` |
| `client.entities.jobOpenings()` | `POST /v1/entities/job-openings` | `JobOpeningRecord` |

All nine need the `dsp.entities.read` scope and are billed 1 credit per record found; misses are free.

### From a search hit to its full record

A company or person search hit's `id` is a *search* id — a domain or an opaque
16-hex hash — not the record id a plain lookup resolves, so `ids: [hit.id]`
finds nothing. Look the hit up by the identifier it carries instead;
`lookupRef(hit)` picks it:

```ts
import { lookupRef } from 'sproutsdata';

const page = await client.search({ query: 'payments companies in Germany', category: 'company' });
const ref = page.results[0] ? lookupRef(page.results[0]) : null;
// → { by: 'domain', value: 'adyen.com' } for a company (its LinkedIn page, by
//   'li_url', when it has no domain); { by: 'li_url', value: '…' } for a person
if (ref !== null) {
  const lookup = await client.entities.companies({ ids: [ref.value], by: ref.by });
  for (const hit of lookup.results) {
    if (hit.found) console.log(hit.matches[0]?.account_name, hit.matches[0]?.employee_count);
  }
}
```

Use `entities.persons` for a person hit; `ref.by` is then always `'li_url'`,
which it accepts. `lookupRef` returns `null` for a hit that carries neither
identifier, and for document hits, whose ids already are lookup ids.

### Resolving raw identifiers (`by`)

`companies` and `persons` take raw identifiers when `by` is set — handy when
all you have is a domain list or LinkedIn URLs:

```ts
const lookup = await client.entities.companies({
  ids: ['adyen.com', 'checkout.com'],
  by: 'domain', // 'auto' | 'domain' | 'li_url' | 'name'
  fields: ['account_name', 'industry', 'employee_count'],
});
```

- `auto` classifies each entry on its own (the same detection `similar()`
  applies to anchors); any other value reads every entry as that one kind.
- Persons accept `auto`, `li_url` and `name` — no `domain`, a person has none.
- Without `by`, `ids` are record ids. Prefer domains and LinkedIn URLs over
  names, which are ambiguous.

### `matches` is always a list, and misses are results

Every hit resolves to `matches: TRecord[]`, never a bare object: one record
for an id, domain or LinkedIn lookup, possibly several for a lookup by name (a
name is never a unique key). An unknown id comes back as a hit with
`found: false` and `matches: []` — not a 404, and not missing from the list.
`results` has one entry per requested id, in order, so you can see exactly
which ids matched. Only the ones found are charged.

```ts
for (const hit of lookup.results) {
  if (!hit.found) console.warn(`no record for ${hit.id}`);
}
```

### Trimming the response with `fields`

Document records can be large (a trend's full record runs to megabytes). Name
the fields you need:

```ts
const trends = await client.entities.trends({
  ids: ['<trend-id>'],
  fields: ['trend', 'description', 'topic_type'],
});
```

Fields left out come back empty; the record's shape does not change.

### Looking up documents by name

Four document categories have a name distinct from their id — a headline
(`news`), a report title (`marketReports`), the company a round belongs to
(`fundings`), a job role (`jobOpenings`). They take `by: 'id' | 'name'`:

```ts
// Every funding round matching "stripe" — several matches per entry is normal
const rounds = await client.entities.fundings({ ids: ['stripe'], by: 'name' });
for (const match of rounds.results[0]?.matches ?? []) {
  console.log(match.round_type, match.announced_on, match.amount_usd);
}
```

The SDK sends `by: 'id'` unless you pass `by: 'name'`, so a plain `{ ids }`
list keeps meaning what it says — the server's own default is `'name'`, which
would read a record id as free text. Ids from a document search hit are record
ids. `patents`, `trends` and `academicReports` take no `by`: their identifier
(patent number, trend name, DOI) already is the id.

### Batch limits

| Call shape | Most ids per call |
|---|---|
| `companies` / `persons` by record id | 1000 |
| `companies` / `persons` with `by` set | 50 (each value is resolved first) |
| A document category by id | 100 (document records are large) |
| A named document category with `by: 'name'` | 50 (each name can match several documents) |

The server enforces these: a larger batch is a `422` (`InvalidRequestError`)
whose message names the limit. The SDK does not mirror them, so a raised limit
needs no SDK release. Entity lookups are not paginated: one hit per input.

## Reading responses honestly

The envelope carries fields that say how much to trust the answer:

| Field | What it tells you |
|---|---|
| `total` + `total_is_estimate` | How many matched. When `total_is_estimate` is true, `total` is a floor: render "1,200+", not "1,200". |
| `coverage` | Measured recall, filled for `deep` searches and agent runs; `null` when coverage was not measured (never "zero"). See below. |
| `degradation[]` | What the server could not do for this request — a corpus timed out, vector coverage was incomplete, pagination was truncated. Empty means "checked, nothing degraded", never "unknown". Each entry has a `reason`, a human `detail` and an `impact` (`recall` / `precision` / `freshness` / `fields`). |
| `resolved_search` | What the server decided the request meant: the filters the parser inferred under `auto`, the `sort` actually applied (empty when the engine chose), any conflicts. |
| `suggestion` | A better way to have asked: `kind: 'search'` names a better `category`; `kind: 'agentic'` says no single search answers this — use an [agent run](runs.md). Advisory: `results` still came from the search you asked for. Null in the common case. |
| `columns` | The extra columns an answer table carries beyond the entity's own fields (`{ name, description, source }`, each row's value keyed by `name`). Null for a plain entity table. |
| `attribution[]` | Which corpora the content came from, and how fresh each is. |
| `truncated` | Set by the SDK: `true` when `degradation` holds `pagination_truncated`, so `has_more: false` does not mean complete. See [Pagination](pagination.md#truncated-results). |
| `meta.environment` | `live` or `test`, so a test-key result can never be mistaken for a live one. |
| `meta.request_id` | The handle for any support conversation — the `X-Request-Id` header when present. Log it. |

Surface degraded recall to your own users rather than hiding it:

```ts
const recallIssues = page.degradation.filter((d) => d.impact === 'recall');
if (recallIssues.length > 0) {
  console.warn('Results may be incomplete:', recallIssues.map((d) => d.detail));
}
```

### The coverage block

`total` says how many rows matched; `coverage` says whether those are all of
them.

```ts
const c = deep.coverage;
if (c) {
  c.universe;             // records matching the resolved query — counted, not sampled
  c.enumerated;           // how many this answer carries
  c.enumeration_recall;   // enumerated / universe; null when the universe was capped
  c.universe_exhausted;   // every matching record returned AND the count agrees
  c.constraints_unmet;    // parts of the question that could not be asked
  c.truncated_by;         // which limit stopped enumeration short, when one did
  c.criteria;             // per criterion: evaluated / passed, proven vs judged
  c.linkage;              // per joined dataset: how much of your set it can see
}
```

Read `universe_exhausted` together with `constraints_unmet` and `linkage`: it
is withheld whenever "we returned everything that matches" could not be an
honest sentence.

### What the index holds

`client.coverage()` reports what the index holds, per segment — free, and worth
reading before you promise a user an answer:

```ts
const report = await client.coverage({ category: 'company' });
for (const segment of report.segments) console.log(segment);
console.log('not in this deployment:', report.not_in_index);
```

A segment in `not_in_index` is absent, not empty: searching it is a question the
deployment cannot answer, not a quiet zero. When a segment's embedded count is
well below its total, a semantic query under-returns and the response says so
in `degradation`.

## Next

- [Pagination](pagination.md) — every page of a search, safely.
- [Errors and retries](errors.md) — what is thrown, what is retried, and why.
- [Tools for models](tools.md) — the same search as tools for OpenAI, Anthropic
  and agent frameworks.
- Runnable programs: [`examples/`](../examples/).

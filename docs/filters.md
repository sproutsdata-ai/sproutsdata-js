# Filters

`filters` narrows a search. Each category has its own filter type:

- **`company` and `person`** take `DiscoverFilters`, one vocabulary for both.
  A company filter on a person search applies to the person's employer; a
  person filter on a company search keeps companies that employ a matching
  person.
- **Each document category** (`patent`, `academic_report`, `news_article`,
  `market_report`, `trend`, `funding_round`, `job_opening`) takes its own filter
  type, such as `PatentFilters` or `NewsFilters`, and refuses the
  `DiscoverFilters` fields.
- **`category: 'auto'`** takes no filters: the question picks the category, and
  filters belong to one category.

The types are generated from the server's request models, so a misspelt filter
name is a compile error in TypeScript. The SDK also checks every filter before
sending it (the field names, the shapes, the closed values and the rules
below), and throws `ClientValidationError` for anything the server would
refuse. Filters are never silently dropped.

## The company and person vocabulary

`DiscoverFilters` (industry, employee_count, revenue, technology,
funding_stage, seniority, governance_level, employment_type, title, geo,
employment_history, and more) is built from a few value shapes:

| Shape | Fields | Used by |
|---|---|---|
| `TermsFilter` | `include`, `exclude`, `include_groups`, `match_all` | industry, technology, seniority, governance_level, employment_type, has_direct_access_to_c_suite, ... |
| `RangeFilter` | `gte`, `lte` (inclusive; at least one, low before high) | employee_count, revenue, tenure, ... |
| `DateBound` | `gte` / `lte`, or a `preset` such as `'last_90_days'` (not both) | last_funding_date, hiring_recency, last_job_changed |
| `EntityFilter` | `include` / `exclude` of `{ value, by? }` | company, investors, owned_by_organization |
| `TextFilter` | `include`, `exclude`, `exact` | title, hiring_role, person |
| `GeoFilter` | `places` of `{ value, level, scope?, negate? }`; `level` is `country`, `state`, `city` or `region` | geo |
| `EmploymentHistoryFilter` | `groups` of `{ company?, title?, role_started?, role_ended?, tenure_gte?, tenure_lte? }`, one group per past job | employment_history |

A filter object must say something: a `TermsFilter` needs at least one value in
`include`, `exclude` or `include_groups`, a range at least one bound, and
`filters` itself at least one filter.

```ts
await client.search({
  category: 'company',
  filters: {
    industry: { include: ['Software & Technology'] },
    employee_count: { gte: 500, lte: 5000 },
    geo: { places: [{ value: 'Germany', level: 'country' }] },
  },
});
```

## Past jobs

`employment_history` describes past jobs: each group is one job, and every
attribute of a group must hold for the same job. "Previously worked at any of
these" is one group whose `company.include` lists them; two groups are two
distinct jobs.

```ts
await client.search({
  category: 'person',
  filters: {
    employment_history: {
      groups: [{ company: { include: [{ value: 'Stripe', by: 'name' }] }, tenure_gte: 2 }],
    },
    governance_level: { include: ['Founder', 'Co Founder'] },
  },
});
```

## Document categories

A document category takes its own filters. For example, patents:

```ts
await client.search({
  category: 'patent',
  query: 'solid-state battery',
  filters: { offices: { include: ['US'] }, status: 'granted' },
});
```

A patent's `status` defaults to every patent, so `status` alone does not count
as narrowing the search: a patent search with no `query` needs another filter.
Nor does a filter of empty lists or objects (`{ growth: [] }`): a document
search then needs a `query`, or a filter with a value.

Every document category takes `topic`, what the records must be about, matched
in their own text: a keyword, or `{ and: [...] }`, `{ or: [...] }` and
`{ not: ... }` nested, with the limits of `keyword_query` (six levels, 100
keywords, 100 characters each). When it is not sent, it is filled from `query`.

```ts
await client.search({
  category: 'funding_round',
  filters: {
    topic: { and: ['payments', { not: 'crypto' }] },
    investors: { include: [{ value: 'sequoia.com' }, { value: 'a16z.com' }], match_all: true },
  },
});
```

`investors` on a funding round matches any of its `include` investors, or with
`match_all: true` every one of them in the same round; it needs at least one
entry.
List a document filter's values with `client.documentFilterValues` (below)
rather than guessing them.

## Domain lists

```ts
await client.search({
  query: 'observability',
  category: 'company',
  include_domains: ['datadoghq.com', 'grafana.com'],
  exclude_domains: ['splunk.com'],
});
```

On a person search, the lists apply to the person's employer. They apply to
`company`, `person` and `job_opening` only, and the SDK refuses them on any
other category, beside a `company` filter (two ways of saying the same thing),
and when a domain is blank.

## What a filter accepts

List the values rather than guessing them. Filter values are free, 20 to a
page.

```ts
const values = await client.filterValues('industry', { search: 'soft' });
console.log(values.values, values.has_more);

// Every value, with the pages walked for you
for await (const value of client.iterFilterValues('industry', { search: 'soft' })) {
  console.log(value);
}
```

The names `filterValues` takes are the `FilterName` type: the `DiscoverFilters`
fields except `geo`, plus `country`, `state`, `city` and `region`. A filter with
no fixed vocabulary (a range, a free-text filter) answers with no values: it
takes values you supply. For the `company` filter, `items` gives each company's
name and domain; it is `null` for every other filter.

### Geography is listed per level

`geo` spans four levels with no single vocabulary. List `country`, `state`,
`city` or `region`, and send each value back in `geo.places[].value` with the
matching `level`:

```ts
const cities = await client.filterValues('city', { search: 'ber' });
const city = cities.values[0];
if (city !== undefined) {
  await client.search({ category: 'company', filters: { geo: { places: [{ value: city, level: 'city' }] } } });
}
```

### Two-level vocabularies

Some filters, such as `industry` and `department`, have two levels: list the
parents first, then the children of one parent.

```ts
const parents = await client.filterValues('department', { level: 'parents' });
const children = await client.filterValues('department', { parent: 'Engineering' });
console.log(parents.values, children.values);
```

### Document filters

```ts
const statuses = await client.documentFilterValues('patent', 'status');
console.log(statuses.values);

for await (const office of client.iterDocumentFilterValues('patent', 'offices')) {
  console.log(office);
}
```

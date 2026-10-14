# Filters

Where a filter is checked depends on the category.

- **`company` and `person`** filters are validated by the API against the typed
  vocabulary below. A wrong name or shape is a `422 request.invalid` located at
  `body`, with the filter's own path in the message:
  `body: Value error, filters.employee_count.gt: Extra inputs are not permitted`.
  The SDK surfaces it as `InvalidRequestError`, with the entry on
  `err.fieldErrors` and the path in `err.message`.
- **The document categories** take their filters flat, and the API passes them
  to the retrieval engine as sent. The engine checks them, and its refusal is a
  `422 request.invalid` in the engine's own words, with no field paths — so it
  may not say which key was wrong.

Filters are never silently dropped.

## The typed vocabulary

For `company` and `person` — and for `category: 'auto'` — `filters` is
the typed `DiscoverFilters` vocabulary (industry, employee_count, revenue,
technology, funding_stage, seniority, governance_level, employment_type, title,
geo, employment_history, …), built from a handful of value shapes:

| Shape | Fields | Used by |
|---|---|---|
| `TermsFilter` | `include[]`, `exclude[]`, `match_all` | industry, technology, seniority, governance_level, employment_type, has_direct_access_to_c_suite, … |
| `RangeFilter` | `gte`, `lte` (inclusive) | employee_count, revenue, tenure, … |
| `DateBound` | `gte` / `lte` (ISO or `"now-30d"`), or a `preset` such as `'last_90_days'` | last_funding_date, hiring_recency, … |
| `EntityFilter` | `include[]` / `exclude[]` of `{ value, by? }` refs | company, investors, owned_by_organization, … |
| `TextFilter` | `include[]`, `exclude[]`, `exact` | title, hiring_role, person |
| `GeoFilter` | `places[]` of `{ value, level, scope?, negate? }` — `level` is required | geo |
| `EmploymentHistoryFilter` | `groups[]` of `{ company?, title?, role_started?, role_ended?, tenure_gte?, tenure_lte? }` — one group per past job | employment_history |

A misspelt filter name is a compile error:

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

`employment_history` replaces the retired `prior_company`: "previously worked at
any of these" is one group whose `company.include` lists them, and two groups
are two distinct jobs. `prior_company` is still declared (marked
`@deprecated`) so existing code compiles, but the SDK refuses it before
sending — in `filters` and in `filterValues` — with a `ClientValidationError`
that names `employment_history`.

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

The document categories take a free-form object — their filter vocabularies are
their own — with one filter per field:

```ts
await client.search({
  category: 'patent',
  query: 'solid-state battery',
  filters: { offices: { include: ['US'] }, status: 'granted' },
});
```

Read a document category's filter names and values with
`client.documentFilterValues` (below) rather than guessing them.

## Domain lists

```ts
await client.search({
  query: 'observability',
  category: 'company',
  include_domains: ['datadoghq.com', 'grafana.com'],
  exclude_domains: ['splunk.com'],
});
```

These apply to `company`, `person` and `job_opening` (a posting carries the
posting company's domain) only. A patent has no domain, and the API refuses the
parameter (`422`) rather than silently ignoring it. Domain lists are refused
beside a `company` filter — the same idea twice — and under `mode: 'deep'`.

## What a filter accepts

Do not guess vocabulary values — enumerate them. Filter values are free:

```ts
// What can `industry` be? (page size fixed at 20)
const values = await client.filterValues('industry', { search: 'soft' });
values.values; // ['Software & Technology', …]
values.items;  // aligned entries with { value, name, domain, id } where applicable

// …or every value, with the pages walked for you
for await (const value of client.iterFilterValues('industry', { search: 'soft' })) {
  console.log(value);
}
```

`filterValues` accepts every `DiscoverFilters` field except `geo`, plus
`country`, `state`, `city` and `region`. Filters with no fixed vocabulary
(every range, the free-text and entity filters) return empty `values` — an
answer, not a failure: those take values you supply.

### Geography is enumerated per level

`geo` itself is not a lookup name: it spans four levels with no single
vocabulary. Enumerate `country`, `state`, `city` or `region`, and send each
answer back in `geo.places[].value` with the matching `level`:

```ts
const cities = await client.filterValues('city', { search: 'ber' });
// each answer goes into geo.places[].value with level: 'city'
```

### Two-level vocabularies

`industry`, `sub_industry` and `department` have two layers: list the parents
first, then one branch at a time as the user expands it. `parent` and `level`
exclude each other, and `department` cannot be walked any other way.

```ts
const parents = await client.filterValues('department', { level: 'parents' });
const children = await client.filterValues('department', { parent: 'Engineering' });
```

### Document categories keep their own filters

```ts
const statuses = await client.documentFilterValues('patent', 'status');
for await (const value of client.iterDocumentFilterValues('patent', 'status')) {
  console.log(value);
}
```

No `parent` or `level` here, and an unknown name is a 404. `company` and
`person` are refused locally: their vocabulary is `filterValues`.

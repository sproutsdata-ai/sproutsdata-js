# Org charts

One company's people, counted by department and seniority, by sub-department,
and by place. `client.orgChart` has three billed calls (`retrieve`,
`departments`, `locations`), each charged per call, and a free `taxonomy`. They
need a key with `dsp.search.read`.

**Counts, never names.** The answers count people grouped by department and
seniority codes. No person is named, there are no reporting lines, and nothing
is paged: each answer is one aggregation. To see the people in one cell, run a
person [search](quickstart.md#your-first-search) with matching filters.

## Naming the company

Every call names the company by exactly one of:

- `domain`: the company's domain, such as `stripe.com`;
- `linkedin_url`: its LinkedIn company page, such as
  `linkedin.com/company/stripe`;
- `company_ref`: a reference from an ambiguous answer (see
  [below](#an-ambiguous-company)).

The SDK refuses a call with none or several of these, a domain that is not a
company domain, or a LinkedIn URL that is not a company page (a personal
profile or a school page has no org chart).

```ts
const chart = await client.orgChart.retrieve({ domain: 'stripe.com' });
console.log(chart.company.name, chart.total, chart.meta.credits_charged);
```

## `retrieve`: the grid

```ts
const chart = await client.orgChart.retrieve({
  domain: 'stripe.com',
  metrics: ['new_joiners', 'job_openings'],
});

for (const cell of chart.cells) {
  console.log(cell.department.label, cell.seniority.label, cell.count, cell.new_joiners, cell.job_openings);
}
for (const total of chart.department_totals) console.log(total.code, total.label, total.count);
console.log(chart.seniority_totals, chart.new_joiners_total, chart.job_openings_total);
```

- `cells` holds one count per department and seniority; each axis value is a
  `{ code, label }`.
- `department_totals` and `seniority_totals` are lists of `{ code, label,
  count }`; `subdepartments` counts people by sub-department.
- `metrics` adds badges per cell: `new_joiners`, `job_openings`, or both.
  Leave it out for none.
- `suspect_count` is how many people were left out as likely fake profiles.
  `include_suspects: true` keeps them in.
- `coverage` compares how many of the company's people the index holds with
  the company's own employee count. When `coverage.low` is true, the chart shows
  only a small part of the company.
- `data_version` and `taxonomy_version` say which data and which taxonomy the
  counts come from.

## `departments` and `locations`

```ts
const departments = await client.orgChart.departments({ domain: 'stripe.com' });
for (const row of departments.subdepartments) {
  console.log(row.department.label, row.subdepartment.label, row.seniority.label, row.count);
}

const places = await client.orgChart.locations({ domain: 'stripe.com' });
for (const country of places.countries) {
  console.log(country.value, country.count);
  for (const state of country.children) console.log('  ', state.value, state.count, state.children.length, 'cities');
}
```

`locations` answers a tree: `countries`, each with its states as `children`,
and each state with its cities.

## Filters

`filters` narrows the people before they are counted, on every call:

| Filter | Takes |
|---|---|
| `query` | `{ text, field? }`: free text, read as `auto` or as one of `name`, `title`, `linkedin`, `location`, `seniority`, `department` |
| `job_titles` | up to 20 titles |
| `departments`, `seniorities` | taxonomy codes (see [The taxonomy](#the-taxonomy)) |
| `locations` | `{ include?, exclude? }`, each `{ countries?, states?, cities? }` |
| `governance_levels`, `employment_types` | values from the taxonomy |
| `has_direct_access_to_c_suite` | `true` or `false` |

```ts
const engineering = await client.orgChart.retrieve({
  domain: 'stripe.com',
  filters: {
    locations: { include: { countries: ['Germany', 'Ireland'] } },
    job_titles: ['Engineering Manager'],
    query: { text: 'payments', field: 'title' },
  },
});
console.log(engineering.total);
```

### Retired fields

The fields the org chart took at the top level before are refused before
sending, and the error names where each one went:

| Retired | Now |
|---|---|
| `country`, `state`, `city` | `filters.locations.include.countries`, `.states`, `.cities` |
| `governance_level` | `filters.governance_levels` |
| `employment_type` | `filters.employment_types` |
| `has_direct_access_to_c_suite` | `filters.has_direct_access_to_c_suite` |
| `include_others` | `include_suspects` |
| `search` | `filters.query` |

## The taxonomy

`taxonomy()` is free. It lists the department, sub-department and seniority
codes the filters take, with their labels, and the governance levels and
employment types.

```ts
const taxonomy = await client.orgChart.taxonomy();
console.log(taxonomy.taxonomy_version, taxonomy.governance_levels, taxonomy.employment_types);
for (const department of taxonomy.departments) console.log(department);
```

## An ambiguous company

A domain or page that names several companies throws
`OrgChartCompanyAmbiguousError` (422), and nothing is charged. Its
`candidates` each carry a `company_ref`, with a `name`, `domain` and
`linkedin_url` where known. Call again with the `company_ref` of the one you
mean:

```ts
import { OrgChartCompanyAmbiguousError } from 'sproutsdata';

async function chartFor(domain: string) {
  try {
    return await client.orgChart.retrieve({ domain });
  } catch (err) {
    if (!(err instanceof OrgChartCompanyAmbiguousError)) throw err;
    for (const candidate of err.candidates) console.log(candidate.company_ref, candidate.name, candidate.domain);
    const first = err.candidates[0];
    if (first === undefined) throw err;
    return client.orgChart.retrieve({ company_ref: first.company_ref });
  }
}

const chart = await chartFor('example.com');
console.log(chart.company.company_ref, chart.total);
```

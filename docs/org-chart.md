# Org charts

One company's people, counted by department and seniority, with each
department's sub-departments, and by location. Three calls under
`client.orgChart`, each billed 1 credit flat (free when it counts nobody), under
the `dsp.search.read` scope. They mirror One Platform's org chart, so the two
agree for the same company.

**This is a matrix, not a tree.** The corpus carries no reporting lines — no
person record says who they report to — so these routes count people grouped by
two closed vocabularies. There is no manager anywhere in the answer, and none of
the three responses is paginated: a grid is one aggregation.

## Naming the company

Every call takes `domain` or `linkedin_url` — exactly one:

```ts
await client.orgChart.retrieve({ domain: 'stripe.com' });
await client.orgChart.retrieve({ linkedin_url: 'linkedin.com/company/stripe' });
```

Most companies in the index carry **no domain**, which is what the LinkedIn form
is for: given a company page, the platform resolves the record itself. A pasted
URL is reduced to its host server-side (`https://www.stripe.com/about` and
`stripe.com` are the same request). A personal profile (`/in/`) or a school page
is refused by the server with a 422 — neither has an org chart. The response's
`company` echoes the identifier you sent; on `retrieve` and `departments` it is
completed with the company's `name` and LinkedIn page where the index has them
(the location tree names no company).

## `retrieve` — the grid

```ts
const grid = await client.orgChart.retrieve({
  domain: 'stripe.com',
  filters: {
    locations: { include: [{ level: 'country', value: 'Netherlands' }] }, // ≤10 places each side
    employment_types: ['full_time'],  // full_time | part_time | freelancer | contractor | consultant
    governance_levels: ['founder'],   // founder | co_founder | owner | partner | board_member | investor | advisor
    c_suite_access: true,             // tri-state: true / false / omitted
  },
  metrics: [],                        // the per-cell badges: new_joiners, job_openings (both by default)
});

grid.total;          // people, each once at their most senior level
grid.departments;    // rows: { code, label, total, unknown }, taxonomy order, Unknown last
grid.seniorities;    // columns: C-Suite down to In Training, Unknown last
for (const cell of grid.cells) {
  console.log(cell.department.label, cell.seniority.label, cell.count, cell.badges);
}
grid.subdepartments; // each department's sub-departments, with their own seniority counts
```

Counting rules worth knowing:

- Every filter narrows the population *before* counting, so it changes the
  counts rather than blanking cells — filtering to one country returns that
  country's org chart, not the company's with cells hidden. Filters combine with
  AND, values inside one with OR.
- `total` is the people, each counted **once at their most senior level**, so it
  equals the sum of the seniority columns. A person is in **every department
  they hold**, so the rows — and the cells — can add up to more. Read `total` as
  the headcount.
- Each axis ends with an explicit **Unknown** (`code: UNKNOWN_CODE`) for the
  people that could not be placed on it. It is not a search filter value, so a
  cell in it cannot be drilled into.
- Suspect profiles (likely fake or invalid) are left out unless
  `include_suspects: true`; `suspect_count` says how many.

`state` says how complete the answer is: `ready`, `empty` (`no_profiles`), or
`degraded` with reason `low_coverage` (`coverage` gives the numbers and lists the
other records of the same company). With `filters.text`, `matched` says what the
search matched.

To list the people behind a cell, search for them with the cell's **labels**:
`client.search({ category: 'person', include_domains: ['stripe.com'], filters:
{ department: { include: [cell.department.label] }, seniority: { include:
[cell.seniority.label] } } })`.

## `departments` — the rows, one level finer

```ts
const view = await client.orgChart.departments({ linkedin_url: 'linkedin.com/company/stripe' });
for (const row of view.subdepartments) {
  console.log(row.department.label, row.subdepartment.label, row.total, row.cells);
}
```

The grid's `departments` and `subdepartments`, and its `total`, without the
cells and badges. The same filters as `retrieve`, and `include_suspects`.
`retrieve` already carries `subdepartments`, so call this only when the cells are
not wanted.

## `locations` — where they are

```ts
const where = await client.orgChart.locations({ domain: 'stripe.com' });
for (const country of where.items) {
  console.log(country.label, country.count);
  for (const state of country.children) {
    console.log('  ', state.label, state.count);
    for (const city of state.children) console.log('    ', city.label, city.count);
  }
}
```

Nodes come by count. Each level is complete: people with no known place at a
level are an Unknown node (`value: null`, `unknown: true`), so a parent's count
is the sum of its children. A node's `level` and `value` go straight back as a
place in `filters.locations`. It takes the same `filters` as the grid.

## When the deployment has no org chart

A deployment without the org-chart upstream answers `501 not_implemented`
(`FeatureNotAvailableError`). That is an absent capability, not a transient
failure, and it is never retried.

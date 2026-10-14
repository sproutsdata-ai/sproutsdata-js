# Org charts

One company's people, counted by department and seniority, then by
sub-department, then by location. Three calls under `client.orgChart`, each
billed 1 credit flat, under the `dsp.search.read` scope.

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
`company` echoes whichever identifier resolved it, normalised.

## `retrieve` — the grid

```ts
const grid = await client.orgChart.retrieve({
  domain: 'stripe.com',
  country: ['Netherlands'],           // OR within a level, AND across levels
  employment_type: ['Full Time'],     // Full Time | Part Time | Freelancer | Contractor | Consultant (External)
  governance_level: ['Founder'],      // Founder | Co Founder | Owner | Partner | Board Member | Investor | Advisor
  has_direct_access_to_c_suite: true, // tri-state: true / false / omitted
  include_others: false,              // count the unclassifiable `Others` bucket too
});

grid.total;              // everyone at the company under the filters
grid.departments;        // row order: headcount descending, `Others` / `General` last
grid.seniorities;        // column order: C-Suite, VP, Director / Head, Manager, IC, Entry, In Training, Others
for (const cell of grid.cells) console.log(cell.department, cell.seniority, cell.count);
grid.department_totals;  // per row — not the sum of its cells
grid.seniority_totals;   // per column — same caveat
```

Three counting rules worth knowing:

- Every filter narrows the population *before* grouping, so it changes the
  counts rather than blanking cells — filtering to one country returns that
  country's org chart, not the company's with cells hidden.
- `total` is usually higher than the sum of the cells: people the corpus could
  not place on both axes are in the headcount and in no cell, and someone in
  several buckets can be counted in more than one. Read `total` as the headcount
  and the cells as the classified part of it; report both. The per-axis totals
  have the same property.
- `Others` is a bucket, not a department or a level. It is off by default
  (`include_others: false`) because it is usually large and never drillable —
  a search has no `Others` to filter by.

## `departments` — one level down

```ts
const tree = await client.orgChart.departments({ linkedin_url: 'linkedin.com/company/stripe' });
for (const dept of tree.departments) {
  console.log(dept.name, dept.headcount);
  for (const sub of dept.sub_departments) {
    console.log('  ', sub.name, sub.headcount, sub.seniority_counts); // `Uncategorized` = no sub-function recorded
  }
}
```

The same people filters as `retrieve`; no `total` (that lives on `retrieve`). A
department name absent from the grid's `departments` can appear here: the grid
relabels onto a closed taxonomy, and this route reports what is stored. The
seniority keys are the upstream's raw labels, so `Uncategorized` appears here
where the grid says `Others`.

## `locations` — where they sit

```ts
const where = await client.orgChart.locations({ domain: 'stripe.com', search: 'amst' });
for (const country of where.locations) {
  console.log(country.country, country.count);
  for (const state of country.states) {
    console.log('  ', state.state, state.count);
    for (const city of state.cities) console.log('    ', city.city, city.count);
  }
}
```

There is a count at every level, because a country's count is not the sum of
its states — someone with a country and no state is counted at the country and
in no state below it. `search` is a case-insensitive substring over all three
levels; it filters *people*, so a match on a city keeps that city's country and
state in the tree with counts reduced to the matching people.

This route is also the vocabulary the other two routes' location filters
accept. The exported `UNKNOWN_LOCATION` (`'__unknown__'`) is the label for
people with no value at a level — send it back as a filter value to select
exactly those people.

## When the deployment has no org chart

A deployment without the org-chart upstream answers `501 not_implemented`
(`FeatureNotAvailableError`). That is an absent capability, not a transient
failure, and it is never retried.

# Relationships

The affiliation graph: who is connected to whom through shared employers and
schools. Four calls under `client.relationships`, all billed and all needing a
key with `dsp.search.read`. `find`, `reach` and `ask` are billed by session, as
a search is; `institutions` per call. Each answer's cost is
`meta.credits_charged`.

| Call | Question |
|---|---|
| `relationships.find` | Which people at one company are connected to another company, or through named institutions? |
| `relationships.reach` | Who can one named person reach at a company, and through what? |
| `relationships.institutions` | Which employers and schools do two companies' people share? |
| `relationships.ask` | Any of these, asked in words; the server picks the route. |

A connection is a shared institution, not an acquaintance: two people who
worked at the same company may never have met. Every row says why it surfaced.

"Who works at X" is not a relationship question: it is a search with
`category: 'person'`.

## `find`

A question in words (`query`), or its structure: `relation` with its
`companies`. `between_companies` (the default) takes exactly two companies;
`via_institution` takes one company and up to 10 `institutions`.

```ts
// People at one company connected to people at another
const page = await client.relationships.find({
  relation: 'between_companies',
  companies: [{ value: 'stripe.com' }, { value: 'adyen.com', people: { seniority: ['VP'] } }],
  limit: 25,
});

for (const person of page.results) {
  console.log(person.full_name, person.title, person.match_type[0]);
  for (const via of person.via) console.log('  via', via.name, via.kind, via.started, via.ended);
}
console.log(page.institutions.length, 'shared institutions;', page.meta.credits_charged, 'credits');
```

```ts
// One company, through named institutions
await client.relationships.find({
  relation: 'via_institution',
  companies: [{ value: 'stripe.com' }],
  institutions: [{ value: 'Stanford University', kind: 'school' }],
  institutions_combine: 'any', // 'all' needs two or more institutions
});

// The question in words
await client.relationships.find({ query: 'who at Adyen do we know from Stripe' });
```

The SDK refuses, before sending:

- a request with neither `query` nor `relation` and `companies`;
- `query` beside the structured fields (`companies`, `institutions`,
  `institutions_combine`, `institution_type`, `exclude_current`), which would be
  ignored;
- `between_companies` without exactly two companies, and `via_institution`
  without exactly one company and at least one institution.

Reading the answer:

- Each row is a person, with `via` (the shared institutions, each with dates,
  role and a `match_type`) and `match_type` (the same phrases, strongest
  first).
- `number_of_contacts_overlapping_tenure_with` is a count; `null` means it was
  not computed.
- The answer adds `institutions` (the shared institutions themselves) and
  `connection_basis`: `overlapping` (at the institution at the same time) or
  `shared` (both were ever there). Send `connection_basis` to choose.
- `exclude_current` and `include_company_context` are further options of the
  structured form.

`iterFind` walks every page; see [Pagination](pagination.md).

## `reach`

Who one person can reach at a company. The person is a LinkedIn profile URL
(`linkedin.com/in/...`); `find` returns one on every row as `linkedin_url`, so
the two calls compose.

```ts
const reachable = await client.relationships.reach({
  person: { li_url: 'https://www.linkedin.com/in/ada-lovelace/' },
  target_company: { value: 'microsoft.com', by: 'domain' },
  people: { seniority: ['VP'] }, // narrows the people reached
  limit: 20,
});

for (const person of reachable.results) {
  console.log(person.full_name, person.title);
  for (const how of person.how) console.log('  ', how.match_type, how.name, how.overlap_months);
}
for (const target of reachable.targets ?? []) console.log(target.id, target.name, target.total);
```

The SDK refuses a `person.li_url` that does not contain `linkedin.com/in/`, and
`people` set on `target_company` (use the top-level `people`).

**The page size is bound to the cursor.** Page 2 must ask for page 1's `limit`.
`iterReach` does this, and trims the last page locally to `maxResults`:

```ts
for await (const person of client.relationships.iterReach({
  person: { li_url: 'https://www.linkedin.com/in/ada-lovelace/' },
  target_company: { value: 'microsoft.com' },
  limit: 20,
  maxResults: 50,
})) {
  console.log(person.full_name);
}
```

With several target companies, `targets` gives each one's `id`, name and
total, and a row's `target_index` says which it belongs to. With several named
people, `seeds` gives each one's total and a row's `reached_by` says which of
them reach it.

## `institutions`

The employers and schools two companies' people share, counted, without ranking
any people.

```ts
const shared = await client.relationships.institutions({
  companies: [{ value: 'stripe.com' }, { value: 'adyen.com' }], // exactly two
  institution_type: 'education', // or 'employment'; leave it out for both
  min_people_per_side: 2,
  name_starts_with: 'stan',
  limit: 500,
});

for (const institution of shared.results) {
  console.log(institution.name, institution.kind, institution.people_first, institution.people_second);
}
if (shared.truncated) console.log('More shared institutions exist than `limit` returned.');
```

The answer is one aggregation and does not page. `truncated` says more
institutions qualified than `limit` returned.

## `ask`

`ask` takes a sentence, decides which kind of relationship question it is, and
reports the choice as `route`. Exactly one of `relationships`, `reach`,
`institutions`, `compare` and `fan_out` is set: the one `route` names.

```ts
const answer = await client.relationships.ask({ query: 'who at Adyen do we know from Stripe', limit: 10 });

console.log(answer.route, answer.reading.span, answer.reading.warnings, answer.meta.credits_charged);

if (answer.route === 'relationships' && answer.relationships !== null) {
  for (const row of answer.relationships.results) console.log(row.full_name, row.match_type[0]);
} else if (answer.route === 'compare' && answer.compare !== null) {
  console.log(answer.compare.sides.length, answer.compare.stronger, answer.compare.comparable);
} else if (answer.route === 'fan_out' && answer.fan_out !== null) {
  console.log(answer.fan_out.drill_downs.length, answer.fan_out.skipped);
}
```

- Read `route` first, then the field it names.
- `reading` shows how the sentence was read. A misread question still produces
  a well-formed answer, so check `reading.span` and `reading.warnings`.
- `compare.stronger` is the index of the stronger side, or `null` when the two
  cannot be ranked.
- What the answer cost is `meta.credits_charged`.

**Paging.** A `relationships` or `reach` answer can page: send its
`next_cursor` back to `ask` with the same `query`.

```ts
const query = 'who at Adyen do we know from Stripe';
const first = await client.relationships.ask({ query, limit: 10 });
const cursor = first.relationships?.next_cursor ?? first.reach?.next_cursor ?? null;
if (cursor !== null) {
  const second = await client.relationships.ask({ query, limit: 10, cursor });
  console.log(second.route);
}
```

Some answers carry more than rows: a `breakdown` of the people by department,
seniority, country or institution (`exact: false` means each group is an upper
bound), or a `share` of a population.

```ts
const byDepartment = await client.relationships.ask({ query: 'break down who we know at Adyen by department' });
for (const group of byDepartment.relationships?.breakdown?.groups ?? []) console.log(group.label, group.people);
```

## Errors

- An anchor that matched no company or institution throws
  `InvalidRequestError` with code `relationship.anchor_not_found` (422).
- An anchor that matched several throws `InvalidRequestError` with code
  `relationship.anchor_ambiguous`; `err.extra.candidates` lists the choices.
  Name it more precisely (a domain, a LinkedIn URL, or `by` and `kind`).
- A question the network cannot answer as asked throws `InvalidRequestError`
  with code `request.unsupported`; `err.extra.kind` says which refusal, and
  `err.extra.try_instead`, when present, suggests a rewording.

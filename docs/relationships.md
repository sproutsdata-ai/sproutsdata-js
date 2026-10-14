# Relationships

The affiliation graph: who is connected to whom through shared employers and
schools. Four calls under the `dsp.search.read` scope. `find`, `reach` and `ask`
cost 2 credits for the first 10 results, then 1 per next 10; `institutions`
(and an `ask` it answers) 2 flat:

| Call | Question |
|---|---|
| `relationships.find` | Which people at one company are connected to another, or to named institutions? |
| `relationships.reach` | Who can one named person reach at a company, and through what? |
| `relationships.institutions` | Which employers and schools do two companies share? |
| `relationships.ask` | Any of these, asked in words — the server picks the route. |

Two things to build around. A connection is a **shared institution, not an
acquaintance**: two people who both worked at the same company may never have
met. And every row says *why* it surfaced, because a name with no reason is
something nobody can act on.

"Who works at X" is not a relationship question — it is a search with
`category: 'person'`.

## `find` — the list question

```ts
// Who at Stripe is connected to people at Adyen?
const page = await client.relationships.find({
  relation: 'between_companies',
  companies: [
    { value: 'stripe.com' },                                           // FIRST: whose people come back
    { value: 'adyen.com', people: { seniority: ['VP', 'Director / Head'] } }, // SECOND: who they reach
  ],
});
```

**Order is the contract**: the first company's people are the rows, the second
is who they are connected to — swap them and you ask the mirror question. Each
side takes its own `people` constraints (`department`, `seniority`, `country`)
because the two sides are constrained independently; the affiliation corpus
holds no firmographics, so those constraints belong in a search.

The other structured shape is `via_institution` — one company plus the
institutions the connection must run through:

```ts
await client.relationships.find({
  relation: 'via_institution',
  companies: [{ value: 'stripe.com' }],
  institutions: [{ value: 'Stanford University', kind: 'school' }],
  institutions_combine: 'any', // 'all' needs at least two institutions
});
```

Or skip the structure and ask in words — never both; the SDK refuses the
combination locally, as does the server:

```ts
await client.relationships.find({ query: 'who at Adyen do we know from Stripe' });
```

Reading the answer:

- Each row is a person plus **why they surfaced**: `via[]` (the shared
  institutions, each with dates, role and a `match_type` phrase) and the row's
  own `match_type[]` — the same phrases ordered strongest first.
- `number_of_contacts_overlapping_tenure_with` — how many people at the *other*
  company this person can reach. `0` is a computed answer; `null` means the
  count was never attempted (a `via_institution` query has no other side).
- The envelope adds `institutions[]` (the bridges themselves — often the answer
  on its own) and `connection_basis`.
- `connection_basis` decides what *knowing* means: `'overlapping'` (the
  default — at the shared institution at the same time) or `'shared'` (both
  were ever there; on a large employer that counts everyone who passed
  through).
- Useful options: `exclude_current` ("previously worked at", not "works at"),
  `include_company_context` (adds each person's current employer).

## `reach` — one person's drill-down

`find` returns `linkedin_url` on every row, and `reach` takes exactly that, so
the two calls compose:

```ts
const reachable = await client.relationships.reach({
  person: { li_url: 'https://www.linkedin.com/in/ada-lovelace/' },
  target_company: { value: 'microsoft.com', by: 'domain' },
  people: { seniority: ['VP'] }, // constrains the people being reached
});

for (const person of reachable.results) {
  console.log(person.full_name, person.title);
  for (const how of person.how) {
    console.log(' ', how.match_type, how.overlap_months); // null = dates unknown, not 0
  }
}
```

The anchor is a LinkedIn **profile** URL (`linkedin.com/in/…`) — the only form
of person the route accepts. Not a name: names are not unique, and the wrong
person does not return a thin result, it returns a confident result about
somebody else. The SDK refuses a `person.li_url` that does not contain
`linkedin.com/in/` with a `ClientValidationError` before the billed call: a
company page would resolve to nobody and read as "this person knows no one".
Whether a profile URL resolves is the server's call.

The envelope's `institutions[]` lists every institution the anchor shares with
people at the target, each with `people_at_target` — it describes the whole
answer, not just this page. Both `find` and `reach` paginate the standard way:
`findPages` / `reachPages`.

## `institutions` — the bridges on their own

`find` returns the shared institutions beside a ranked page of people, which is
the expensive half and often not the half that was wanted. `institutions`
returns just the list — which employers and schools two companies have people
at in common, and how many on each side:

```ts
const shared = await client.relationships.institutions({
  companies: [{ value: 'stripe.com' }, { value: 'adyen.com' }], // exactly two
  institution_type: 'education', // or 'employment'; unset returns both
  min_people_per_side: 2,        // drops one-person coincidences
  name_starts_with: 'stan',      // case-insensitive prefix, not a substring
  limit: 500,                    // default 200
});

for (const inst of shared.results) {
  console.log(inst.name, inst.kind, inst.people_first, inst.people_second);
}
if (shared.truncated) {
  // more institutions qualified than `limit` returned — raise it or narrow
}
```

- **Order still matters.** The first company's own institution keys are left
  out of the bridges and the second's are kept, so swapping the two changes
  which institutions come back and what the per-side counts mean.
- **It is not paginated.** The answer is one aggregation: `has_more` is always
  `false`, `next_cursor` always `null`, and there is no `institutionsPages`.
  `truncated` is the field to branch on. `min_people_per_side` is applied
  *after* the upstream trims to the strongest `limit`, so raise `limit`
  alongside it when the answer looks short.

## `ask` — the question in words

`ask` takes a sentence and works out which kind of relationship question it is —
reporting the choice as `route`, and putting the answer in the field of that
name:

```ts
const answer = await client.relationships.ask({
  query: 'who at Adyen do we know from Stripe',
  limit: 10,
});

console.log(answer.reading.span, answer.reading.searches, answer.reading.warnings);

switch (answer.route) {
  case 'relationships': // people at one company connected to another
    for (const row of answer.relationships!.results) console.log(row.full_name, row.match_type[0]);
    break;
  case 'reach':         // who one named person can reach
    break;
  case 'institutions':  // the shared employers and schools themselves
    break;
  case 'compare':       // two ways in, weighed against each other
    console.log(answer.compare!.sides.length, answer.compare!.stronger, answer.compare!.comparable);
    break;
  case 'fan_out':       // people, each with what *they* can reach
    console.log(answer.fan_out!.drill_downs.length, answer.fan_out!.skipped);
    break;
}
```

- **Read `route` first, then the field it names.** Exactly one of
  `relationships`, `reach`, `institutions`, `compare` and `fan_out` is
  populated; the rest are `null`.
- **`reading` is how you catch a misreading.** A router that decides what kind
  of question a sentence is will sometimes decide wrongly, and a wrongly routed
  question still produces a well-formed answer — `reading.span` and
  `reading.warnings` are how you notice.
- **`compare` always returns both sides** with their evidence. `stronger` is an
  index into `sides`, or `null` when the two cannot be ranked — an answer, not a
  missing one.
- **Paging:** `askPages` follows the populated slot's `next_cursor`. Only the
  `relationships` route issues cursors today; `compare` and `fan_out` are single
  answers. The cursor carries the plan worked out for your question, so paging
  never re-interprets the sentence.
- An anchor that names something the corpus holds more than one of (a name that
  is both a company and a school) is refused with
  `422 relationship.anchor_ambiguous`; the problem body lists the options.
- A question `ask` cannot answer is refused with `422 request.unsupported`
  (`InvalidRequestError`); `err.problem.extra.kind` says which refusal
  (`no_anchor`, `wrong_route`, …) and `extra.try_instead`, when present,
  suggests a rewording.

Some questions bring more than rows:

```ts
const byDept = await client.relationships.ask({ query: 'break down who we know at Adyen by department' });
for (const group of byDept.relationships?.breakdown?.groups ?? []) console.log(group.label, group.people);

const share = await client.relationships.ask({ query: "what share of Adyen's sales org do we know" });
console.log(share.relationships?.share?.share); // total / population; null when there is no one

const several = await client.relationships.ask({ query: 'who can Ada reach at Adyen, Klarna or Mollie' });
for (const target of several.reach?.targets ?? []) console.log(target.value, target.name, target.total);
for (const row of several.reach?.results ?? []) console.log(row.full_name, row.target_index);
```

`breakdown.exact: false` means each group is an upper bound. With several target
companies the rows are grouped by company, `limit` applies to each one, and a
target whose name resolved to an earlier one carries `same_as` and no rows of
its own. With several named people, `seeds` gives each one's own total and a
row's `reached_by` says which of them reach it.

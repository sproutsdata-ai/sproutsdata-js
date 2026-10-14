# Sorting

By default the engine orders results itself — by relevance when there is a
query, by a quality ranking when there is not. `sort` replaces that with up to
three clauses, strongest key first:

```ts
await client.search({
  category: 'company',
  filters: { industry: { include: ['Software & Technology'] } },
  sort: [{ field: 'revenue' }, { field: 'account_name', direction: 'asc' }], // direction defaults to 'desc'
});
```

## Relevance and sorting are alternatives

A sorted search is no longer ranked. That is the point — "the 25 largest
matches" is a different question from "the 25 best matches" — but a sort on a
sparsely populated field can push thin records to the top, where relevance
would have buried them. Sort on what you are actually ordering by, and keep
`limit` honest.

## What each category can sort on

Which fields a category can sort on is the server's to say, and the server
checks it. Read the catalogue live rather than hard-coding names — it is free,
and it is how a change reaches you:

```ts
const catalogue = await client.sorts('person');
for (const s of catalogue.sorts) {
  console.log(s.field, s.label, s.kind, s.default_direction, s.applies_to, s.direction_labels);
}
// An empty `sorts` means the category takes no ordering instruction.
```

`direction_labels` says what each direction means for *that* field (`tenure`
sorts on a start date, so `desc` is "Longest first"). Not every field applies to
both GTM categories — `revenue` is company-only, `tenure` person-only.

For `company` and `person`, a field outside the category's vocabulary is a
`422 request.invalid`. The rule is a check on the whole request, so its `loc` is
`['body']` and the field is named in the message:

```
Invalid request (request.invalid) — One or more fields failed validation. — body: Value error, sort: unknown field(s) 'published_at' for `person` — ask `GET /v1/sorts/person` for the accepted set
```

`err.fieldErrors` carries the same entry. The document categories keep their
own sort names, which the server passes to the retrieval engine to check: a
refused field still comes back as a `422`, but in the engine's own words,
without field paths.

## The rules

- **Not with `category: 'auto'`.** The sortable fields differ per category, so
  a sort cannot be checked against an auto-classified one; the server refuses
  the combination with a 422. A search with no `category` sorts `company`.
- **One to three clauses, no field twice, `asc` or `desc`.** The server enforces
  these and names the clause; the SDK checks only that `sort` is a list of
  clauses that each name a field.
- **Not under `mode: 'deep'`**, which ignores ordering; the SDK refuses it
  there ([Quickstart](quickstart.md#choosing-a-mode)).

## Check what was applied

The response echoes the ordering actually applied as `resolved_search.sort` —
empty when the engine chose the order itself:

```ts
const page = await client.search({
  query: 'payments companies in Germany',
  category: 'company',
  sort: [{ field: 'employee_count', direction: 'desc' }],
});
console.log(page.resolved_search?.sort);
```

## Sorting and pagination

A sort is part of the request the cursor is signed against, so later pages keep
the same order without being asked again — and changing the sort between pages
is a `pagination.cursor_invalid`. See [Pagination](pagination.md).

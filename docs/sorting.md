# Sorting

Without `sort`, the engine orders the results itself. `sort` replaces that with
one to three clauses, strongest key first:

```ts
await client.search({
  category: 'company',
  filters: { industry: { include: ['Software & Technology'] } },
  sort: [{ field: 'revenue', direction: 'desc' }, { field: 'account_name', direction: 'asc' }],
});
```

## Relevance and sorting are alternatives

A sorted search is ordered by the field, not by relevance. "The 25 largest
matches" is a different question from "the 25 best matches", and a sort on a
sparsely filled field can bring thin records to the top. Sort on what you are
actually ordering by.

## What each category can sort on

`client.sorts(category)` lists the fields a category's search can be ordered
by. It is free.

```ts
const catalogue = await client.sorts('person');
for (const option of catalogue.sorts) {
  console.log(option.field, option.label, option.kind, option.directions, option.default_direction, option.direction_labels);
}
```

`direction_labels` says what each direction means for that field.

Company and person searches take the `SortClause` fields, and the SDK checks
them before sending: a field that orders only the other category (`revenue` on
a person search, `tenure` on a company search) is refused with a
`ClientValidationError`. Each document category takes its own sort type (for
example `FundingSort`, with `announced_date`, `funding_size` and
`created_at`), checked the same way.

## The rules

The SDK refuses these before sending:

- More than three clauses, an empty list, or the same field twice.
- A direction other than `asc` or `desc`.
- `sort` with `category: 'auto'`: the sortable fields differ per category.
- `sort` on a `deep` search, which works the whole question out of `query`.

## Check what was applied

The answer reports the ordering applied in `resolved_search.sort`:

```ts
const page = await client.search({
  query: 'payments companies in Germany',
  category: 'company',
  sort: [{ field: 'employee_count', direction: 'desc' }],
});
console.log(page.resolved_search?.sort);
```

## Sorting and pagination

A sort is part of the request a cursor is signed against, so later pages keep
the same order, and changing the sort between pages throws
`CursorInvalidError`. See [Pagination](pagination.md).

# Pagination

Results are cursor-paginated. `next_cursor` is **opaque and signed** — there is
no page number or offset — and `has_more === (next_cursor !== null)`.

## Iterate across pages

```ts
for await (const page of client.searchPages({ query: 'fintech', limit: 100 })) {
  process(page.results);
}

for await (const page of client.similarPages({ anchors: [{ value: 'acme.com' }] })) {
  process(page.results);
}
```

The same pattern works everywhere a cursor exists:
`client.relationships.findPages` / `.reachPages` / `.askPages`,
`client.history.listPages`, and `client.runs.resultsPages(runId, …)`.

Every iterator takes paging options as its second argument:

```ts
for await (const page of client.searchPages(
  { query: 'fintech', limit: 10 }, // the first page's size
  { limit: 100, maxResults: 500 }, // later pages' size; stop after 500 rows
)) {
  process(page.results);
}
```

`maxResults` stops once that many rows have been yielded — the last page is cut
to fit — without fetching a page nobody reads. Per-call options (`timeoutMs`,
`headers`, `signal`, `maxRetries`) go in the same object and apply to every
page. `requestId` (or a raw `X-Request-Id` header) is the exception: it goes
with the first page only, because every request needs its own id. Each page is
a call of its own, with its own generated `Idempotency-Key`, and is charged
only for the results it adds.

## One page at a time

```ts
let cursor: string | undefined;
do {
  const page = await client.search({ query: 'fintech', limit: 100, cursor });
  process(page.results);
  cursor = page.next_cursor ?? undefined;
} while (cursor);
```

## What the server enforces

1. **Do not change the request mid-pagination.** A cursor is signed against a
   fingerprint of every parameter except `cursor` and `limit`; a page whose
   other parameters changed gets `422 pagination.cursor_invalid`
   (`CursorInvalidError`) rather than silently reshuffled results. The `*Pages`
   iterators take a deep copy of `params` before the first request and re-send
   that copy, so editing your own object (or its nested `filters`)
   mid-iteration cannot break the next page. `limit` is the one field you may
   change — through the iterator's `limit` option.
2. **Cursors expire.** A stale one is `pagination.cursor_expired`
   (`CursorExpiredError`): restart from page one.
3. **Paging stops at 10,000 rows.** The iterators stop at the cap with one
   process warning (`SPROUTSDATA_DEPTH_CAP`) instead of asking for a page the
   server would refuse; following cursors by hand past it raises
   `PaginationDepthExceededError`. Narrow the search to reach the rest.
4. **A search is charged for the results it delivers**, across all its pages:
   page size does not change the total, and sending a cursor you already used
   again costs nothing. A Basic search that delivers 500 results costs
   0.5 + 490 × 0.08 = 39.7 credits. Set `maxResults` to what you will actually
   read.

A `sort` is part of the signed request, so page 2 keeps page 1's order without
being asked again.

## Truncated results

If the corpus stops issuing cursors before `total` is reached, the response
says so: `degradation[]` holds reason `pagination_truncated`, the SDK sets the
page's `truncated` to `true`, and the iterators warn once
(`SPROUTSDATA_TRUNCATED`). `has_more: false` then does **not** mean you have
everything.

## What does not page like a search

- **`mode: 'deep'`** returns a single page with no cursor; `searchPages`
  yields exactly one.
- **`filterValues` / `documentFilterValues`** use plain page numbers with a
  fixed page size of 20. Loop `page + 1` while `has_more`, or let
  `iterFilterValues` / `iterDocumentFilterValues` walk the pages and yield each
  value.
- **`relationships.institutions` and the org-chart routes** are single
  aggregations with nothing to page; branch on `truncated` for institutions.
- **`relationships.askPages`** follows whichever slot of the answer is
  populated; a `compare` or `fan_out` answer has no cursor, so it yields once.
- **`feedback.list`** is offset-paginated: loop with `offset += limit` while
  `offset + results.length < total`.
- **Entity lookups** are not paginated: one hit per requested id.

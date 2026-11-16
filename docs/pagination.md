# Pagination

Searches, look-alikes and every list the API keeps page by cursor.
`next_cursor` is opaque and signed; there is no page number or offset. A search
answer has `has_more` exactly when `next_cursor` is set.

## Walk every row

Each paged call has an `iter*` form that follows the cursors for you and yields
rows, not pages:

```ts
for await (const hit of client.iterSearch({ query: 'fintech companies in Germany', limit: 50, maxResults: 200 })) {
  console.log(hit.id, hit['account_name']);
}

for await (const hit of client.iterSimilar({ anchors: ['acme.com'], maxResults: 100 })) {
  console.log(hit.id);
}
```

| One page | Every row |
|---|---|
| `search` | `iterSearch` |
| `similar` | `iterSimilar` |
| `relationships.find` | `relationships.iterFind` |
| `relationships.reach` | `relationships.iterReach` |
| `lists.items` | `lists.iterItems` |
| `history.list` | `history.iterList` |
| `credits.transactions` | `credits.iterTransactions` |
| `feedback.list` | `feedback.iterList` |
| `runs.list` | `runs.iterList` |
| `runs.results` | `runs.iterResults` |
| `filterValues` | `iterFilterValues` |
| `documentFilterValues` | `iterDocumentFilterValues` |

`maxResults` stops the walk after that many rows. The first page asks for no
more rows than are wanted, the last page only for the rows still wanted, and no
page is fetched that nobody reads: stopping a walk early (with `maxResults`, or
by breaking out of the loop) fetches, and pays for, no further page.
`maxResults` must be a whole number of at least 1; leave it out for every row.

Per-call options go in the second argument and apply to every page (`signal`,
`timeoutMs`, `maxRetries`, `onResponse`). `requestId` is the exception: it is
sent with the first page only, because every request needs its own id.

A walk over a search is one search session, billed as a search is: page 1
costs the price list's base, and each later page only the rows it adds beyond
what that base covers. See [Quickstart](quickstart.md#how-searches-are-billed).

## One page at a time

```ts
let cursor: string | undefined;
do {
  const page = await client.search({ query: 'fintech companies in Germany', limit: 50, cursor });
  for (const hit of page.results) console.log(hit.id);
  cursor = page.next_cursor ?? undefined;
} while (cursor !== undefined);
```

## What the server enforces

1. **Send a cursor with the same arguments.** A cursor is signed against the
   request that produced it. A page sent with different arguments throws
   `CursorInvalidError`. `limit` may change between pages, except on
   `relationships.reach`, whose cursor binds the page size too. The `iter*`
   walks keep a deep copy of the first request and resend it, so changing your
   own object (or its nested `filters`) during a walk cannot break the next
   page.
2. **A cursor expires after 24 hours.** An expired one throws
   `CursorExpiredError`: start again from page 1, which opens a new session.
3. **Paging stops at 10,000 results.** A walk that would go past them throws
   `PaginationDepthExceededError` before asking for that page. Narrow the
   request to reach the rest.
4. **A short page is not the last page.** Rows can be removed after a page is
   cut (Do-Not-Contact rules, for example), so the walks go on while
   `next_cursor` is set, whatever the page's size. Do the same in your own
   loops.

A `sort` is part of the signed request, so later pages keep page 1's order.

## Truncated results

When the server stops issuing cursors before the results run out, it says so:
the answer's `degradation` holds a `pagination_truncated` entry while
`has_more` is false. `has_more: false` then does not mean you have every row.

```ts
const page = await client.search({ query: 'fintech companies in Germany', limit: 100 });
const truncated = !page.has_more && page.degradation.some((d) => d.reason === 'pagination_truncated');
if (truncated) console.warn('The server stopped paging early; narrow the search to see the rest.');
```

## What does not page like a search

- **`mode: 'deep'`** returns one page and has no cursor. The SDK refuses a
  `cursor` on a deep search.
- **`relationships.reach`** binds its page size to its cursor: every later page
  must ask for page 1's `limit`. `iterReach` does this for you and trims the
  last page locally to `maxResults`.
- **`relationships.ask`** pages when its answer is a `relationships` or `reach`
  answer: send its `next_cursor` back to `ask` with the same `query`.
- **`filterValues` and `documentFilterValues`** page by number, 20 values a
  page, while `has_more` is true. The `iter*` forms yield each value.
- **`relationships.institutions`, the org chart calls and entity lookups**
  answer in one response, with nothing to page.

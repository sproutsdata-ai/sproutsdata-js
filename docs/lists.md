# Saved lists and export

`client.lists` keeps named sets of records — accounts to work, people to reach —
and `client.searchExport()` turns chosen records into a CSV file. Every call is
free, and needs a key with `dsp.search.read` or `dsp.entities.read`.

```ts
const saved = await client.lists.create('Fintech targets');

await client.lists.addItems(saved.id, [
  { entity_category: 'company', entity_id: 'stripe.com' },
  { entity_category: 'company', entity_id: 'adyen.com' },
]);

for await (const item of client.lists.iterItems(saved.id)) {
  console.log(item.entity_id, item.record);
}
```

A list belongs to the workspace, not to one key: every key and every dashboard
user of the workspace sees the same lists. `created_by` and `added_by` name the
dashboard user who acted, and are `null` when an API key did.

## Name records by their natural id

An item is `{ entity_category, entity_id }`, where the id is the one the record
is known by:

| Category | `entity_id` |
|---|---|
| `company` | the domain — `stripe.com` |
| `person` | the LinkedIn URL |
| `patent` | the patent number |
| `academic_report` | the DOI |
| `trend` | the trend name |
| other documents | the id their `client.entities` lookup takes |

**Not a search hit's `id`.** For people and documents that is a one-way hash that
cannot be read back later, so an item saved by it would never resolve; use
`lookupRef(hit)` for a company or person. The SDK refuses an item without
`entity_category` and `entity_id`.

The server normalises the id on the way in — a domain is lower-cased and stripped
of scheme and `www.`, a LinkedIn URL reduced to `linkedin.com/in/<slug>` — so the
same record saved under two spellings is one item.

## Adding and removing

```ts
const added = await client.lists.addItems(saved.id, items); // at most 500 per call
added.added; added.already_present; added.suppressed;

const removed = await client.lists.removeItems(saved.id, items);
removed.removed;
```

Adding is idempotent: a record the list already holds is counted in
`already_present`, not added twice, so the SDK retries it like a read. Records on
the Do-Not-Contact list are refused and counted in `suppressed`; they are never
stored or returned. Removing a record the list does not hold is not an error.

A free workspace has a cap on distinct saved records across all its lists
(`(await client.lists.list()).saved_items_cap`; `null` means no cap). Going over
throws a `ConflictError` with code `lists.item_cap_reached` — nothing was added —
and `err.problem.extra` says how many fit:

```ts
import { ConflictError } from 'sproutsdata';

try {
  await client.lists.addItems(saved.id, items);
} catch (err) {
  if (err instanceof ConflictError && err.code === 'lists.item_cap_reached') {
    const { cap, saved: already, adding } = err.problem?.extra ?? {};
    console.log(cap, already, adding);
  } else {
    throw err;
  }
}
```

A record already saved in another list does not count against the cap again.

## Reading items

`items()` reads one page, newest first, each record fresh from the index;
`iterItems()` follows the cursor through every page.

```ts
const page = await client.lists.items(saved.id, { limit: 50 }); // default 25, at most 100
page.next_cursor; // null on the last page
page.field_tier;  // 'free' or 'unlocked'
```

A free workspace sees the fields a result card shows (`field_tier: 'free'`); one
that has bought credits sees the full record (`'unlocked'`). An item whose
record cannot be read right now is still returned, with `available: false` and
`unavailable_reason` — `not_found` or `retrieval_unavailable`.

## Managing lists

```ts
await client.lists.list();                         // every list, newest first, with the cap
await client.lists.rename(saved.id, 'Fintech, EU');
await client.lists.delete(saved.id);               // the list and its items
```

A list that does not exist, was deleted, or belongs to another workspace throws
`NotFoundError` (`lists.not_found`) — one answer for all three, on purpose.

Creating and deleting are not repeated after a failure that may have reached the
server: a repeat would make a second list, or answer `lists.not_found` for a list
the first call deleted. Check `client.lists.list()` before trying again.

## CSV export

```ts
const fromList = await client.lists.export(saved.id); // at most 1,000 rows
const fromSearch = await client.searchExport({
  items: [{ entity_category: 'company', entity_id: 'stripe.com' }], // at most 1,000
  request_id: page.meta.request_id, // optional: the search they came from
});

await writeFile(fromList.filename ?? 'export.csv', fromList.content);
```

A `CsvExport` carries the file (`content` as bytes, or `text()`), the server's
suggested `filename`, the `field_tier` of its rows, `row_count`, `skipped`
(records that could not be read) and `credits_charged` (exports are free). The
columns are `entity_category`, `entity_id`, then each record field as a dotted
path.

**Export is switched off until export pricing ships.** Until then both calls
throw `NotFoundError` with code `export.not_enabled`, which is never retried.
Because an export will be priced through the same meter as a search, it is
retried like a billed call: it carries an `Idempotency-Key`, and an answer lost
after sending is thrown rather than repeated.

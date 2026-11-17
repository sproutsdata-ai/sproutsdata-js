# Saved lists and export

`client.lists` keeps named sets of records (accounts to work, people to reach),
and `client.searchExport` turns rows of a search into a CSV file. Lists and
exports are free, and need a key with `dsp.search.read` or `dsp.entities.read`.

```ts
const saved = await client.lists.create({ name: 'Fintech targets', entity_category: 'company' });

await client.lists.addItems(saved.id, {
  items: [
    { entity_category: 'company', entity_id: 'stripe.com' },
    { entity_category: 'company', entity_id: 'adyen.com' },
  ],
});

for await (const item of client.lists.iterItems(saved.id)) {
  console.log(item.entity_id, item.available, item.record);
}
```

A list belongs to the workspace, not to one key: every key and every user of
the workspace sees the same lists. `created_by` and `added_by` are strings
naming who acted (`"user:1"`), or `null`.

## Names are unique

A list's name is 1 to 120 characters and unique in the workspace, ignoring
case. Creating or renaming a list to a name the workspace already uses throws
`ListNameTakenError` (409), a subclass of `ConflictError`:

```ts
import { ListNameTakenError } from 'sproutsdata';

try {
  await client.lists.create({ name: 'Fintech targets' });
} catch (err) {
  if (!(err instanceof ListNameTakenError)) throw err;
  const existing = (await client.lists.list()).lists.find((list) => list.name.toLowerCase() === 'fintech targets');
  console.log('Already there:', existing?.id);
}
```

`entity_category` is optional. A list holds one kind of record, fixed when it
is created or by its first add; adding a record of another kind throws
`InvalidRequestError` (`lists.category_mismatch`).

## Items

An item is `{ entity_category, entity_id }`. Use the id a lookup takes for that
record: `lookupRef(hit)` gives it for a search row (a company's domain, a
person's LinkedIn URL, a document's `d1_...` id). A person row's `id` is a hash
that no lookup resolves, so do not save it.

```ts
import { lookupRef } from 'sproutsdata';

const page = await client.search({ query: 'payments companies in Germany', limit: 25 });
const items = page.results.flatMap((hit) => {
  const ref = lookupRef(hit);
  return ref === undefined ? [] : [{ entity_category: 'company' as const, entity_id: ref.value }];
});

const list = await client.lists.create({ name: `Payments DE ${Date.now()}`, entity_category: 'company' });
const added = await client.lists.addItems(list.id, { items });
console.log(added.added, added.already_present, added.suppressed, added.not_found);

const removed = await client.lists.removeItems(list.id, { items: items.slice(0, 1) });
console.log(removed.removed);
```

- `addItems` and `removeItems` take 1 to 1,000 items per request. The SDK
  checks this before sending; split a larger set into several requests.
- A record the list already holds is counted in `already_present`, not added
  twice. Records on the Do-Not-Contact list are refused and counted in
  `suppressed`. Records that could not be found are counted in `not_found`.
- Removing a record the list does not hold is not an error.
- Going over a size limit (lists per workspace, items per list, or a free
  workspace's saved-items cap) throws `ConflictError` with code
  `lists.item_cap_reached`, and nothing is added.
  `(await client.lists.list()).saved_items_cap` is the workspace's cap, or
  `null` for none.

## Reading items

`items` reads one page, newest first; `iterItems` follows the cursor through
every page.

```ts
const lists = await client.lists.list();
const first = lists.lists[0];
if (first !== undefined) {
  const page = await client.lists.items(first.id, { limit: 50 }); // 1 to 100
  console.log(page.saved_list.name, page.field_tier, page.next_cursor);
  for (const item of page.items) {
    if (!item.available) console.log(item.entity_id, item.unavailable_reason);
  }
}
```

An item whose record cannot be read right now is still returned, with
`available: false` and an `unavailable_reason` (`not_found` or
`retrieval_unavailable`).

## Managing lists

```ts
const lists = await client.lists.list(); // every list, with the saved-items count and cap
for (const list of lists.lists) console.log(list.id, list.name, list.item_count);

const saved = await client.lists.create({ name: 'Fintech, EU' });
await client.lists.rename(saved.id, { name: 'Fintech, Europe' });
await client.lists.delete(saved.id); // the list and its items
```

A list that does not exist, was deleted, or belongs to another workspace throws
`NotFoundError` (`lists.not_found`).

`create` and `delete` are never repeated after a failure that may have reached
the server: a repeat would make a second list (409), or answer 404 for the list
the first call deleted. Check `client.lists.list()` before trying again.

## CSV export

`lists.export` and `searchExport` answer in one of two ways:

- `{ kind: 'file', csv }`: the CSV text at once, for a small export;
- `{ kind: 'job', job }`: an export job for a larger one. Wait for it with
  `client.exports.wait(job.job_id)`, then fetch the file with
  `client.exports.download(job.job_id)`.

```ts
import { writeFile } from 'node:fs/promises';
import type { ExportResult, SproutsData } from 'sproutsdata';

async function csvOf(client: SproutsData, result: ExportResult): Promise<string> {
  if (result.kind === 'file') return result.csv;
  const job = await client.exports.wait(result.job.job_id);
  return client.exports.download(job.job_id);
}

const lists = await client.lists.list();
const first = lists.lists[0];
if (first !== undefined) {
  await writeFile('list.csv', await csvOf(client, await client.lists.export(first.id)));

  // Only some rows of the list, newest first
  await writeFile('latest.csv', await csvOf(client, await client.lists.export(first.id, { offset: 0, limit: 100 })));
}
```

`searchExport` takes the rows to export (up to 50,000) and, optionally, the
`request_id` of the search they came from:

```ts
import type { ItemRef } from 'sproutsdata';

const page = await client.search({ query: 'payments companies in Germany', limit: 50 });
const items: ItemRef[] = page.results.map((hit) => ({ entity_category: 'company', entity_id: hit.id }));
const result = await client.searchExport({ items, request_id: page.meta.request_id });
if (result.kind === 'file') console.log(result.csv.split('\n').length - 1, 'rows');
else console.log('export job', result.job.job_id, result.job.status);
```

### Export jobs

- `exports.retrieve(jobId)` reads a job as it stands: `status` (`queued`,
  `running`, `done`, `failed`), `rows`, `skipped`, `error`, `expires_at`.
- `exports.wait(jobId, { pollIntervalMs, maxWaitMs })` polls until the job is
  `done` and returns it. A failed job throws `ExportFailedError`, with the job
  on `err.job`. A job still running when `maxWaitMs` runs out throws
  `WaitTimeoutError`, with the last state on `err.last`; the job goes on
  server-side, so call `exports.wait` again. `maxWaitMs: null` waits for as
  long as it takes.
- `exports.download(jobId)` returns the finished file as CSV text, with the
  byte-order mark removed. A file is kept for 24 hours; after that, or for an
  unknown job, it throws `NotFoundError` (`export.not_found`).

An export job reads the list when it runs, not when it was started. An export
with more rows than one export may hold throws `InvalidRequestError`
(`export.too_large`): export a narrower range with `offset` and `limit`.

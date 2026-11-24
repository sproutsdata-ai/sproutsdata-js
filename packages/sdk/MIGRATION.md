# Migrating from sproutsdata 0.0.1

This guide is for applications written against the published `sproutsdata@0.0.1`. The SDK
now runs on a new version of the Sprouts Data API, and several calls were renamed, removed or
reshaped on the way. Each section below shows the 0.0.1 code first and the current code after
it.

A quick way to find what needs changing is to upgrade and run the TypeScript compiler: almost
every change below is a type error. The few that are not (a default that changed, a value that
is now a string) are marked **Behaviour change**.

## Contents

- [Requirements](#requirements)
- [The client](#the-client)
- [Paging through results](#paging-through-results)
- [Search and look-alikes](#search-and-look-alikes)
- [Entity lookups](#entity-lookups)
- [Credits](#credits)
- [Members](#members)
- [Exports](#exports)
- [Saved lists](#saved-lists)
- [Org charts](#org-charts)
- [Usage history](#usage-history)
- [Feedback](#feedback)
- [Relationships](#relationships)
- [Agent runs](#agent-runs)
- [Errors](#errors)
- [Removed value exports](#removed-value-exports)
- [Renamed types](#renamed-types)
- [Tools and adapters](#tools-and-adapters)

## Requirements

Node.js 22.12.0 or later (0.0.1 needed 18). The package still ships both ESM and CommonJS.

## The client

### No browser mode

0.0.1 refused to run in a browser unless you passed `dangerouslyAllowBrowser: true`. That
option is gone. The client now throws `ClientValidationError` whenever it is constructed in a
browser, and the API refuses any request that carries an API key together with an `Origin`
header. An API key is a server-side secret: call the API from your own server and send your
front end only the data it needs.

<!-- snippet: skip -->
```ts
// 0.0.1
const client = new SproutsData({ apiKey, dangerouslyAllowBrowser: true });
```

```ts
// Now: on your server only.
import { SproutsData } from 'sproutsdata';

const client = new SproutsData(); // reads SPROUTSDATA_API_KEY
```

`defaultHeaders` still refuses `Origin` and `Referer`, for the same reason.

### No `integration` option

The `integration` option, the `client.integration` getter and the `X-SproutsData-Client` header
they set are gone. The SDK no longer sends that header. Every request carries a `User-Agent` of
the form `sproutsdata-js/<version> (<runtime>/<version>; <os>)`.

<!-- snippet: skip -->
```ts
// 0.0.1
const client = new SproutsData({ integration: 'my-app/1.2.0' });
```

```ts
// Now
import { SproutsData } from 'sproutsdata';

const client = new SproutsData();
```

### No `withOptions`

`client.withOptions(...)` is gone. Set `timeoutMs` and `maxRetries` per call instead, through
the options argument every method takes, or build a second client.

<!-- snippet: skip -->
```ts
// 0.0.1
await client.withOptions({ maxRetries: 0, timeoutMs: 120_000 }).search({ query: 'battery recycling startups' });
```

```ts
// Now
await client.search({ query: 'battery recycling startups' }, { maxRetries: 0, timeoutMs: 120_000 });
```

### Per-call options

The per-call options (`RequestOptions`) no longer take `headers`. They take `signal`,
`timeoutMs`, `maxRetries`, `requestId` (sent as `X-Request-Id`), `idempotencyKey` (for the
calls that send one), `lastEventId` (for an event stream) and `onResponse`.

`onResponse` is new, on the client and per call. It receives the status, the request id, the
response headers and the rate limit of every successful answer:

```ts
import { SproutsData } from 'sproutsdata';

const client = new SproutsData({
  onResponse: (meta) => console.log(meta.status, meta.requestId, meta.rateLimit.remaining),
});
```

### No default export

<!-- snippet: skip -->
```ts
// 0.0.1
import SproutsData from 'sproutsdata';
```

```ts
// Now
import { SproutsData } from 'sproutsdata';
```

## Paging through results

The `*Pages` iterators, which yielded whole pages, are replaced by `iter*` iterators, which
yield rows. `maxResults` moves into the parameters, and the per-call options become the second
argument.

| 0.0.1 | Now |
|---|---|
| `client.searchPages(params, options)` | `client.iterSearch({ ...params, maxResults }, options)` |
| `client.similarPages(params, options)` | `client.iterSimilar({ ...params, maxResults }, options)` |
| `client.history.listPages(params, options)` | `client.history.iterList({ ...params, maxResults }, options)` |
| `client.runs.resultsPages(runId, params, options)` | `client.runs.iterResults(runId, { ...params, maxResults }, options)` |
| `client.relationships.findPages(params, options)` | `client.relationships.iterFind({ ...params, maxResults }, options)` |
| `client.relationships.reachPages(params, options)` | `client.relationships.iterReach({ ...params, maxResults }, options)` |
| `client.relationships.askPages(params, options)` | Removed: send `ask`'s `next_cursor` back to `ask` with the same `query` |

<!-- snippet: skip -->
```ts
// 0.0.1
for await (const page of client.searchPages({ query: 'payments companies in Germany' }, { maxResults: 50 })) {
  for (const hit of page.results) console.log(hit.id);
}
```

```ts
// Now
for await (const hit of client.iterSearch({ query: 'payments companies in Germany', maxResults: 50 })) {
  console.log(hit.id);
}
```

When you need each page as a whole (its `total`, `degradation` or `meta`), call `search` and
follow `next_cursor` yourself, sending the same parameters each time:

```ts
let cursor: string | undefined;
do {
  const page = await client.search({ query: 'payments companies in Germany', ...(cursor === undefined ? {} : { cursor }) });
  console.log(page.total, page.results.length, page.meta.credits_charged);
  cursor = page.next_cursor ?? undefined;
} while (cursor !== undefined);
```

The old `PageOptions` (the per-call options plus `limit` and `maxResults`) is now
`{ maxResults }` alone. 0.0.1 let a walk change its page size from page 2 on; now, with
`maxResults`, only the last page asks for fewer rows.

The SDK-set `truncated` flag on search answers is gone. Look for a `pagination_truncated` entry
in `degradation` instead.

## Search and look-alikes

`search` and `similar` keep their names and most of their parameters. What changed:

- **Behaviour change:** the SDK now checks a request against the API's own request models
  before sending it: unknown fields, values out of range, closed vocabularies and the
  cross-field rules (for example `query` with `keyword_query`). A request the server would refuse
  throws `ClientValidationError` and nothing is sent.
- `category: 'auto'` takes only `query`, `mode`, `limit` and `cursor`, and `auto` is its only
  mode. The 0.0.1 docs asked for `mode: 'auto'` beside it; now you may leave `mode` out.
- An anchor for `similar` may be a bare domain string: `anchors: ['adyen.com']`.
- Each document category's `filters` and `sort` are typed for that category.

## Entity lookups

### `by` defaults to `auto`

**Behaviour change.** In 0.0.1, `entities.companies` and `entities.persons` read `ids` as
record ids unless `by` was set. Now `by` defaults to `auto`, which classifies each value as a
domain, a LinkedIn URL or a name. Pass `by: null` to send record ids.

<!-- snippet: skip -->
```ts
// 0.0.1: record ids by default
await client.entities.companies({ ids: ['<record-id>'] });
```

```ts
// Now
await client.entities.companies({ ids: ['adyen.com', 'linkedin.com/company/stripe'] }); // by: 'auto'
await client.entities.companies({ ids: ['<record-id>'], by: null }); // record ids
```

### Named documents default to the name

**Behaviour change.** In 0.0.1 the SDK sent `by: 'id'` to `news`, `marketReports`, `fundings`
and `jobOpenings` unless you passed `by: 'name'`. Now it sends no `by` unless you pass one, so
the server's default applies: a headline, a report title, the raising company's name or a job
role. To look these up by id, pass `by: 'id'`.

<!-- snippet: skip -->
```ts
// 0.0.1: ids by default
await client.entities.news({ ids: ['<news-id>'] });
```

```ts
// Now
await client.entities.news({ ids: ['<news-id>'], by: 'id' });
await client.entities.fundings({ ids: ['stripe'] }); // by the raising company's name
```

### `fields` on companies and people

`fields` on `entities.companies` and `entities.persons` is now applied by the SDK: the server
returns full records, and the SDK keeps only the fields you name (and each record's `id`).
Document lookups still send `fields` to the server.

### Reading matches

A lookup row's `matches` is now typed as plain objects. `recordsOf(hit)` reads them as the
category's record types. Two new helpers find rows: `entityHit(answer, value)` returns the row
for one value as it was sent, and `missingValues(answer)` lists the values that matched
nothing. Rows are no longer in the order sent: found values come first.

<!-- snippet: skip -->
```ts
// 0.0.1
const answer = await client.entities.companies({ ids: ['adyen.com'], by: 'domain' });
console.log(answer.results[0]?.matches[0]?.account_name);
```

```ts
// Now
import { entityHit, missingValues, recordsOf } from 'sproutsdata';

const answer = await client.entities.companies({ ids: ['adyen.com', 'no-such-company.example'] });
const hit = entityHit(answer, 'adyen.com');
for (const record of hit === undefined ? [] : recordsOf(hit)) console.log(record.id);
console.log('not found:', missingValues(answer));
```

### `lookupRef`

`lookupRef(hit)` now returns `undefined` (not `null`) when a row cannot be looked up, adds the
row's `category`, and also covers document rows, whose `d1_...` ids are lookup keys
(`by: 'id'` for news, market reports, funding rounds and job openings; no `by` for patents,
trends and academic reports).

<!-- snippet: skip -->
```ts
// 0.0.1
const ref = lookupRef(hit); // { by, value } | null
if (ref !== null) await client.entities.companies({ ids: [ref.value], by: ref.by });
```

```ts
// Now
import { lookupRef } from 'sproutsdata';

const page = await client.search({ query: 'payments companies in Germany' });
const first = page.results[0];
const ref = first === undefined ? undefined : lookupRef(first); // { category, by, value } | undefined
if (ref !== undefined && ref.category === 'company') {
  await client.entities.companies({ ids: [ref.value] });
}
```

## Credits

The credits answer has a new shape, and `credits.usage()` is gone.

| 0.0.1 | Now |
|---|---|
| `credits.retrieve()` returning `platform`, `scope`, `allocated`, `shared`, `spendable`, `as_of` | `credits.retrieve()` returning `balance`, `reserved`, `available`, `debt`, `status`, `has_paid`, `rate_card`, `stale` |
| `spendable` | `available` (the balance, less what is reserved and any debt); `canAfford(balance, n)` compares with it |
| `allocated.expires_at` | No equivalent: credits have no fixed expiry |
| `credits.usage({ granularity, from, to })` (this key's spend) | `credits.transactions()` / `iterTransactions()` for the ledger; `history.list()` and `history.metrics()` for calls and daily totals |

<!-- snippet: skip -->
```ts
// 0.0.1
const balance = await client.credits.retrieve();
if (balance.spendable >= 10) { /* ... */ }
const usage = await client.credits.usage({ granularity: 'day' });
console.log(usage.total_credits);
```

```ts
// Now
import { canAfford } from 'sproutsdata';

const balance = await client.credits.retrieve();
if (balance.status === 'frozen') console.warn('The wallet is frozen: contact Sprouts support.');
if (canAfford(balance, 10)) {
  // ...
}

for await (const row of client.credits.iterTransactions({ maxResults: 20 })) {
  console.log(row.created_at, row.kind, row.credits, row.balance_after, row.action ?? row.source);
}
```

A ledger row's `credits` is signed: negative for a charge, positive for a grant.

A billed call on a frozen wallet throws `WalletFrozenError`, a subclass of
`InsufficientCreditsError`.

## Members

`client.members.resolve(email)` and its types (`MemberResolveResponse`, `MemberState`) are
removed. The SDK has no replacement.

## Exports

`searchExport` and `lists.export` used to return a `CsvExport` (`content`, `text()`,
`filename`, `field_tier`, `row_count`, `skipped`, `credits_charged`, `request_id`). They now
return an `ExportResult`, tagged by `kind`:

- `{ kind: 'file', csv }`: the CSV text, at once;
- `{ kind: 'job', job }`: a larger export runs as a job. Wait for it with
  `exports.wait(job.job_id)`, then fetch the file with `exports.download(job.job_id)`.

<!-- snippet: skip -->
```ts
// 0.0.1
const file = await client.lists.export(listId);
await writeFile(file.filename ?? 'list.csv', file.content);
```

```ts
// Now
import { writeFile } from 'node:fs/promises';

declare const listId: string;

const result = await client.lists.export(listId);
let csv: string;
if (result.kind === 'file') {
  csv = result.csv;
} else {
  const job = await client.exports.wait(result.job.job_id);
  console.log(`${String(job.rows)} rows`);
  csv = await client.exports.download(job.job_id);
}
await writeFile('list.csv', csv);
```

What else changed:

- `exports.retrieve(jobId)` reads a job as it stands (`status` is `queued`, `running`, `done`
  or `failed`). `exports.wait(jobId, { pollIntervalMs, maxWaitMs }, options)` polls it until it
  is `done`; a failed job throws `ExportFailedError` (`error.job` is its last state), and a
  wait that runs out throws `WaitTimeoutError` (`error.last`). The job goes on server-side
  either way.
- `exports.download(jobId)` returns the CSV as a string, with the byte-order mark removed.
- `lists.export(listId, { offset, limit })` exports part of a list, newest rows first.
- `searchExport` takes up to 50,000 rows (0.0.1: 1,000).
- Exports are free.

## Saved lists

The list calls now take objects, names are unique, and item batches are capped.

| 0.0.1 | Now |
|---|---|
| `lists.create(name)` | `lists.create({ name, entity_category? })` |
| `lists.rename(listId, name)` | `lists.rename(listId, { name })` |
| `lists.addItems(listId, items)` | `lists.addItems(listId, { items })` |
| `lists.removeItems(listId, items)` | `lists.removeItems(listId, { items })` |
| `lists.iterItems(listId, { limit }, options)` | `lists.iterItems(listId, { limit, maxResults }, options)` |
| `lists.export(listId)` returning `CsvExport` | `lists.export(listId, { offset?, limit? })` returning `ExportResult` ([Exports](#exports)) |

<!-- snippet: skip -->
```ts
// 0.0.1
const list = await client.lists.create('Target accounts');
await client.lists.addItems(list.id, [{ entity_category: 'company', entity_id: 'adyen.com' }]);
```

```ts
// Now
import { ListNameTakenError } from 'sproutsdata';

try {
  const list = await client.lists.create({ name: 'Target accounts', entity_category: 'company' });
  const added = await client.lists.addItems(list.id, { items: [{ entity_category: 'company', entity_id: 'adyen.com' }] });
  console.log(added.added, added.already_present, added.not_found);
} catch (err) {
  if (err instanceof ListNameTakenError) console.warn('The workspace already has a list with that name.');
  else throw err;
}
```

- **Behaviour change:** list names are unique in the workspace. Creating or renaming to a
  name in use throws `ListNameTakenError`, a `ConflictError` (409 `lists.name_taken`).
- `addItems` and `removeItems` take up to 1,000 items per call, checked by the SDK before
  sending (0.0.1 left the limit to the server).
- `entity_category` on create fixes the one kind of record the list holds. Adding another
  kind throws `InvalidRequestError` (`lists.category_mismatch`).
- `addItems` also counts `not_found` (values that named no record).
- A list's `created_by` and an item's `added_by` are strings such as `"user:1"`.
- When the workspace's saved-items cap is reached, `addItems` throws `ConflictError`
  (`lists.item_cap_reached`). 0.0.1 read `cap`, `saved` and `adding` from the error; the API
  no longer sends them.

## Org charts

The org chart calls keep their names (`orgChart.retrieve`, `departments`, `locations`) and add
`orgChart.taxonomy()`, which is free. The people filters moved into a nested `filters` object,
and the answers changed shape.

### Request fields

The fields 0.0.1 took at the top level are refused now (`ClientValidationError`, nothing sent),
and the message names the replacement:

| 0.0.1 field | Now |
|---|---|
| `country` | `filters.locations.include.countries` |
| `state` | `filters.locations.include.states` |
| `city` | `filters.locations.include.cities` |
| `governance_level` | `filters.governance_levels` |
| `employment_type` | `filters.employment_types` |
| `has_direct_access_to_c_suite` | `filters.has_direct_access_to_c_suite` |
| `include_others` | `include_suspects` |
| `search` (on `locations`) | `filters.query`, a `{ text, field? }` people query |

`filters` also takes `job_titles` (up to 20), `locations.exclude`, and `departments` and
`seniorities` as taxonomy codes, which `orgChart.taxonomy()` lists with their labels. The grid
takes `metrics` (`new_joiners`, `job_openings`). Name the company with exactly one of `domain`,
`linkedin_url` or the new `company_ref`.

<!-- snippet: skip -->
```ts
// 0.0.1
const grid = await client.orgChart.retrieve({ domain: 'stripe.com', country: ['Germany'], include_others: true });
console.log(grid.departments, grid.department_totals['Engineering']);
```

```ts
// Now
const grid = await client.orgChart.retrieve({
  domain: 'stripe.com',
  filters: { locations: { include: { countries: ['Germany'] } } },
  include_suspects: true,
});
for (const row of grid.department_totals) console.log(row.code, row.label, row.count);
```

### Answers

- Axis values are `{ code, label }` objects. `department_totals` and `seniority_totals` are
  lists of `{ code, label, count }` (0.0.1: objects keyed by name), and each cell's
  `department` and `seniority` is a `{ code, label }`.
- The grid's `departments` and `seniorities` lists are gone; read the axes from the totals,
  or from `orgChart.taxonomy()`.
- `departments()` answers with `department_totals` and `subdepartments` (0.0.1: a
  `departments` tree).
- `locations()` answers with `countries`, each `{ value, count, children }` down to states and
  cities (0.0.1: `locations`, each `{ country, count, states }`).
- `company` now carries `company_ref` and `name`. New fields include `suspect_count`,
  `coverage`, `data_version` and `taxonomy_version`, and `departments()` and `locations()`
  now report a `total`.
- `UNKNOWN_LOCATION` is removed.

### Ambiguous companies

A domain or page that names several companies throws `OrgChartCompanyAmbiguousError`. Each of
its `candidates` carries a `company_ref`; call again with the one you mean:

```ts
import { OrgChartCompanyAmbiguousError } from 'sproutsdata';

try {
  await client.orgChart.retrieve({ domain: 'example.com' });
} catch (err) {
  if (!(err instanceof OrgChartCompanyAmbiguousError)) throw err;
  const choice = err.candidates[0];
  if (choice !== undefined) await client.orgChart.retrieve({ company_ref: choice.company_ref });
}
```

## Usage history

| 0.0.1 | Now |
|---|---|
| `history.list(params)` returning an envelope (`results`, `total`, `has_more`, `meta`, ...) | `history.list(params)` returning `{ results, next_cursor }` |
| `history.listPages(params, options)` | `history.iterList({ ...params, maxResults }, options)` |
| `history.retrieve(runId: number)` | `history.retrieve(id: string)`: pass a row's `id` as it is |
| `history.metrics({ from, to })` | Unchanged call; totals changed type (below) |
| `failureRate(metrics)` | Removed: compute `total_failed / (total_ok + total_failed)` yourself |

<!-- snippet: skip -->
```ts
// 0.0.1
const page = await client.history.list({ action_type: ['dsp.search.fast', 'dsp.search.auto'] });
const total = page.results.reduce((sum, row) => sum + row.credits_charged, 0);
const detail = await client.history.retrieve(page.results[0]!.id);
```

```ts
// Now
const page = await client.history.list({ action_type: 'dsp.search.fast', limit: 50 });
let total = 0;
for (const row of page.results) total += Number(row.credits_charged ?? '0');
const first = page.results[0];
if (first !== undefined) {
  const detail = await client.history.retrieve(first.id);
  console.log(detail.snapshot_state, total);
}
```

- **Behaviour change:** ids are digit strings, and credit amounts (`credits_charged`, and
  `credits` / `total_credits` in `metrics`) are decimal strings such as `"0.500"`, to keep
  them exact. `credits_charged` is `null` for a call that was not metered.
- `action_type` takes one action. A list throws `ClientValidationError`, because the server
  would read only the last one.
- `latency_ms` and `request` may be `null`.
- `snapshot_state` is `present`, `absent` or `continuation`. `snapshot_expires_at`,
  `resolved_search` and `meta` are no longer on a history row.
- History rows are written shortly after each call, so a call made a moment ago may not be
  listed yet.

## Feedback

### Reports

| 0.0.1 | Now |
|---|---|
| `feedback.create({ context: 'help', ... })` | Leave out `subject_ref`: a report with no subject is a help request |
| `feedback.create(...)` returning `FeedbackCreated` | Returns the report itself (`ReportView`) |
| `feedback.list({ status, tag, subject_kind, subject_id, limit, offset })` | `feedback.list({ limit, cursor })` returning `{ results, next_cursor }`; `feedback.iterList({ maxResults })` walks every page |
| A listed report's `subject_kind`, `subject_id`, `target_kind`, `target_entity_id`, `subject` | `subject_ref: { kind, id }` and `target: { kind, entity_id, entity_type }` |
| `feedback.tags()`: each tag's `applies_to` | Each tag's `level` |

`feedback.create` sends an `Idempotency-Key` (generated, or yours from
`options.idempotencyKey`), so a retry files the report once. A report on an answer from a
moment ago may throw `NotFoundError` (`feedback.subject_not_found`) until the server has
recorded that answer; report again shortly. `feedback.tags()` needs a key with
`dsp.search.read` or `dsp.usage.read`.

### Votes

`feedback.votes.cast` now requires `level`, which 0.0.1 inferred from `entity_id`, and
`feedback.votes.list` takes an object.

<!-- snippet: skip -->
```ts
// 0.0.1
await client.feedback.votes.cast({ request_id: requestId, vote: 'flag', entity_category: 'company', entity_id: 'adyen.com' });
const votes = await client.feedback.votes.list(requestId);
```

```ts
// Now
declare const requestId: string;

await client.feedback.votes.cast({ request_id: requestId, level: 'result_set', vote: 'like', entity_category: 'company' });
await client.feedback.votes.cast({ request_id: requestId, level: 'result', vote: 'flag', entity_category: 'company', entity_id: 'adyen.com' });
const votes = await client.feedback.votes.list({ request_id: requestId });
console.log(votes.votes.length);
```

A `result_set` takes `like` or `dislike`; a `result` takes only `flag`, with its `entity_id`.
The SDK checks both before sending.

## Relationships

`find`, `reach`, `institutions` and `ask` keep their names and parameters. The paging helpers
changed ([Paging through results](#paging-through-results)):

<!-- snippet: skip -->
```ts
// 0.0.1
for await (const page of client.relationships.reachPages(params, { maxResults: 30 })) {
  for (const row of page.results) console.log(row);
}
```

```ts
// Now
for await (const row of client.relationships.iterReach({
  person: { li_url: 'linkedin.com/in/example-person' },
  target_company: { value: 'stripe.com' },
  maxResults: 30,
})) {
  console.log(row);
}
```

- `reach` binds its cursor to the page size: page 2 must ask for page 1's `limit`.
  `iterReach` does this for you and trims the last page locally.
- `ask` has no iterator. A `relationships` or `reach` answer from `ask` pages: send its
  `next_cursor` back to `ask` with the same `query`. Read what an answer cost from
  `meta.credits_charged`.
- A reach target's `cid` is now `id`.
- A company or institution that matches nothing, or several, throws `InvalidRequestError`
  (`relationship.anchor_not_found`, `relationship.anchor_ambiguous`).

## Agent runs

| 0.0.1 | Now |
|---|---|
| `runs.create(params, { idempotencyKey })` | Unchanged; the options are the ordinary `RequestOptions` |
| `runs.list({ limit })` | `runs.list({ limit, cursor })`; `runs.iterList({ maxResults })` walks every page |
| `runs.resultsPages(runId, params, options)` | `runs.iterResults(runId, { ...params, maxResults }, options)` |
| `runs.events(runId, { lastEventId })` yielding `{ seq, type, data, raw }` | `runs.events(runId, { lastEventId })` yielding `{ id, event, data, raw }` |
| `TERMINAL_RUN_EVENTS` | Removed: the stream ends when the run's stream closes; read the outcome with `retrieve` or `wait` |
| `runs.wait(runId, { signal, timeoutMs, pollIntervalMs })` | `runs.wait(runId, { pollIntervalMs, maxWaitMs }, { signal })` |
| `RunWaitTimeoutError` (`run`, `timeoutMs`) | `WaitTimeoutError` (`last`, the last `RunResult` seen) |

<!-- snippet: skip -->
```ts
// 0.0.1
try {
  const run = await client.runs.wait(runId, { timeoutMs: 600_000 });
} catch (err) {
  if (err instanceof RunWaitTimeoutError) console.log(err.run.status);
}
```

```ts
// Now
import { WaitTimeoutError, type RunResult } from 'sproutsdata';

declare const runId: string;

try {
  const run = await client.runs.wait(runId, { maxWaitMs: 600_000 });
  console.log(run.status, run.credits_charged);
} catch (err) {
  if (!(err instanceof WaitTimeoutError)) throw err;
  const last = err.last as RunResult | undefined;
  console.log('still', last?.status);
}
```

`maxWaitMs: null` waits for as long as the run takes. A stream that breaks throws
`APIConnectionError` with `lastEventId`; pass it back as `options.lastEventId` to resume.
Runs need a key with the `dsp.agents.*` scopes, which a key made with the default scopes does
not have; without them `runs.create` throws `PermissionDeniedError`. A run result no longer
carries `effort`; `effort_ran` says which effort ran.

The effort tiers were renamed. The earlier names are still accepted (typed `LegacyEffort`)
and sent as the new ones; answers use the new ones:

| Earlier | Now |
|---|---|
| `minimal` | `quick` |
| `low` | `basic` |
| `medium` (the default) | `standard` (the default) |
| `high` | `detailed` |
| `xhigh` | `maximum` |

`mode: 'deep'` and `page.coverage` are gone: deep search is no longer offered. Start an agent
run (`runs.create`) to have an agent work a question out; a run still carries `coverage`.

## Errors

Removed classes and their replacements:

| 0.0.1 | Now |
|---|---|
| `RunWaitTimeoutError` | `WaitTimeoutError` (`last`), also thrown by `exports.wait` |
| `IdempotencyConflictError` | `ConflictError` |
| `RequestTooLargeError` (413) | `InvalidRequestError` |

New classes:

| Class | When |
|---|---|
| `WorkspaceRequiredError` | 403: the call needs a workspace (a subclass of `PermissionDeniedError`) |
| `WalletFrozenError` | 402 `credits.wallet_frozen` (a subclass of `InsufficientCreditsError`) |
| `ListNameTakenError` | 409 `lists.name_taken` (a subclass of `ConflictError`) |
| `OrgChartCompanyAmbiguousError` | 422 `org_chart.company_ambiguous`, with `candidates` (a subclass of `InvalidRequestError`) |
| `ExportFailedError` | An export job ended `failed`; `job` is its last state |
| `RedirectRefusedError` | The server answered with a redirect, which the SDK never follows |

Renamed and reshaped members:

| 0.0.1 | Now |
|---|---|
| `InsufficientCreditsError.available` | `availableCredits` |
| `InsufficientCreditsError.required` | `requiredCredits` |
| `InsufficientCreditsError.actionType` | Removed |
| `APIError.problem` | `extra` (the problem's `extra` object), `body` (the decoded body), `instance`, `type` |
| `APITimeoutError.lastEventId` | `lastEventId` is on `APIConnectionError`, which `APITimeoutError` extends |

`RateLimitError` now has `limit`, `window`, `operation` and `scope` getters. Every key failure
(missing, unknown, revoked, expired) is one `AuthenticationError` (401); a request carrying a
key and an `Origin` header also answers 401.

## Removed value exports

| 0.0.1 export | Now |
|---|---|
| `default` (the client) | `import { SproutsData } from 'sproutsdata'` |
| `ErrorCode` | Removed: compare `err.code` with the code strings |
| `DEFAULT_BASE_URL` | Removed: the default is `https://api.sproutsdata.ai` |
| `UNKNOWN_LOCATION` | Removed with the old org chart filters |
| `failureRate` | Removed ([Usage history](#usage-history)) |
| `TERMINAL_RUN_EVENTS` | Removed ([Agent runs](#agent-runs)) |
| `parseSseStream` | Removed: `runs.events` yields parsed events (`ServerSentEvent`) |
| `RunWaitTimeoutError`, `IdempotencyConflictError`, `RequestTooLargeError` | See [Errors](#errors) |

New value exports: `canAfford`, `entityHit`, `missingValues`, `recordsOf`, `totalFor` (a
category's total from a `coverage()` answer), and the new error classes.

## Renamed types

The type names now follow the API's own models. Where an old name has a clear replacement:

| 0.0.1 | Now |
|---|---|
| `SproutsDataOptions` | `ClientOptions` |
| `SproutsDataCopyOptions` | Removed with `withOptions` |
| `EntityCategory` | `SearchCategory` (a category to search), `ResultCategory` (a row's category) |
| `DiscoverSearchParams` | `EntitySearchParams`, and `AutoSearchParams` for `category: 'auto'` |
| `SimilarAnchor`, `SimilarAnchorBy`, `SimilarCombine` | `Anchor` (or `AnchorParam`, which also takes a bare domain), `AnchorBy`, `Combine` |
| `SproutsDataEnvironment` | Removed: there are no test keys, and `meta.environment` is a deprecated constant (`'live'`) |
| `Envelope` | `SearchEnvelope`, `EntitiesEnvelope` and the other named envelopes |
| `Coverage` | `SearchCoverage` (a search answer's `coverage`) |
| `FilterValuesResponse`, `DocumentFilterValuesResponse` | `FilterValues`, `DocumentFilterValues` |
| `SortCatalogResponse`, `SortFieldInfo` | `SortOptions`, `SortOption` |
| `CompanyEntitiesParams`, `PersonEntitiesParams` | `CompanyLookupParams`, `PersonLookupParams` |
| `DocumentEntitiesParams`, `NamedDocumentEntitiesParams` | `DocumentLookup`, `NamedDocumentLookup` |
| `EntitiesResolveBy`, `NamedDocumentLookupBy` | `CompanyBy` / `PersonBy`, `DocumentBy` |
| `CreditsResponse` | `CreditsOut` |
| `UsageParams`, `UsageResponse`, `UsageBucket`, `UsageGranularity`, `AllocatedCredits`, `SharedCredits` | Removed with `credits.usage`; the ledger is `TransactionsOut` / `TransactionOut` |
| `CsvExport` | `ExportResult`, with `ExportJobView` for a job |
| `SavedList`, `SavedItem`, `ListItemsParams` | `SavedListView`, `SavedItemView`, `PageParams` |
| `OrgChartParams` | `OrgChartParams` (now the API's `OrgChartRequest`) |
| `OrgChartDepartmentsParams`, `OrgChartLocationsParams` | `DepartmentsRequest`, `LocationsRequest` |
| `OrgChartPeopleFilters` | `OrgChartFilters` |
| `OrgChartDepartmentsResponse`, `OrgChartLocationsResponse`, `OrgChartCell` | `DepartmentsResponse`, `LocationsResponse`, `Cell` |
| `OrgChartIdentifier`, `GovernanceLevel`, `EmploymentType` | Removed: `domain`, `linkedin_url` and `company_ref` are fields of each request; levels and types are strings, listed by `orgChart.taxonomy()` |
| `HistoryListParams`, `HistoryMetricsParams` | `HistoryParams`, `TimeWindow` |
| `HistoryRunSummary`, `HistoryRunDetail` | `RunSummary`, `RunDetail` |
| `HistoryMetricsResponse`, `HistoryMetricsBucket` | `MetricsResponse`, `MetricsBucket` |
| `AgentRunParams` | `RunCreateParams` (the API's `RunRequest`) |
| `AgentRunHandle`, `AgentRunResult` | `RunHandle`, `RunResult` |
| `AgentRunListItem`, `AgentRunList` | `RunListItem`, `RunList` |
| `AgentRunResultsEnvelope` | `RunResultsEnvelope` |
| `AgentRunEvent` | `ServerSentEvent` |
| `AgentEffort` | `Effort` |
| `WaitRunOptions`, `CreateRunOptions` | `WaitOptions`, `RequestOptions` |
| `FeedbackCreateParams`, `FeedbackCreated`, `FeedbackView` | `ReportParams`, `ReportView`, `ReportView` |
| `FeedbackListResponse` | `ReportsPage` |
| `FeedbackSubjectRef`, `FeedbackTarget`, `FeedbackExpected` | `SubjectRefInput`, `TargetInput`, `Expected` |
| `TagVocabularyResponse`, `TagDescriptor` | `TagsResponse`, `TagView` |
| `VoteCastParams` | `VoteParams` |
| `RelationshipParams`, `RelationshipReachParams` | `RelationshipRequest`, `ReachRequest` |
| `RelationshipCompanyRef`, `RelationshipInstitutionRef` | `RelationshipCompany`, `RelationshipInstitution` |
| `RelationshipInstitutionsParams`, `RelationshipAskParams` | `InstitutionsRequest`, `AskRequest` |
| `MemberResolveResponse`, `MemberState` | Removed with `members` |
| `Problem` | Removed: read `APIError.extra` and `APIError.body` |
| `Entities`, `Credits`, `History`, `Runs`, `Feedback`, `FeedbackVotes`, `Lists`, `Members`, `Relationships`, `OrgChart` (resource classes) | No longer exported as types; use the client's properties |

## Tools and adapters

### `sproutsdata/tools`

- `new Toolset(client, options)` uses the client as it is. The `integration` option is gone,
  and so is `DEFAULT_INTEGRATION`; 0.0.1 copied the client to set its own
  `X-SproutsData-Client` value.
- The standalone helpers take the tool names first:

  <!-- snippet: skip -->
  ```ts
  // 0.0.1
  definitions({ include: ['search'], fixed });
  openai({ include: ['search'], strict: true, api: 'responses' });
  ```

  ```ts
  // Now
  import { anthropic, definitions, openai } from 'sproutsdata/tools';

  definitions(['search']);
  openai(['search'], { strict: true, api: 'responses' });
  anthropic(['search', 'lookup']);
  ```

- New exports: `resolveClient(options)` returns the client a `ConnectionOptions` describes (the
  one given, or one built from `apiKey`, `baseUrl`, `timeoutMs` and `maxRetries`);
  `isApplicationError(err)` says whether an error is one only the application can fix (401,
  403, 402); `isSproutsData(value)` recognises a client, including one from a second copy of
  the package; and `APPLICATION_ERRORS`.
- The `CatalogOptions`, `OpenAIOptions` and `OpenAIApi` types are removed.

```ts
import { ClientValidationError, SproutsData } from 'sproutsdata';
import { resolveClient, Toolset } from 'sproutsdata/tools';

const client = resolveClient({ apiKey: process.env['SPROUTSDATA_API_KEY'] });
const tools = new Toolset(client, { maxResults: 10 });

try {
  resolveClient({ client: new SproutsData(), timeoutMs: 30_000 });
} catch (err) {
  if (err instanceof ClientValidationError) console.log(err.message); // set timeoutMs on that client instead
}
console.log(tools.toolNames);
```

### Adapters (`@sproutsdata.ai/langchain`, `@sproutsdata.ai/ai-sdk`)

**Behaviour change:** a `client` given to `sproutsDataTools()` or `SproutsDataRetriever` is
used as it is. In 0.0.1 the adapters used a copy of it (to set their own
`X-SproutsData-Client` value), and connection settings passed beside a client were ignored.
Now `apiKey`, `baseUrl`, `timeoutMs` or `maxRetries` beside a `client` throw
`ClientValidationError` when the tools or the retriever are made. Set them on the client
instead.

<!-- snippet: skip -->
```ts
// 0.0.1: timeoutMs was ignored
const tools = sproutsDataTools({ client, timeoutMs: 30_000 });
```

```ts
// Now
import { SproutsData } from 'sproutsdata';
import { sproutsDataTools } from '@sproutsdata.ai/ai-sdk';

const tools = sproutsDataTools({ client: new SproutsData({ timeoutMs: 30_000 }) });
```

The connection options of both adapters are `sproutsdata/tools`' `ConnectionOptions`
(exported by the LangChain package as `SproutsDataConnection`, as before).

**Behaviour change:** with `category: 'auto'`, `SproutsDataRetriever` sends no `mode`, because
`auto` is that category's only mode (0.0.1 always sent `mode: 'fast'`). With any other
category it still sends `mode: 'fast'` unless you set one.

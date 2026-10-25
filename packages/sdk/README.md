# sproutsdata

The official JavaScript / TypeScript SDK for the **Sprouts Data API**: search
and enrich companies, people, patents, news, funding rounds, job openings and
market research over Sprouts' GTM index.

No runtime dependencies. Node.js 18 or later (it uses the built-in `fetch`).
ESM and CommonJS, with full TypeScript types; the record types are generated
from the API's OpenAPI document.

## Install

```sh
npm install sproutsdata
```

Create a key in the Sprouts dashboard and export it:

```sh
export SPROUTSDATA_API_KEY=sk_dsp_test_<your-key>
```

Use a `sk_dsp_test_` key while developing. Test keys are metered and ledgered but
charged **zero credits**, so nothing you do in development costs anything.

## Quick start

Search, then fetch the full record behind the first result:

```ts
import { SproutsData, lookupRef } from 'sproutsdata';

const client = new SproutsData(); // reads SPROUTSDATA_API_KEY

const page = await client.search({ query: 'fintech companies in Germany', category: 'company', mode: 'auto', limit: 10 });
console.log(page.total, page.total_is_estimate ? 'matches (at least)' : 'matches');

for (const hit of page.results) console.log(hit['account_name'], hit['domain'], hit.score);

const ref = page.results[0] ? lookupRef(page.results[0]) : null; // { by: 'domain', value: '…' }
if (ref) {
  const lookup = await client.entities.companies({ ids: [ref.value], by: ref.by });
  for (const hit of lookup.results) console.log(hit.matches[0]?.account_name, hit.matches[0]?.employee_count);
}
```

Only `id`, `category` and `score` are guaranteed on a hit, and a company names
itself in `account_name`. A hit's `id` is not a lookup key: `lookupRef(hit)` is
how to look the row up — by domain for a company, by LinkedIn URL for a person
(`entities.persons`).

## Search

```ts
const page = await client.search({
  query: 'payments companies in Germany with 500-5000 staff',
  category: 'company', // or person, patent, news_article, funding_round, …
  mode: 'auto',        // 'fast' (the default) matches the words without parsing them
  limit: 10,
});
```

`mode: 'fast'` matches the words, so a constraint stated only in words — a
country, a headcount — is not applied; `mode: 'auto'` parses the query into
filters first and reports what it inferred in `page.resolved_search`.
`category` defaults to `company`. Pass `category: 'auto'` (with `mode: 'auto'`
and a query only) and the SDK sends no category, so the server classifies the
query itself.

`mode: 'deep'` hands the query to the agentic engine. It searches `company` or
`person` (not `auto`), returns one page with no cursor, runs at the agent's
minimal effort tier, and reads only the query: the SDK refuses `filters`,
`sort` and domain lists alongside it (`ClientValidationError`), because the
server would ignore them on a billed call. For exhaustive research, use an
[agent run](#agent-runs).

`keyword_query` is keyword search over company text, as an AND / OR / NOT tree:

```ts
const page = await client.search({
  keyword_query: { and: ['payments', { or: ['stripe', 'adyen'] }, { not: 'crypto' }] },
});
```

Companies only, never beside `query`, never with `mode: 'deep'`, and billed as
a `fast` search. It is rolling out: a deployment that does not have it yet
answers 422 for the field.

### Filters

For `company` and `person`, `filters` is the typed `DiscoverFilters`
vocabulary, so a misspelt filter is a compile error:

```ts
await client.search({
  category: 'company',
  filters: {
    industry: { include: ['Software & Technology'] },
    employee_count: { gte: 500, lte: 5000 },
    geo: { places: [{ value: 'Germany', level: 'country' }] },
  },
});
```

The server checks the rest. A `company` or `person` filter it cannot read is a
`422` located at `body` with the filter's path in the message
(`body: Value error, filters.employee_count.gt: Extra inputs are not permitted`),
surfaced as `InvalidRequestError` with the entry on `err.fieldErrors`. The
document categories take free-form filters, checked by the retrieval engine,
whose `422` carries only its `detail` and no field paths. See
[Filters](../../docs/filters.md).

### Pagination

Cursors are signed against the request that produced them: page 2 must resend
page 1's body unchanged, or you get `422 pagination.cursor_invalid`. The page
iterators copy `params` before the first request, so nothing you do to your own
objects afterwards can break the walk:

```ts
for await (const page of client.searchPages({ query: 'fintech', limit: 100 }, { maxResults: 500 })) {
  process(page.results);
}
```

`limit` is the one field you may change between pages (the iterator's `limit`
option). Iteration stops at the API's 10,000-row depth cap with one warning,
rather than raising after you have paid for every page before it. Watch
`page.truncated`: when it is true, `has_more: false` does **not** mean you have
everything. See [Pagination](../../docs/pagination.md).

### Is that all of them?

`total` says how many rows matched; `coverage` says whether those are all of
them. It is filled for `deep` searches and agent runs, and `null` means coverage
was not measured — never that it was complete. `degradation[]` says what the
server could not do for this request; an empty list means it checked and found
nothing wrong. See [Reading responses honestly](../../docs/quickstart.md#reading-responses-honestly).

## Look-alikes

```ts
const lookalikes = await client.similar({
  anchors: [{ value: 'stripe.com' }, { value: 'adyen.com' }], // by: 'domain' is the default
  combine: 'or',
  filters: { employee_count: { gte: 500 } },
});
```

`combine: 'and'` averages the anchors into one composite ideal; `'or'` returns
companies resembling any one of them. With several dissimilar anchors, `'and'`
can describe a company that does not exist — `'or'` is usually what you want.
Anchors decide who is similar; `filters` decides which of those come back.

## Filter values and sorts

```ts
for await (const value of client.iterFilterValues('industry', { search: 'fin' })) {
  console.log(value);
}
```

For autocomplete and pickers. `geo` is not a valid name — it spans four levels
with no single vocabulary — so enumerate `country`, `state`, `city` or `region`
and send each answer back with the matching `level`. `industry`, `sub_industry`
and `department` have two layers (`level: 'parents'`, then
`parent: 'Software & Technology'`). The document categories keep their own
filter names: `client.documentFilterValues('patent', 'status')`.

### Sorting

```ts
await client.search({
  query: 'payments companies in Germany',
  category: 'company',
  sort: [{ field: 'employee_count', direction: 'desc' }],
});
```

Up to three clauses, replacing relevance ordering; `category` is required.
Which fields a category can sort on is the server's to say, and a refusal names
the clause; `client.sorts(category)` returns the live catalogue with labels and
default directions. See [Sorting](../../docs/sorting.md).

## Coverage

What the index holds, per segment — free, and worth reading before you promise
a user an answer:

```ts
const report = await client.coverage();
for (const segment of report.segments) {
  console.log(segment.name, segment.category, segment.total, segment.with_embeddings);
}
console.log('not in this deployment:', report.not_in_index);
```

A segment in `not_in_index` is absent, not empty: searching it is a question the
deployment cannot answer, not a quiet zero.

## Entities

Entity lookups return **typed** records, one method per category: `companies`,
`persons`, `patents`, `news`, `trends`, `marketReports`, `fundings`,
`academicReports`, `jobOpenings`.

```ts
const lookup = await client.entities.companies({ ids: ['stripe.com', 'adyen.com'], by: 'domain' });

for (const hit of lookup.results) {
  if (!hit.found) console.warn('not in the index:', hit.id); // misses are returned, never dropped
  else console.log(hit.matches[0]?.domain, hit.matches[0]?.employee_count);
}
```

Each lookup is billed 1 credit per record found, and every id is answered, in
order: a miss is `found: false` with `matches: []`, and is free. `matches` is always a list; a lookup
by name can resolve to several records.

Without `by`, `ids` are record ids. Companies and people accept 1,000 record ids
per call, or 50 with `by` set, since each value has to be resolved; the document
categories accept 100, because one record is an entire document, or 50 with
`by: 'name'`. The server enforces these and names the limit in its `422`.
`news`, `marketReports`, `fundings` and `jobOpenings` take `by: 'id' | 'name'`;
the SDK sends `'id'` unless you pass `'name'`. See
[Full records](../../docs/quickstart.md#full-records).

## Relationships

```ts
const page = await client.relationships.find({
  relation: 'between_companies',
  companies: [{ value: 'stripe.com' }, { value: 'adyen.com' }],
});

for (const person of page.results) {
  console.log(person.full_name, 'via', person.via.map((v) => v.name));
}
```

Every row carries `via` — the institutions that connect the two sides — because
a name with no reason is something nobody can act on. A connection is a
**shared institution, not an acquaintance**: two people who both worked at the
same company may never have met. Order is the contract: the first company's
people are the rows.

Three more routes answer the questions `find` cannot:

```ts
// who one named person can reach at a company, and through what
await client.relationships.reach({
  person: { li_url: 'https://www.linkedin.com/in/ada-lovelace/' },
  target_company: { value: 'adyen.com', by: 'domain' },
});

// the employers and schools two companies share, with nobody ranked
await client.relationships.institutions({ companies: [{ value: 'stripe.com' }, { value: 'adyen.com' }] });

// or ask in words, and let the server pick the route
const answer = await client.relationships.ask({ query: 'who at Adyen do we know from Stripe' });
console.log(answer.route, answer.reading.span);
```

`ask` reports which question it decided a sentence was, and `reading` says what
it understood — worth checking before the rows, because a wrongly routed
question still produces a well-formed answer. See
[Relationships](../../docs/relationships.md).

## Org charts

A company's people, counted rather than listed:

```ts
const grid = await client.orgChart.retrieve({ domain: 'stripe.com' });
for (const cell of grid.cells) console.log(cell.department, cell.seniority, cell.count);

await client.orgChart.departments({ domain: 'stripe.com' }); // teams, with sub-departments
await client.orgChart.locations({ domain: 'stripe.com' });   // country → state → city
```

`grid.total` counts everyone; the cells count only the people the corpus could
place in both a department and a level, so the cells do not sum to the total.
Report both. Filters narrow the population *before* counting, so a filtered
chart is that population's org chart rather than the company's with cells
blanked. See [Org charts](../../docs/org-chart.md).

## Agent runs

Research rather than retrieval: candidates verified against criteria you state
in words. Minutes, not milliseconds, and the only asynchronous surface in the
API.

```ts
const handle = await client.runs.create({
  query: 'Series B fintechs in the Nordics',
  criteria: ['has launched a card product', 'is not a bank'],
  effort: 'high',
});

for await (const event of client.runs.events(handle.run_id)) console.log(event.type, event.data); // optional

const run = await client.runs.wait(handle.run_id);
if (run.status === 'completed') {
  for await (const page of client.runs.resultsPages(run.run_id)) {
    for (const row of page.results) console.log(row['account_name'], row['domain']);
  }
}
```

Credits are **held** at creation and settled when the finished run is read;
cancelling releases the hold and charges nothing. Reading the results is free.
`wait()` returns a `failed` or `expired` run rather than throwing; past its
deadline (15 minutes by default) it throws `RunWaitTimeoutError` with the last
state on `.run`, and the run keeps going. `events()` never reconnects on its
own: resume with `lastEventId`.

The server requires an `Idempotency-Key` on run creation. The SDK generates one
per call and resends it on each of its own retries; pass `{ idempotencyKey }`
yourself when a retry may come from somewhere else. The server replays the first
run for a key it has seen and ignores the new body, so use a new key for a new
question. See [Agent runs](../../docs/runs.md).

## Credits

```ts
const balance = await client.credits.retrieve(); // free
console.log(balance.spendable);
console.log(balance.allocated?.sources); // unspent credits by source, each with its expiry

const usage = await client.credits.usage({ granularity: 'day' }); // this key only, free
```

**Gate on `spendable`.** Do not add `allocated.remaining` to `shared.remaining`:
the shared pool is reported for visibility but is not available to this
platform, so the sum is a number that looks like credit and buys nothing.

## History

```ts
for await (const page of client.history.listPages({ action_type: 'dsp.search.fast' })) {
  for (const call of page.results) console.log(call.occurred_at, call.query, call.status, call.credits_charged);
}

const detail = await client.history.retrieve(4821);
console.log(detail.request); // the exact body — replay it, don't rebuild it
```

`client.credits` is the billing view; `client.history` is the operational one
(individual calls, with the request that made them). A call is `pending` from
the moment it starts costing something until its outcome is written, then `ok`
or `failed`; `failureRate(metrics)` leaves pending calls out. Requests are kept
indefinitely but result snapshots expire — `detail.snapshot_state` says which.
All free. See [Credits, usage history and members](../../docs/usage.md).

## Feedback

```ts
await client.feedback.create({
  subject_ref: { kind: 'request', id: page.meta.request_id },
  target: { kind: 'result_set' },
  tags: ['too_few'],
  expected: { should_include: ['n26.com'] },
});
```

A rating says something was off; `expected` says what should have come back,
and only the second settles anything. Target one row with
`{ kind: 'result', entity_id }`. The tag vocabulary lives on the server —
`client.feedback.tags()` reads it — and a tag used at the wrong level is refused
there, by name. Free.

```ts
await client.feedback.votes.cast({
  request_id: page.meta.request_id,
  vote: 'dislike',
  entity_category: 'company',
  reason_code: 'too_few',
});
await client.feedback.create({
  context: 'help',
  target: { kind: 'result_set' },
  comment: 'The export button does nothing.',
});
```

A vote is a like or dislike on a whole answer, or a `flag` on one record (pass
its `entity_id`); casting the same vote twice changes nothing. `context: 'help'`
files a problem report about the product, with no subject. See
[Feedback](../../docs/feedback.md).

## Saved lists and export

```ts
const saved = await client.lists.create('Fintech targets');
await client.lists.addItems(saved.id, [
  { entity_category: 'company', entity_id: 'stripe.com' },
  { entity_category: 'company', entity_id: 'adyen.com' },
]);
for await (const item of client.lists.iterItems(saved.id)) {
  console.log(item.entity_id, item.available, item.record);
}

const csv = await client.searchExport({
  items: [{ entity_category: 'company', entity_id: 'stripe.com' }],
}); // csv.content (bytes), csv.text(), csv.filename
```

Lists belong to the workspace. Name a record by its natural id — a domain, a
LinkedIn URL, a patent number, a DOI — never by a search hit's `id`. Adding is
idempotent, Do-Not-Contact records are refused (`suppressed`), and a free
workspace over its saved-items cap gets a `ConflictError`
(`lists.item_cap_reached`). CSV export answers `NotFoundError`
(`export.not_enabled`) until it is switched on. All free. See
[Saved lists](../../docs/lists.md).

## Members

```ts
const member = await client.members.resolve('ada@example.com');
if (member.found && member.state === 'active') {
  // attribute the work to member.user_id
}
```

One email against the key's own organisation, for attributing work to a person
before spending credits. `found: false` is a normal answer meaning "not a
member"; an error means the server could not tell, and must not be read as
"not a member". Free.

## Tools for models

`sproutsdata/tools` hands a model three tools — `sprouts_search`,
`sprouts_similar` and `sprouts_entity_lookup` — with the same names, schemas and
results as the Sprouts MCP server and the Python SDK. It builds the definitions
and runs the calls, for OpenAI or Anthropic, without importing either SDK:

```ts
import { Toolset } from 'sproutsdata/tools';

const tools = new Toolset(new SproutsData(), { maxResults: 10 });

const response = await openai.chat.completions.create({ model, messages, tools: tools.openai() });
const message = response.choices[0]!.message;
messages.push(message, ...(await tools.handleOpenAIToolCalls(message)));
```

`tools.anthropic()` and `tools.handleAnthropicToolUse(response)` do the same for
Anthropic. Every call is answered, including an unknown tool name, so the
conversation can always continue. Results are compact JSON with the caveats a
model needs — what the engine inferred, whether a total is a floor — and errors
a model can act on come back as data, while a rejected key, a missing scope or
exhausted credits is thrown. The application can fix arguments the model never
sees, cap the rows, and merge in filters of its own. See
[Tools for models](../../docs/tools.md).

## Adapters

| Package | What it is |
| --- | --- |
| [`@sproutsdata.ai/ai-sdk`](../ai-sdk) | The Sprouts tools for the Vercel AI SDK |
| [`@sproutsdata.ai/langchain`](../langchain) | The Sprouts tools as LangChain tools, and search as a retriever |

Both are thin layers over `sproutsdata/tools`, with `sproutsdata` as a peer
dependency. The OpenAI Agents SDK needs no package: the
[recipe](../../docs/integrations/openai-agents.md) covers it in a few lines, as
does the Sprouts MCP server. See [Integrations](../../docs/integrations/README.md).

## Errors

```ts
import { APIError, FeatureNotAvailableError, InsufficientCreditsError, RateLimitError } from 'sproutsdata';

try {
  await client.search({ query: 'fintech' });
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    // Commercial, not transient. Never retried, never slept on.
    console.error(`need ${err.required}, have ${err.available}`);
  } else if (err instanceof RateLimitError) {
    // Retried automatically within maxRetries; this means we ran out.
    console.error(`throttled, retry after ${err.retryAfter}s`);
  } else if (err instanceof FeatureNotAvailableError) {
    // Not available for this request: a cursor on a deep search,
    // or an org chart on a deployment without one.
  } else if (err instanceof APIError) {
    console.error(err.status, err.code, err.requestId);
  } else {
    throw err;
  }
}
```

Branch on `err.code`, never on `err.title` or `err.detail` — those are prose.
Everything the SDK throws is a `SproutsDataError`. A request refused before
sending throws `ClientValidationError`; a success response the SDK cannot read
throws `APIResponseValidationError`. A `422` returns the offending field paths
in `extra.errors`: they are on `err.fieldErrors`, and in the message, as in
`body.limit: Input should be less than or equal to 100`. Every API error carries
`requestId`, and for authentication failures it is the *only* thing that
distinguishes them. See [Errors and retries](../../docs/errors.md).

## Retries

Automatic, bounded by `maxRetries` (default 2), with full-jitter backoff. A
`Retry-After` of up to 60 seconds is honoured in full; a longer one is raised at
once with the value on `err.retryAfter`.

What may be repeated depends on what the route costs. The server charges search,
look-alikes, lookups, relationships and org charts once it has done the work.
The SDK sends an `Idempotency-Key`, and a same-day retry with that key that
returns the same rows is not charged again, but one that returns different rows
is, so a request that may have reached the server is raised rather than
repeated:

| Outcome | Free (`GET`s, cancel, `members.resolve`, votes, list edits) | Billed routes and exports | `runs.create` | `feedback.create`, `lists.create`, `lists.delete` |
|---|---|---|---|---|
| Never arrived (connect refused, DNS, connect timeout) | retried | retried | retried | retried |
| Sent, no answer (timeout, reset after sending, `502`, `408`) | retried | **raised** | retried | **raised** |
| `429` (`Retry-After` ≤ 60 s), `503`, `504` | retried | retried | retried | retried |
| `500` | retried | retried | retried | not retried |

When a billed, feedback or list create/delete request is raised from the "sent,
no answer" row, the error has `reachedServer: true` and its message says what
that means: a charge may have happened, or a duplicate report or list may
exist. Check `client.history.list()`, `client.feedback.list()` or
`client.lists.list()` before trying again. Never
retried: `400`, `401`, `402` (buy credits, don't wait), `403`, `404`, `409`,
`413`, `415`, `422`, `501`, and `500 credits.unknown_action`. Redirects are
never followed.

Every billed call sends an `Idempotency-Key` (`sdk-<32 hex>`, one per call,
resent on its retries), which ties the call's retries to one billing session
for the UTC day. Rate limits are per workspace and per operation, in one-minute
windows: going over is a `429 quota.burst_exceeded`, retried after its
`Retry-After`, and every counted response carries `X-RateLimit-*` headers.

## Configuration

| Option | Environment variable | Default |
|---|---|---|
| `apiKey` | `SPROUTSDATA_API_KEY` | — (required) |
| `baseUrl` | `SPROUTSDATA_BASE_URL` | `https://api.sproutsdata.ai` |
| `timeoutMs` | — | `60000` |
| `maxRetries` | — | `2` |

`baseUrl` must be `https://`; plain `http://` is accepted only for `localhost`
and `127.0.0.1`. `timeoutMs` covers each attempt to the last byte of the body,
and defaults to 60 seconds because `mode: 'auto'` runs a model in the request
path. The key's prefix decides live or test, not which deployment answers.

Per-call overrides go in every method's last argument:

```ts
await client.withOptions({ maxRetries: 0 }).search({ query: '…' });
await client.search({ query: '…' }, { timeoutMs: 120_000, signal: controller.signal });
await client.search({ query: '…' }, { requestId: 'job-42' }); // sent as X-Request-Id
```

`requestId` must be 1–128 characters of letters, digits, `_`, `.`, `:` and
`-`; a page iterator sends it with the first page only.

See [Authentication](../../docs/authentication.md#configuration) for every
option.

## API keys are server-side credentials

The API rejects any request carrying both an `Origin` header and an `X-API-Key`,
with `403 auth.browser_origin`, before it reaches a route. There is no CORS
allowlist and no browser-safe key. Call from a server you control and expose
only the results to your frontend. The client throws if constructed in a
browser; it never sets `Origin` or `Referer`, and refuses to if you ask; and
`console.log`, `util.inspect` and `JSON.stringify` of the client show the key
redacted.

## Links

- The guide: [`docs/`](../../docs/README.md) — start with the
  [quickstart](../../docs/quickstart.md)
- Runnable programs: [`examples/`](../../examples/)
- What changed in each release: [`CHANGELOG.md`](CHANGELOG.md)
- The API's own changes: [`spec/CHANGELOG.md`](../../spec/CHANGELOG.md)
- Reporting a vulnerability: [`SECURITY.md`](../../SECURITY.md)

## License

The SDK code is released under the [MIT License](LICENSE).

The licence covers this code only. Use of the Sprouts Data API, and of the data
it returns, is governed by the Sprouts
[Terms and Conditions](https://sprouts.ai/terms-and-conditions) and
[Privacy Policy](https://sprouts.ai/privacy-policy), or by your agreement with
Sprouts Inc. if you have one.

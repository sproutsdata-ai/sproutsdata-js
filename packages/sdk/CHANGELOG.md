# Changelog

## 0.1.0 — Unreleased

The SDK realigned to the new Sprouts Data Platform API. **Breaking** for
code written against the published `0.0.1`: [MIGRATION.md](MIGRATION.md) shows
every changed call with its replacement.

### Removed

- `dangerouslyAllowBrowser`: the client refuses to run in a browser, and the
  server refuses any key sent with an `Origin` header.
- The `integration` option and the `X-SproutsData-Client` and `X-Dsp-Source`
  headers, which the backend no longer reads.
- `credits.usage()` and `members.resolve()`, which the API does not serve.
- Test keys, which the backend retired: keys look like `sk_dsp_live_…`, and a
  `sk_dsp_test_…` key throws `ClientValidationError` saying so. Tool results no
  longer carry `environment`, and `meta.environment` is a deprecated constant
  (`'live'`).
- `mode: 'deep'`, which the backend no longer offers: it throws
  `ClientValidationError` pointing to `runs.create()`, the agent run that does that
  work now. `SearchEnvelope.coverage` is gone with it (an agent run still carries
  `coverage`), and so are the search tool's `coverage_truncated` and
  `constraint_unmet` caveats.

### Changed

- **Search** covers every category (or `auto`, which lets the question choose)
  and the `auto` and `fast` modes (see below for what each reads); document
  categories take their own
  filters and refuse company ones. Billing is per search session, and
  `meta.credits_charged` is what each page cost. `iterSearch()` walks the pages.
- **Lookups** default to `by: 'auto'`; company and person lookups apply `fields`
  locally. `lookupRef(hit)` says how to look a search row up.
- **Credits**: `credits.retrieve()` (`balance`, `reserved`, `available`, `debt`,
  `status`) and `credits.transactions()`; a frozen wallet throws
  `WalletFrozenError`.
- **Lists** have unique names (`ListNameTakenError`) and take up to 1,000 items
  per request; `lists.export()` and `searchExport()` return
  `{ kind: 'file', csv }` or `{ kind: 'job', job }`, followed with
  `exports.wait()` and `exports.download()`.
- **Org chart** (`orgChart.retrieve`, `departments`, `locations`, `taxonomy`),
  **relationships** (`find`, `reach`, `institutions`, `ask`), **runs**,
  **history** and **feedback** (reports, tags and votes) follow the new routes.
- **Errors** follow the backend's codes; every key failure is one
  `AuthenticationError`.
- **Tools** (`sproutsdata/tools`) are rebuilt on the client with the shared tool
  specs; `resolveClient`, `ConnectionOptions` and `isApplicationError` are
  exported for adapters, and a client from a second copy of the package is
  recognised.
- **Agent run effort** is named `quick`, `basic`, `standard` (the default),
  `detailed` and `maximum` (plus `auto`), as the API names it. The earlier names
  (typed `LegacyEffort`) are still accepted by `runs.create()` and `credits.quote()`
  and sent as the new ones.
- **`RelationshipInstitution`** is now the answer type; a request's institutions are
  `RelationshipInstitutionInput` (**breaking** for code that typed them).
- **Errors**: every code the backend sends an API key is mapped. Two answers are never
  retried whatever their status: a third agent run on a key that has two going
  (`ConcurrencyLimitError`, which used to sleep its 30-second Retry-After twice before
  failing) and a refused credit hold (`CreditsRefusedError`).
- **Document filters** are checked as the server checks them: a `topic` tree has
  `keyword_query`'s limits on every document category, `investors` on a funding round
  (a `MatchAllEntityFilter`) needs an entry, and filters of empty lists or objects
  alone narrow nothing, so a document search then needs a `query`.
- **`credits.quote()`** takes `operation: 'enrichment'` with `fields` (each field at its
  own price, for up to 10,000 records); `fields` for another operation, an unknown or
  repeated field, and a `lookup` quote over 1,000 records are refused locally.
- **Billed calls carry an idempotency key**: search, look-alikes, entity lookups,
  relationships and org charts send a generated `Idempotency-Key` (or yours, in
  `options.idempotencyKey`), so one that timed out, lost its connection after sending, or
  met a gateway's 408, 502 or 504 is retried with the same key and charged once. It used to
  be thrown with `reachedServer: true`. A page walk sends your key and request id with its
  first page only: each later page is its own call, with its own key. Your key must be 1 to
  120 letters, digits or `._:-`, as the API takes it (0.0.1 took 1 to 255 printable
  characters); anything else throws `ClientValidationError` before sending.
- **A gateway's answer is not the API's**: a 408, 502 or 504 without the API's code
  throws `GatewayError` (it used to be `ServiceUnavailableError` or `UpstreamTimeoutError`,
  whose "nothing was charged" only the API can promise). It is repeated where a repeat is
  free or carries its key; any other call throws with a note saying what may already have
  happened. The API's own 504 (`upstream.timeout`) is still `UpstreamTimeoutError`; like a
  500, it is not repeated for a list create or delete, nor for a call that charges before it
  unlocks (see "Whole records are paid for once" below).
- **Tool errors** say `retryable` by the error's `concept`, so a refused credit hold and a
  concurrency limit are no longer offered to a model as retryable. Every tool is charged and
  calling one again sends a new request with a new key, so nothing whose work may have run is
  retryable either: a timeout or dropped connection after sending, a gateway's answer, a 500
  or the API's own timeout. Their message says a repeat can be charged again. A redirect (the base URL
  is not the API's) is thrown to the application however the fetch reports it, and invalid
  `Toolset` settings throw `ClientValidationError`.
- **Look-alike tool**: a result row is recognised as one of the anchors by its own
  `domain` only (a company row's `id` is a sealed reference, not its domain), and
  `anchors_removed` names it by that domain.
- **Field errors** keep every entry the server gave a message; one without a `loc` reads
  as the whole request (`loc: []`).

### Changed because the API changed

The API changed these after the rest of this release was written; the SDK follows it.

- **A search without `mode` runs in `auto`**, the API's new default: a model turns
  everything the words ask into filters, billed as an AI search (`search_auto` in
  `credits.quote()`). `fast` now reads the words only for what they are about
  (keywords, a description matched by meaning, people's titles or skills; a
  document's topic) and sets no other filter, so hard constraints belong in
  `filters`. The SDK sends no mode unless you pass one, so it follows the API; the
  search tool and the LangChain retriever still send `fast` unless told otherwise.
  **Price:** with the API's built-in prices, `auto` costs 0.595 credits for a page of up
  to 10 rows against 0.5 in `fast` (19% more), and 0.085 a row beyond that against 0.08
  (6% more): a full page of 25 rows is 1.87 credits against 1.7. Pass `mode: 'fast'` to
  keep the old price; `credits.quote({ operation: 'search_auto' })` says what a deployment
  charges.
- **Partial matches.** A company or person search returns, after the rows meeting
  every filter, the rows meeting part of it: each row has `matched_filters`,
  `match_score` and, on a partial row, `unmet` (`UnmetFilter`); a page has
  `total_exact`, and `total` counts both. `search()` and `iterSearch()` take
  `partial_matches` (`false` for exact matches only; refused locally for document
  categories, as the API refuses it). Partial rows are charged like any other row, so a
  search that returns them costs more: send `partial_matches: false` to pay only for
  exact matches. The search tool keeps the three fields on a partial row (one with
  `unmet`, or a `match_score` below 1) whatever the projection, returns `total_exact`,
  adds a `partial_rows` caveat (without the exact count when the API gave none), and
  takes `partial_matches`.
- **Whole records are paid for once.** A workspace that has bought credits sees each
  record whole in a lookup, a saved list or an export, and pays the lookup price the
  first time, unlocked for 90 days by any of those routes; others see the search-row
  fields, free. `AddItemsResponse` and `ListItemsResponse` carry `credits_charged`,
  and an export file is an `ExportFile` with `creditsCharged`, `fieldTier`, `rows`
  and `skipped`, read from the answer's headers (`ExportJob` names the other
  variant). Adding list items, reading them and both exports read no
  `Idempotency-Key` and charge before they unlock the records, so they are not
  repeated when their work may have run: a gateway's answer throws `GatewayError`, a
  500 `InternalServerError` and the API's own timeout `UpstreamTimeoutError`, each
  saying the call may have been charged (a repeat could charge the same records
  again). A 503 or a 429, answered before any work begins, is still retried.
- **Lists have their own scopes**: `dsp.lists.read` to read, `dsp.lists.write` to
  change. Keys made without choosing scopes get both.
- `re_enrich` says which repeats are free: a value already found for the same
  LinkedIn profile or Sprouts record. A row sent with only a name and a company is
  looked up, and charged, each time.

### Added

- `onResponse` on the client and per call; `scripts/smoke-live.mjs` checks a
  deployment with the check names the Python SDK shares.
- Requires Node.js 22.12.0 or later.
- An empty search says why: `degradation` carries `no_match`, and
  `suggestion` can be `kind: 'relax'` with `without`, the filters whose removal
  alone finds records (`examples/relax-search.ts`). `sparse_filter` and
  `topic_not_required` name thin filters and unmentioned topics. The search
  tool's `interpreted_as` carries `sparse_filters`.
- `credits.quote()`: what a call would cost, from the live price list (free; it
  holds nothing). `meta.credits_balance` is the balance after each billed call.
- `APIError.nextStep`: the server's one sentence on what to do now, after
  `detail` in the message; tool errors carry it after the detail too.
- `client.enrichment`: emails and phones for people (`contacts`), domains, phones and
  LinkedIn pages for companies (`accounts`). `lookup()` answers up to 20 items in the call
  (one that does not finish becomes a job); `create()` starts a job, followed with
  `retrieve()`, `wait()` (on the spec's `enrichmentWait` rhythm), `results()` /
  `iterResults()`, `list()` / `iterList()` and `cancel()`. Requests the server would refuse
  are refused locally in its words; both keyed calls send an `Idempotency-Key`. Each field
  has its price (by default 1 credit, a phone number 9); a request holds at most 30,000
  credits; only values newly found are charged, and `values_found` counts them (on a lookup,
  a row, and a job once it has ended); a field with no value says why (`reason`). Needs the `dsp.enrichment.*` scopes
  (`examples/enrichment.ts`, `docs/enrichment.md`).
- `orgChart.people()` and `iterPeople()`: the people one cell of a company's chart
  counts, a page at a time, named by the chart's `company_ref` (every chart answer
  carries one, and a company search row's `id` is one). Billed per page that lists
  anyone.
- `ResultsExpiredError` (410, a `NotFoundError`: a run's or an enrichment job's rows are no
  longer kept), `ConcurrencyLimitError` (a `RateLimitError`), `CreditsRefusedError` (a
  `ServiceUnavailableError`) and `GatewayError`.
- `APIError.concept`: the kind of failure in the names both SDKs share (`rate_limit`,
  `gateway`, ...), as the Python SDK's `APIStatusError.concept` gives it.
- `SproutsDataError.idempotencyKey`: the key a keyed call sent, on whatever it throws. When
  its retries run out on work that may have run, the message says so; send the same key to
  repeat the call, charged once and starting nothing twice (a new key is a new request).
- Refused locally, as the API refuses them: a `query` of only whitespace (an older API
  charged it and answered with the whole index), `category: null`, a per-call
  `timeoutMs` or `maxRetries` the client itself would refuse, and a `wait` whose
  `pollIntervalMs` is not a positive number or whose `maxWaitMs` is negative or not
  finite (a zero interval polled without pause, a negative one for ever). `category: 'auto'` takes
  `fields`.
- The types of the current API: the new document and trend filters,
  `lock_filters` and `fields` on the search bodies, `resolved_search.read_as` and
  `anchor_matches`, and the enrichment, org chart people and credit purchase types.
  Generic backend names carry their feature (`EnrichmentJob`, `OrgChartPlacement`,
  `CreditPurchase`, ...).

## 0.0.1 — 2026-10-14

The first public release of `sproutsdata`, the official JavaScript / TypeScript
SDK for the Sprouts Data API. Until 1.0, a minor version may include breaking
changes; each one will be listed here.

### Included

- **Search**: `search()` in `fast`, `auto` and `deep` modes over companies,
  people and the document categories (patents, news, funding rounds, job
  openings, market and academic reports, trends), with typed filters, sorting,
  `keyword_query`, and `searchPages()` for cursor pagination up to the API's
  10,000-result depth cap.
- **Look-alikes**: `similar()` for companies like a set of anchors.
- **Catalogues**: `filterValues()`, `iterFilterValues()`,
  `documentFilterValues()`, `sorts()` and `coverage()`.
- **Entities**: `client.entities` looks up full records by id, domain, name or
  LinkedIn URL, and reports every id it could not find.
- **Relationships**: `client.relationships` finds people connected to a set of
  companies, who a person can reach at a target company, the institutions they
  share, and answers the same questions asked in words (`ask()`).
- **Org charts**: `client.orgChart` for a company's grid, departments and
  locations.
- **Agent runs**: `client.runs` creates, follows (server-sent events), waits
  for, cancels and lists agent runs, and pages through their results.
- **Account**: `client.credits` (balance and key usage), `client.history`
  (past calls, their detail and metrics) and `client.members`.
- **Feedback**: `client.feedback` files reports and help requests, lists them,
  and casts votes on results.
- **Saved lists**: `client.lists` creates, renames and deletes lists, adds,
  reads and removes items, and exports a list or a search as CSV where the
  deployment offers it.
- **Tools for models**: `sproutsdata/tools` exposes `sprouts_search`,
  `sprouts_similar` and `sprouts_entity_lookup`, with the same names, schemas
  and results as the Sprouts MCP server, for OpenAI, Anthropic and any model
  that calls functions.
- **Errors and retries**: a typed error class per API error code, with
  `request_id` on every response and error. Retries follow each route's cost,
  so a billed call that may have reached the server is never repeated, and a
  `402` is never retried.
- **Runtime**: no runtime dependencies, Node.js 18 or later, ESM and CommonJS
  builds with full TypeScript types.

The older `DSP_API_KEY` and `DSP_BASE_URL` environment variables are still read
when `SPROUTSDATA_API_KEY` and `SPROUTSDATA_BASE_URL` are unset, with a
deprecation warning, until 1.0.

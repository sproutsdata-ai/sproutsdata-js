# Changelog

## Unreleased

The SDK realigned to the new Sprouts Data Platform backend. **Breaking** for
code written against the published `0.0.1`: [MIGRATION.md](MIGRATION.md) shows
every changed call with its replacement.

### Removed

- `dangerouslyAllowBrowser`: the client refuses to run in a browser, and the
  server refuses any key sent with an `Origin` header.
- The `integration` option and the `X-SproutsData-Client` and `X-Dsp-Source`
  headers, which the backend no longer reads.
- `client.agents`, `credits.usage()` and `members.resolve()`, which the backend
  does not serve; agent runs are `client.runs`.
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
  and the `fast` and `auto` modes (both read the words into filters; `auto` is
  billed as an AI search); document categories take their own
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
- **Billed calls carry an idempotency key** (dsp-backend DSP-449): search, look-alikes,
  entity lookups, relationships and org charts send a generated `Idempotency-Key`, so one
  that timed out, lost its connection after sending, or met a 502 or 408 is retried with
  the same key and charged once. It used to be thrown with `reachedServer: true`.

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
  credits; a field with no value says why (`reason`). Needs the `dsp.enrichment.*` scopes
  (`examples/enrichment.ts`, `docs/enrichment.md`).
- `orgChart.people()` and `iterPeople()`: the people one cell of a company's chart
  counts, a page at a time, named by the chart's `company_ref` (every chart answer
  carries one, and a company search row's `id` is one). Billed per page that lists
  anyone.
- `ResultsExpiredError` (410, a `NotFoundError`: a run's or an enrichment job's rows are no
  longer kept), `ConcurrencyLimitError` (a `RateLimitError`) and `CreditsRefusedError` (a
  `ServiceUnavailableError`).
- The types of the API at dsp-backend `c580236`: the new document and trend filters,
  `lock_filters` and `fields` on the search bodies, `resolved_search.read_as` and
  `anchor_matches`, and the enrichment, org chart people and credit purchase types.
  Generic backend names carry their feature (`EnrichmentJob`, `OrgChartPlacement`,
  `CreditPurchase`, ...).

## 0.0.1

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

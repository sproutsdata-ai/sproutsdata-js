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
  does not serve; research runs are `client.runs`.

### Changed

- **Search** covers every category (or `auto`, which lets the question choose)
  and the `fast`, `auto` and `deep` modes; document categories take their own
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

### Added

- `onResponse` on the client and per call; `scripts/smoke-live.mjs` checks a
  deployment with the check names the Python SDK shares.
- Requires Node.js 22.12.0 or later.

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

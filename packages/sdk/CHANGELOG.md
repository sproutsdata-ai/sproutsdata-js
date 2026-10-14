# Changelog

## 0.4.0 (Unreleased)

The first release under the Sprouts Data names, with production as the default
deployment, and a breaking one: the Python and JS SDKs now expose the same
surface (`spec/surface-map.json`). None of the old names was published, so no
aliases are kept; the only compatibility shim is the deprecated
environment-variable fallback.

### Migrating from 0.2.0

Everything that changes for existing code, in one table: names, configuration,
methods, behaviour, tools, then packages. Most behaviour changes make a call
succeed, or fail more usefully, where it did not before; the ones to check your
code against are in bold.

| Kind | What | 0.2.0 | 0.4.0 |
|---|---|---|---|
| Name | Package | `@sproutsdata.ai/sprouts-js-sdk` | `sproutsdata` (`npm install sproutsdata`) |
| Name | Import | `import { DspClient } from '@sproutsdata.ai/sprouts-js-sdk'` | `import { SproutsData } from 'sproutsdata'` (also the default export) |
| Name | Client and options | `DspClient`, `DspClientOptions` | `SproutsData`, `SproutsDataOptions` |
| Name | Environment type | `DspEnvironment` | `SproutsDataEnvironment` |
| Name | Base error | `DspError` | `SproutsDataError` |
| Name | Local refusal | `DspValidationError` | `ClientValidationError` |
| Name | 400 / 415 / 422 | `BadRequestError` | `InvalidRequestError` |
| Name | 409 | `ConflictError` | `IdempotencyConflictError` for `idempotency.in_flight` and a 409 with no code, now a subclass of a new `ConflictError` that `lists.item_cap_reached` raises |
| Name | Resource types | `Agents`, `UsageHistory` | `Runs`, `History` |
| Name | User-Agent | `sprouts-js-sdk/<ver>` | `sproutsdata-js/<ver> (<runtime>/<ver>; <os>)` |
| Configuration | Key variable | `DSP_API_KEY` | `SPROUTSDATA_API_KEY` (the old name is still read, with one `DeprecationWarning`, until 1.0) |
| Configuration | Base URL variable | `DSP_BASE_URL` | `SPROUTSDATA_BASE_URL` (the old name is still read, with one `DeprecationWarning`, until 1.0) |
| Configuration | Default base URL | the QA deployment | `https://api.sproutsdata.ai` — for live and test keys alike; the key's prefix decides live or test, not the deployment |
| Configuration | Plain `http://` base URL | Accepted | Refused unless the host is `localhost` or `127.0.0.1` |
| Configuration | Key shape | Must start with `sk_dsp_` | The whole key must match `sk_<platform>_<live\|test>_<secret>`: any platform prefix is accepted, and a trailing newline is refused |
| Method | Start a run | `client.agents.createRun(params, opts)` | `client.runs.create(params, opts)` |
| Method | Read a run | `client.agents.getRun(id)` | `client.runs.retrieve(id)` |
| Method | List runs | `client.agents.listRuns(params)` | `client.runs.list(params)` |
| Method | Cancel a run | `client.agents.cancelRun(id)` | `client.runs.cancel(id)` |
| Method | Wait for a run | `client.agents.waitForRun(id, opts)` | `client.runs.wait(id, opts)` |
| Method | Run events and rows | `client.agents.events / results / resultsPages` | `client.runs.events / results / resultsPages` |
| Method | Org chart grid | `client.orgChart.get(params)` | `client.orgChart.retrieve(params)` |
| Method | Credit balance | `client.credits()` | `client.credits.retrieve()` |
| Method | Key usage | `client.usage(params)` | `client.credits.usage(params)` |
| Method | One past call | `client.history.get(id)` | `client.history.retrieve(id)` |
| Method | Sort clause limit | `MAX_SORT_CLAUSES` exported | Removed; the server enforces it |
| Behaviour | What is retried | Any 429/502/503/504 and connection failure, on every route | By route class (`spec/routes.json`): *safe* (GETs, `runs.cancel`, `members.resolve`), *billed* (search, similar, entities, relationships, org charts), *keyed* (`runs.create`), *once* (`feedback.create`) |
| Behaviour | **A billed call after a timeout, dropped connection, 502 or 408** | Retried — a possible second charge | Raised with `reachedServer: true` and a message saying a charge may have happened. A connection that provably never left (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `UND_ERR_CONNECT_TIMEOUT`) is still retried everywhere |
| Behaviour | **`feedback.create` that may have landed** | Retried — a possible duplicate report | Raised; never retried after a 500 either |
| Behaviour | 500 | Not retried | Retried, except `credits.unknown_action` and on `feedback.create` |
| Behaviour | `Retry-After` | Seconds, cut at 30 s | Seconds or an HTTP date; up to 60 s slept in full, above 60 s raised at once with `retryAfter` |
| Behaviour | Backoff | Exponential with jitter | Full jitter, `0–min(8, 0.5·2^(n-1))` seconds before retry *n*, as in the Python SDK |
| Behaviour | `timeoutMs` and `AbortSignal` | Covered the headers | Cover the response body: a body that stalls mid-read times out |
| Behaviour | Redirects | Followed — a redirect to another origin received the key | Never followed: a 3xx raises `APIConnectionError` and is not retried |
| Behaviour | Error classes | Chosen by status | Chosen by `code` first, then status, then `APIError`. A 501 is `FeatureNotAvailableError` and a 503/504 their own classes, no longer `InternalServerError`; an unknown 5xx is `APIError` |
| Behaviour | `requestId` / `meta.request_id` | The body's | The `X-Request-Id` header first, then the body; a success body without `meta` gets one holding the header's `request_id` |
| Behaviour | `InvalidRequestError` message | Title and detail | Also every field path from `extra.errors`: `body.limt: Extra inputs are not permitted` |
| Behaviour | Unreadable success body | `APIConnectionError` | `APIResponseValidationError` |
| Behaviour | Server bounds, lengths, vocabularies | Mirrored and refused locally (page and batch sizes, sort clause counts, the 64-character feedback subject id, effort and category names, tag counts, …) | **Sent as given**; the server's 422 names the field (`err.fieldErrors` and the message). The stale 64-character feedback subject limit (the server allows 128) is gone |
| Behaviour | `mode: 'deep'` | Accepted `filters`, `sort` and domain lists, which the server ignored on a billed call | **Refused locally** alongside non-empty `filters`, `sort`, `include_domains` or `exclude_domains`; empty ones ask for nothing and are not refused |
| Behaviour | Empty optional lists | Sent | Left out (`sort`, `include_domains`, `exclude_domains`, `filters` on search; `filters` on similar), as the Python SDK does — so a cursor signed over a request without `sort` matches the next page's |
| Behaviour | **`search` with no `category`** | Sent no category, so the server auto-classified the query — and refused anything but `query` with `mode: 'auto'` | Searches `company`, as the Python SDK does (`searchPages` and the tools too). `category: 'auto'` asks for auto-classification: the SDK sends no category and leaves what else that request may carry to the server |
| Behaviour | `search` `filters` type | One shape for every category | Typed by `category`: `DiscoverFilters` for `company` / `person` (or `'auto'`), free-form for document categories |
| Behaviour | Pagination | Re-sent your `params` object as it stood | Copies `params` once before the first page, so editing it mid-iteration cannot break the cursor; stops at the 10,000-row depth cap with one `SPROUTSDATA_DEPTH_CAP` warning, and warns once (`SPROUTSDATA_TRUNCATED`) on a truncated result |
| Behaviour | `runs.create` | `idempotencyKey` required, checked to 255 characters | Optional: without one the SDK generates `sdk-<32 hex>` and reuses it on its own retries; the length check is the server's. The server replays the first run for a key and ignores the new body |
| Behaviour | `runs.wait` | No deadline unless `timeoutMs` was set, then `APITimeoutError` | 15-minute deadline, polls 3 s × 1.5 up to 15 s, returns `failed` / `expired` runs, throws `RunWaitTimeoutError` with the last `run` |
| Behaviour | Run event stream | No idle timeout | 60 s of silence raises `APITimeoutError` with `lastEventId`; the caller's abort listener is released when the stream ends |
| Behaviour | History `status` | `ok` or `failed` | Also `pending` — from the moment a call starts costing something until its outcome is written — with `total_pending` and bucket `pending`; `failureRate()` leaves pending calls out |
| Behaviour | The key on the client | A plain property; `JSON.stringify(client)` contained it seven times | In `#private` fields; `util.inspect` and `JSON.stringify` show `sk_dsp_test_***`, and resource namespaces no longer expose the transport |
| Behaviour | Headers | A lowercase `x-api-key` or `idempotency-key` from the caller rode along as a second header; `Origin` / `Referer` were sent if given | `X-API-Key`, `User-Agent` and SDK-set headers win case-insensitively; `Origin`, `Referer` and a raw `X-SproutsData-Client` are refused (`ClientValidationError`) |
| Behaviour | Ids in paths | Interpolated as given | Percent-encoded, so `/` or `?` in an id cannot address another route |
| Behaviour | Caller request id | Only as a raw header, unchecked, resent on every page | `requestId` on every method's options, sent as `X-Request-Id`; it and a raw `X-Request-Id` must match `^[A-Za-z0-9_.:-]{1,128}$` (`ClientValidationError`), since the server silently replaces anything else. Page iterators send it with the first page only |
| Behaviour | `Idempotency-Key` on billed calls | Not sent | `sdk-<32 hex>`, generated once per call and resent on its retries; each page gets its own. The server recognises a same-day repeat with the same key that returns the same rows as already paid. A key you send in `headers` is used instead |
| Behaviour | **`prior_company`** | Sent; the server answered 422 | Refused locally (`ClientValidationError`) with `employment_history` named, in `search` / `similar` `filters` and in `filterValues`, `iterFilterValues` and `documentFilterValues`. Still declared, `@deprecated`, so old code compiles |
| Behaviour | Class names in the build | Some renamed by the bundler: `APIError.name` and `err.name` were `_APIError` | Kept as written (`keepNames`), in the ESM and CJS builds of every package |
| Tools | Model tools | Only in the adapter packages, each with its own copied schema and shaping | `sproutsdata/tools` (see Added): the three Sprouts MCP tools, byte-identical in results with the Python SDK |
| Package | Vercel AI SDK adapter | `@sproutsdata.ai/ai-sdk` 0.1.1, depending on `@sproutsdata.ai/sprouts-js-sdk` and `zod`, on Node.js 18 or later | `@sproutsdata.ai/ai-sdk` 0.2.0, rebuilt over `sproutsdata/tools`, with `sproutsdata` `^0.4.0` and `ai` `^7` as peers, on Node.js `>=22.12.0` (its CommonJS build loads the ESM-only `ai` through require(esm)); its own table is in [`packages/ai-sdk/CHANGELOG.md`](../ai-sdk/CHANGELOG.md) |
| Package | LangChain adapter | `@sproutsdata.ai/langchain` 0.1.1, depending on `@sproutsdata.ai/sprouts-js-sdk` and `zod` | `@sproutsdata.ai/langchain` 0.2.0, rebuilt over `sproutsdata/tools`, with `sproutsdata` `^0.4.0` and `@langchain/core` `^1` as peers; its own table is in [`packages/langchain/CHANGELOG.md`](../langchain/CHANGELOG.md) |
| Package | OpenAI Agents SDK adapter | `@sproutsdata.ai/openai-agents` 0.1.1 | **Removed** (never published): a recipe over `sproutsdata/tools`, and the MCP route beside it, in [`docs/integrations/openai-agents.md`](../../docs/integrations/openai-agents.md) |
| Docs | Long-form guide | `packages/sdk/USER_GUIDE.md` | [`docs/`](../../docs/README.md), one page per area, with type-checked [`examples/`](../../examples/) |

The removed adapter copied the same schema, translation and shaping layer as
the other two, and the copies had drifted; `sproutsdata/tools` now holds that
layer once.

### Added

- `sproutsdata/tools` (a new subpath export, ESM and CJS): the three Sprouts
  tools — `sprouts_search`, `sprouts_similar`, `sprouts_entity_lookup` — for
  any model that calls functions, built from the shared `spec/tools/` and
  byte-identical in results with the Python SDK's `sproutsdata.tools` (the
  `spec/tools/fixtures/` cases run in both). `Toolset` has `definitions()`,
  `openai({ strict, api: 'chat' | 'responses' })`, `anthropic()`,
  `run(name, args)`, `handleOpenAIToolCalls(message)`,
  `handleAnthropicToolUse(message)` and `toolNames`; `definitions()`,
  `openai()` and `anthropic()` also work without a client, and `toJson()` gives
  the canonical text a model is handed. Options `include`, `fixed`, `defaults`,
  `maxResults` (1–25), `baselineFilters` (merged per key) and `integration`.
  Invalid model input and API failures come back as
  `{ error: { code, message, retryable, retry_after, field_errors, request_id } }`;
  401, 403 and 402 are thrown. A search whose `filters` is empty once nulls are
  removed, or whose `query` is only whitespace, counts those as absent. No
  provider SDK is imported, and the SDK still has no runtime dependencies.
  A toolset accepts a client from a second copy of the SDK (another installed
  version, or the CommonJS build beside the ES module one) and recognises its
  errors by `name` and `status`.
- `integration` client option: `<name>/<version>`, sent as
  `X-SproutsData-Client` so a framework's traffic can be told apart. Toolsets
  send `js-tools/<version>` unless one is set.
- `client.withOptions({ timeoutMs, maxRetries, defaultHeaders, integration })`
  — a copy with different settings, same key, base URL and `fetch`; the
  original is unchanged. Also `client.integration` and the
  `SproutsDataCopyOptions` type.
- `client.iterFilterValues(name, params?)` and
  `client.iterDocumentFilterValues(category, name, params?)` — async
  iterators over every value a filter accepts, walking the fixed 20-value
  pages from page 1 until `has_more` is false (or a page comes back empty).
- `client.members.resolve(email)` — `POST /v1/members/resolve`: whether one
  email belongs to a member of the key's organisation (`MemberResolveResponse`,
  `MemberState`). `found: false` is an answer, not an error. Free.
- `DEFAULT_BASE_URL` is exported.
- Error classes `FeatureNotAvailableError` (501), `ServiceUnavailableError`
  (503), `UpstreamTimeoutError` (504), `RequestTooLargeError` (413),
  `CursorInvalidError` / `CursorExpiredError` / `PaginationDepthExceededError`
  (subclasses of `InvalidRequestError`), `APIResponseValidationError` and
  `RunWaitTimeoutError`.
- `APIError.fieldErrors` (from `extra.errors`) and `APIError.retryAfter`;
  `InsufficientCreditsError.available` / `.required` / `.actionType`;
  `APIConnectionError.reachedServer`; `APITimeoutError.timeoutMs` /
  `.lastEventId`.
- `lookupRef(hit)` — the `{ by, value }` that looks a search hit up on
  `entities.companies` / `entities.persons` (a search id is not a lookup key).
- `failureRate(metrics)` — `failed / (ok + failed)` for a history metrics
  response or bucket, `null` when nothing has finished.
- Paging options on every `*Pages` iterator: `{ limit, maxResults }` beside
  the per-call options.
- `Envelope.truncated`, set by the SDK from a `pagination_truncated`
  degradation.
- `SnapshotState` gains `'continuation'`: a later page of a paginated search,
  charged and listed like any run, whose snapshot only the first page stores.
- `b2b_b2c` in `DiscoverFilters` and `FilterName`; `payment.topup_not_found`
  in `ErrorCode` (42 codes, generated from the shared spec).
- Record types (`CompanyRecord` with 61 fields, `PersonRecord` with 63, and
  every nested model) are generated from the shared OpenAPI document and keep
  an open index signature for fields added later.
- `ResponseMeta.credits_charged` and `AskEnvelope.credits_charged`: what each
  billed response cost, in credits to at most three decimals, under the API's
  per-result pricing.
- `listing_status` and `stock_exchange` in `DiscoverFilters` and `FilterName`.
- `client.lists` (free): `list`, `create`, `rename`, `delete`, `items` /
  `iterItems`, `addItems`, `removeItems` and `export`, over `/v1/lists`. Items
  are `{ entity_category, entity_id }`, named by their natural id. Types
  `ItemRef`, `SavedList`, `ListsResponse`, `SavedItem`, `ListItemsResponse`,
  `AddItemsResponse`, `RemoveItemsResponse` and `CsvExport`. List create and
  delete are `once` routes and the export is `billed` (free today, priced
  through the meter once export pricing ships); everything else on lists is
  retried like a read. Items read back can be passed straight to `addItems` /
  `removeItems`: only `entity_category` and `entity_id` are sent.
- `client.searchExport({ items, request_id? })` → `CsvExport` (`POST
  /v1/search/export`). Both exports answer `NotFoundError`
  (`export.not_enabled`) until export is switched on.
- `client.feedback.votes.cast()` / `.list()` (`PUT` / `GET /v1/feedback/votes`):
  a like or dislike on a whole answer, or a flag on one record. Free and
  idempotent. Types `VoteCastParams`, `VoteView`, `VoteCastResponse`,
  `VoteListResponse`.
- `feedback.create({ context: 'help', … })`: a problem report about the
  product; `subject_ref` is optional with it, and it needs a `comment` or
  `tags`.
- `keyword_query` on `company` searches and the `KeywordQuery` type: keyword
  search over company text as an AND / OR / NOT tree, echoed in
  `ResolvedSearch.keyword_query`. Rolling out; a deployment without it answers
  422.
- `years_worked` in `DiscoverFilters` and `FilterName`; `global_presence` and
  `seniority` in `DiscoverSortField`.
- On `relationships.ask` answers: `breakdown` (`Breakdown`, `BreakdownGroup`)
  and `share` (`Share`) on relationship-shaped answers, `seeds` (`SeedReach`)
  and `targets` (`ReachTarget`) on reach-shaped ones, and `ReachHit.reached_by`
  / `target_index`.
- `TermsFilter.include_groups`, `GlobalPresenceFilter.countries` and
  `match_all`, and `AgentRunResult.effort` / `effort_ran`, which the API
  already sent.
- `ColumnSource`: `EnvelopeColumn.source` is typed as the `{kind, corpus,
  field}` object the API sends for agent-run columns (it was typed as a
  string); a plain string is still accepted.
- `ConflictError` (409) and eleven more `ErrorCode`s (53 in all, generated from
  the shared spec): `lists.*`, `export.not_enabled`, and the dashboard-only
  `journey.unavailable`, `enrichment.unavailable`, `cohort.*`, `referral.*`
  and `rate_limits.unavailable`.
- Every request sends `X-Dsp-Source: sdk/js`, which the API reads to count SDK
  traffic. It cannot be overridden.

### Changed

- Credits follow the API's per-result pricing: the docs, the tool specs and the
  docstrings state what each call costs, that a call is charged only once its
  answer is ready (so an error is never charged, and nothing is refunded), and
  that the server recognises a same-day retry with the same `Idempotency-Key`.
  The retry policy is unchanged: a billed call that may have reached the server
  is raised, never repeated.
- The server's default page size is 10, which the docs now use.
- **`corporate_parent` is removed** from `DiscoverFilters` and `FilterName`: the
  API no longer accepts it and refuses it with a 422.
- **`updated_after` is removed** from the search parameters, and
  **`employment_status`** from `DiscoverFilters` and `FilterName`: the API
  dropped both from its contract.
- **`SimilarParams.category` is `'company'`**, the only category the API offers
  look-alikes for.
- `search` accepts `keyword_query` as its intent: a request needs `query`,
  `filters` or `keyword_query`.
- A `204` resolves to `undefined` (`lists.delete`), and the transport sends
  `PUT`, `PATCH` and `DELETE` with a body.
- The docs give the current scopes (any one listed scope is enough), say that
  `runs.cancel` needs `dsp.agents.write` and that a run whose hold lapsed
  reports `credits_charged: 0`, document the API's per-operation rate limits
  and `X-RateLimit-*` headers, and explain `Idempotency-Key` on billed calls
  (one billing session per UTC day, not a replay).

## 0.2.0

Parity with the DSP v1 contract as of 2026-09-15. Additive only: no exported
symbol, method, parameter, or field was removed or renamed.

### Search

- `SearchParams.sort` — up to 3 `SortClause`s (`{ field, direction? }`),
  strongest key first; requires an explicit `category`. `DiscoverSortField`
  (24 names) types the `company` / `person` vocabulary; document categories
  pass their own names through. The SDK checks shape locally (count, field
  length, `asc`/`desc`, no duplicates) and leaves vocabulary to the server.
  `MAX_SORT_CLAUSES` is exported.
- `client.sorts(category)` — `GET /v1/sorts/{category}`, the live sort
  catalogue (`SortCatalogResponse` / `SortFieldInfo` with labels, kinds,
  default directions, `applies_to`, `direction_labels`). Free.
- `ResolvedSearch.sort` echoes the ordering actually applied.
- The envelope gains `suggestion` (`SearchSuggestion` — a better `category`,
  or "use an agent run") and `columns` (`EnvelopeColumn[]` — the extra
  columns an answer table carries). Both are always present and null in the
  common case. `Degradation.reason` documents the twelve current reasons.

### Filters

- Filters v3: `DiscoverFilters` / `FilterName` gain `governance_level`,
  `employment_type`, `has_direct_access_to_c_suite` (`TermsFilter`) and
  `employment_history` (`EmploymentHistoryFilter` over
  `EmploymentHistoryGroup` — one group per past job). 52 live names.
- `prior_company` is **deprecated**: retired server-side and now refused with
  a 422. It stays declared so existing code compiles; use
  `employment_history` with one group.
- `client.filterValues` accepts `parent` and `level` (`'parents' |
  'children'`, mutually exclusive) for the two-level filters (`industry`,
  `sub_industry`, `department`). `FilterValuesLevel` is exported.
- `client.documentFilterValues(category, name, …)` —
  `GET /v1/search/filters/{category}/{name}`, a document category's own
  filter vocabulary (`DocumentFilterValuesResponse`). Refuses `company` /
  `person` locally. Free.

### Relationships

- `client.relationships.institutions(params)` —
  `POST /v1/relationships/institutions`: the employers and schools two
  companies share, with per-side counts, without a ranked page of people.
  Exactly two companies (order matters), `institution_type`,
  `min_people_per_side` (1–100), `name_starts_with` (prefix), `limit`
  (1–1000). Not paginated: `SharedInstitutionsEnvelope.truncated` is the
  field to branch on.
- `client.relationships.ask(params)` / `askPages` —
  `POST /v1/relationships/ask`: a relationship question in words, routed to
  one of five shapes and returned as an `AskEnvelope` (`route`, `reading`,
  and exactly one of `relationships` / `reach` / `institutions` / `compare`
  / `fan_out`). `askPages` follows the populated slot's cursor; only
  `relationships` pages today.
- `ReachEnvelope.institutions` (`ReachInstitution[]`, with
  `people_at_target`) — every institution the anchor shares with the target,
  across all pages.

### Org charts

- `client.orgChart.get / departments / locations` — `POST /v1/org-chart`,
  `/departments`, `/locations`: one company's people counted by department ×
  seniority, by sub-department, and by country → state → city. Company by
  `domain` or `linkedin_url` (exactly one; the SDK refuses `/in/` and
  `/school/` URLs), location filters ≤ 50 per level, `governance_level`,
  `employment_type`, `has_direct_access_to_c_suite`, `include_others`,
  `search` on locations. `UNKNOWN_LOCATION` is exported. Billed per request;
  501 `not_implemented` where the upstream is not wired.

### Feedback

- `client.feedback.create / list / tags` — `POST /v1/feedback`,
  `GET /v1/feedback` (offset-paginated), `GET /v1/feedback/tags`. Report a
  result or result set against one of your own requests (`meta.request_id`)
  or agent runs (`run_id`) with tags, a comment, and an expected correction;
  list your reports; read the versioned tag vocabulary. Structural rules are
  checked locally (subject/target kinds, `entity_id` iff `result`, ≤ 10
  tags, `other` needs a comment, expected lists ≤ 200, `limit` 1–200); the
  vocabulary itself stays on the server. Free.

### History

- `HistoryActionType` grows from 5 to 13 members (`dsp.relationships`,
  `dsp.relationships.ask`, `dsp.org_chart`, `dsp.agent.run.{minimal,low,
  medium,high,xhigh}`), and `history.list` accepts an array of them
  (repeated query key; the server de-duplicates and sorts).

### Records

- `TrendRecord` gains the fifteen derived-analytics groups the server now
  serialises (`signals`, `scale`, `market`, `badges`, `industries`,
  `countries`, `features`, `biggest_investors`, `similar_tags`,
  `publications`, `graphs`, `patent_stats`, `search_interest`, `snapshot`,
  `distributions`), fully typed as `Trend*` interfaces.

### Errors

- `ErrorCode` gains `relationship.anchor_ambiguous` (422),
  `feedback.subject_not_found` (404), `feedback.unavailable` (503), the five
  dashboard sign-in codes (`auth.invalid_credentials`, `auth.account_exists`,
  `auth.session_required`, `auth.csrf`, `auth.mfa_required`), and the five
  `payment.*` codes. No new error classes: dispatch is by status.

### Compatibility

- `Envelope` gains two always-present fields (`suggestion`, `columns`) and
  `ResolvedSearch` gains `sort`. Hand-built envelope literals in tests need
  them; the wire is unaffected.
- The `Transport` query builder (internal) repeats a key for array values.
- Bearer delegation tokens are now accepted on `/v1` server-side; this SDK
  remains API-key only.

## 0.1.0

Initial release — the full API-key surface of the DSP v1 API.

### Search & discovery

- `DspClient.search` / `similar` with `searchPages` / `similarPages`
  cursor-pagination iterators. `category` is optional on search — omit it
  (with `mode: 'auto'`, `query` only) for server-side auto-classification.
  `mode: 'deep'` runs an exhaustive, coverage-measured search returning a
  single non-paginated page.
- Fully typed `filters` for `company`/`person`: the `DiscoverFilters`
  vocabulary (~46 filters over `TermsFilter`, `RangeFilter`, `DateBound`,
  `EntityFilter`, `TextFilter`, `GeoFilter`, and friends). Document
  categories keep free-form filter dicts. `similar` accepts typed `filters`
  too.
- `client.filterValues(name, …)` — `GET /v1/search/filters/{name}`, the
  vocabulary behind each filter (autocomplete/picker source).
- `client.coverage(…)` — `GET /v1/coverage`, per-corpus counts, embedding
  coverage, and `not_in_index`.
- The response envelope carries `coverage` — measured recall (`universe`,
  `enumeration_recall`, `universe_exhausted`, `constraints_unmet`,
  `similarity`, `linkage`, …), populated for deep searches and agent runs.

### Entities

- **`client.entities.*`** — nine methods wrapping the
  `POST /v1/entities/{category}` routes (scope `dsp.entities.read`, billed
  per requested id): `companies`, `persons`, `patents`, `news`, `trends`,
  `marketReports`, `fundings`, `academicReports`, `jobOpenings`.
  - Every hit's `matches` is a list: exactly one record for id lookups,
    `[]` on a miss (`found: false` — misses are returned, never dropped).
  - `companies` / `persons` accept `by` (`auto` / `domain` / `li_url` /
    `name`; no `domain` for persons) to resolve raw identifiers, capped at
    50 per call.
  - `news` / `marketReports` / `fundings` / `jobOpenings` accept
    `by: 'id' | 'name'`. The SDK defaults to `'id'` and always sends the
    field explicitly (the server's own default is `'name'`), so ids from
    search results keep working unchanged; name lookups can return several
    `matches` per entry and are capped at 50.
  - Local structural validation mirrors the server's ceilings: 1–1000 ids
    (companies/persons), 1–100 ids (document categories), ≤ 50 with `by`
    resolution or name lookup.
  - Fully typed records: `CompanyRecord`, `PersonRecord`, `PatentRecord`,
    `NewsRecord`, `TrendRecord`, `MarketReportRecord`, `FundingRecord`,
    `AcademicReportRecord`, `JobOpeningRecord` (all exported, with their
    nested shapes), mirroring the backend's explicit field allowlists.

### Relationships

- `client.relationships.find` / `findPages` — `POST /v1/relationships`:
  people at one company connected to another (`between_companies`), or
  affiliated with named institutions (`via_institution`), by structured
  fields or a plain-words `query`. Rows carry why they matched (`via`,
  ranked `match_type` phrases, tenure-overlap contact counts); the envelope
  adds the bridging `institutions` and the `connection_basis` in force.
- `client.relationships.reach` / `reachPages` —
  `POST /v1/relationships/reach`: who one person (by LinkedIn URL) can
  reach at a target company, with per-connection overlap details.

### Agent runs

- `client.agents` — the `/v1/agents/runs*` surface: `createRun` (requires a
  caller-supplied `idempotencyKey`, sent as `Idempotency-Key`; retry-safe by
  construction), `getRun`, `listRuns`, `cancelRun`, `results` /
  `resultsPages`, `events` (SSE), and `waitForRun`.
- `events` streams typed `AgentRunEvent`s over server-sent events, absorbs
  heartbeats, and resumes from a drop via `lastEventId` (`Last-Event-ID`).
  No mid-stream auto-reconnect by design.
- `waitForRun` polls to a terminal status and returns the settled result —
  reading a finished run is what settles billing, so `credits_charged` is
  real there (and null while running, never 0).

### Usage, history, credits

- `client.usage` — `GET /v1/keys/usage`, the calling key's spend.
- `client.history` — `list` / `listPages`, `get(runId)` (one run plus its
  replayable `snapshot`, with `snapshot_state` saying why a null is null),
  and `metrics` (daily rollups). All free.
- `client.credits` — `GET /v1/credits`, the tenant's balance on this
  platform.

### Foundation

- Typed RFC 9457 error hierarchy with the closed `ErrorCode` set (including
  `history.not_found` and the `idempotency.*` conflict codes).
- Retries with exponential backoff + jitter honoring `Retry-After`
  (429/502/503/504 and connection failures), per-attempt timeouts,
  caller `AbortSignal` support. For SSE, retries/timeout cover only the
  connection phase.
- Browser guard: refuses to construct in a browser unless
  `dangerouslyAllowBrowser` is set (mirrors the API's `auth.browser_origin`
  refusal).
- Zero runtime dependencies; ESM + CJS + TypeScript types; Node ≥ 18.

# API contract changelog

A human record of what moved in the Sprouts Data Platform API and what each SDK
had to do about it. Written when `spec-drift.yml` fires, or when the backend team
announces a change.

`openapi.json` is the pinned snapshot the SDKs are built against (it was
`specs/openapi.v1.json` before 2026-10-01). Refresh it from production with:

```bash
python scripts/check_spec_drift.py --update
```

or, for an unreleased backend branch, with that branch's
`scripts/export_openapi.py`, which renders the same document offline.

---

## 2026-10-27 — the org chart follows One Platform's

Snapshot updated from the dsp-backend `feat/dsp-org-chart-on-op` export, rendered
offline with that branch's `scripts/export_openapi.py`. **Only the three org-chart
paths and the `OrgChart*` schemas were taken**; the rest of the snapshot is
unchanged, so unrelated drift on that branch (enrichment, lists and the rest) is
left for its own refresh.

Breaking, needing SDK work (done in both SDKs):

- `POST /v1/org-chart`, `/departments` and `/locations` mirror One Platform's org
  chart. Requests carry one `filters` object (`locations.include` / `exclude` of
  `{level, value}` places, `governance_levels`, `employment_types`,
  `c_suite_access`, `job_titles`, `text`, `search_mode`); the grid adds `metrics`
  and `include_suspects`, the departments view `include_suspects`. Gone:
  `country`, `state`, `city`, `governance_level`, `employment_type`,
  `has_direct_access_to_c_suite`, `include_others` and the locations `search`.
- Responses carry `{code, label}` values, axis entries with `total` and
  `unknown`, cells with `badges`, `subdepartments`, a section `state`,
  `coverage` and `matched`; the location tree is `items` of
  `{level, value, label, count, unknown, children}`. Schemas: the eight kept names
  changed (`OrgChartRequest`, `OrgChartResponse`, `OrgChartDepartmentsRequest`,
  `OrgChartDepartmentsResponse`, `OrgChartLocationsRequest`,
  `OrgChartLocationsResponse`, `OrgChartCell`, `OrgChartCompany`);
  `OrgChartCity`, `OrgChartCountry`, `OrgChartDepartment`, `OrgChartState` and
  `OrgChartSubDepartment` removed; fifteen `OrgChart*` schemas added.
- Counting changed with it: each person once, at their most senior level, and in
  every department they hold.

`routes.json` and `surface-map.json` are unchanged: same routes, same methods.

---

## 2026-10-14 — saved lists, export, votes, keyword search and rate limits

Snapshot refreshed from the dsp-backend `QA` export (348f53d), rendered offline
with that branch's `scripts/export_openapi.py`. Production (`main`, 0feed5c)
serves all of it except `keyword_query` and the rate limiter.

New routes, needing SDK work (done in both SDKs):

- Saved lists: `GET`/`POST /v1/lists`, `PATCH`/`DELETE /v1/lists/{list_id}`,
  `GET`/`POST`/`DELETE /v1/lists/{list_id}/items` (the `DELETE` takes a body)
  and `POST /v1/lists/{list_id}/export`. Free. `routes.json` classes them
  `safe` (reads, rename, item add and remove: a repeat changes nothing),
  except create and delete, which are `once`, and the export, which is
  `billed`.
- `POST /v1/search/export`: chosen records as CSV. Both exports return
  `text/csv`, not JSON, and answer `404 export.not_enabled` while export is
  switched off — which it is on QA and production. They are free today, but
  the server already routes them through the meter (`X-Credits-Charged`) for
  when export pricing ships, so both are `billed`: a lost answer is not
  repeated, and each call carries an `Idempotency-Key`.
- `PUT`/`GET /v1/feedback/votes`: likes, dislikes and flags. Free; a repeat is
  idempotent, so `safe`.
- `surface-map.json` gains the `lists`, `search_export` and `feedback_votes`
  groups.

Request contract, needing SDK work (done in both SDKs):

- `SearchRequest.keyword_query`: an AND / OR / NOT keyword tree over company
  text; echoed in `ResolvedSearch.keyword_query`. QA only for now.
- `SearchRequest.updated_after` left the contract (the server still answers
  501 if it is sent). Removed from both SDKs.
- `DiscoverFilters.employment_status` and `FilterName.employment_status` are
  removed (a 422 now); `years_worked` (a `RangeFilter`, whole years) is added.
- `FeedbackRequest.subject_ref` is optional when the new `context` is `"help"`.
- `SimilarRequest.category` is published as `["company"]` only.
- `RunRequest.category` and `effort` are enums rather than patterns. Same values.
- `Idempotency-Key` is declared on every billed route and required on run
  creation, as the SDKs already sent it. Cancelling a run needs
  `dsp.agents.write`.

Errors, needing SDK work (done in both SDKs):

- Eleven new codes; `error-codes.json` now mirrors all 53. A new concept,
  `conflict`, covers a 409 that is not about idempotency
  (`lists.item_cap_reached`, and the dashboard-only `cohort.not_offered` and
  `referral.already_claimed`). Each SDK's idempotency-conflict class is now a
  subclass of its conflict class; the `409` status fallback stays
  `idempotency_conflict`, so a codeless 409 is caught exactly as before.
- `docs_base` moves to `https://dashboard.sproutsdata.ai/errors/`, as the
  server's `type` URLs did.
- `quota.burst_exceeded` is real now: per-workspace, per-operation limits in
  one-minute windows, with `Retry-After` and `extra.{limit,window,operation}`.
  Counted responses carry `X-RateLimit-Limit`, `-Remaining` and `-Reset`. The
  retry decisions are unchanged.

Absorbed with no SDK work beyond typing: relationship answers' `breakdown`,
`share`, `seeds`, `targets`, and `ReachHit.reached_by` / `target_index` (typed in
both SDKs); every route's new `429` and `x-scopes`; the hidden dashboard routes,
which neither SDK wrapped.

Conformance: `envelope/sdk-source-header.json` (every request carries
`X-Dsp-Source`), `errors/list-item-cap-is-a-conflict.json`,
`errors/export-not-enabled-is-not-retried.json` and
`retry/once-list-create-internal-error-is-not-retried.json`. The fixtures' error
`type` URLs use the new base, and `errors/not-implemented.json` no longer cites
`updated_after`.

## 2026-10-06 — per-result pricing (Model A), and the filter vocabulary

Snapshot refreshed from the dsp-backend `feat/new-credits-system` export.

Pricing, absorbed by the SDKs:

- `ResponseMeta.credits_charged` and a top-level `AskEnvelope.credits_charged`:
  what each billed response cost, in credits to at most three decimals. Both
  SDKs type the field.
- Every credit amount is a number to three decimals (`0.595`), not an integer.
  The SDKs already read decimals.
- The default `limit` on search, look-alikes and relationships is 10 (was 25).
- `PurchaseRequest` takes `amountUsd` and `currency`; `PurchaseResponse` gains
  `bonus_percent`. Dashboard-only routes; no SDK change.
- `retry-policy.json`, `error-codes.json` and the tool messages no longer say a
  failure is refunded: a billed call is charged only once its answer is ready,
  so an error is never charged. The retry decisions themselves are unchanged.
- Conformance: `errors/insufficient-credits.json` reads "1 credit" in the
  singular, as the API now writes it, and the new
  `errors/insufficient-credits-fractional.json` pins a 402 whose `required` and
  `available` are fractions of a credit. The descriptions of
  `retry/billed-read-timeout-is-not-retried.json` and
  `retry/service-unavailable-then-success.json` say why, under the new charge order.
- Tool specs state each tool's price.

Filters, needing SDK work (done in both SDKs):

- `corporate_parent` is removed from `DiscoverFilters` and `FilterName`.
- `listing_status` and `stock_exchange` are added.

Absorbed with no SDK work: `GlobalPresenceFilter.countries` and `match_all`,
`TermsFilter.include_groups`, `ResolvedSearch.semantic_scope`, and
`RunResult.effort` / `effort_ran`.

## 2026-10-01 — conformance: request ids and billed idempotency keys

No API change. Two new cases and three new runner keys, which both SDKs'
runners implement (`conformance/README.md`):

- **`request_id`** (case key): the caller's request id, passed on the first call
  only.
- **`expect.sent[i].headers_equal`**: `{header: exact value}`, names matched
  case-insensitively.
- **`expect.sent[i].same_header_as_index`**: `{"header", "index"}`; request `i`
  carries the header, non-empty, with request `index`'s value.
- `pagination/caller-request-id-is-not-carried-to-page-two.json` pins contract
  §6: page 1 sends the caller's `X-Request-Id`, page 2 sends none.
- `retry/billed-reuses-one-idempotency-key-across-retries.json` pins §4: a
  billed call that is retried after a `503` resends the same generated
  `Idempotency-Key`.

The Python runner now also refuses an `expect.sent` key it does not know, as it
already did for every other part of a case.

## 2026-10-01 — tool specs: `constraints_unmet` fixture

New: `tools/fixtures/search_constraints_unmet.json`. `coverage.constraints_unmet`
is a list of strings (`app/schemas/envelope.py`), each the query's own words;
each entry becomes one `constraint_unmet: <words>` caveat. The Python SDK typed
the field as a list of objects and refused every page that carried one.

## 2026-10-01 — snapshot refreshed (descriptions only)

`openapi.json` re-exported from the backend branch after a description-only
correction: the `by` text on the named-document lookups (news, market reports,
fundings, job openings) no longer says a search hit's `id` is a prism id. No
schema, field or route changed; `types/records.py` is unaffected.

## 2026-10-01 — tool specs

New: `tools/`, the three model tools both SDKs' `tools` modules are built from
(contract 02 §12): `sprouts_search.json`, `sprouts_similar.json`,
`sprouts_entity_lookup.json`, plus `shaping.json`, `messages.json`, parity
fixtures and a README. No API change.

- **Input schemas** are the Sprouts MCP server's (`dsp-mcp`
  `packages/core/src/tools/{search,similar,entities}.ts`), aligned to the API
  branch: the curated filters gain `b2b_b2c`, `technology`, `governance_level`
  and `employment_type` (all `DiscoverFilters` keys), and every object refuses
  unknown keys. The MCP server's trap parameters (`page`, `offset`,
  `updated_after`, and `category` on look-alikes) are refused by name through
  `refused_arguments` rather than declared as properties.
- **Descriptions** use the live vocabulary (the seven seniority levels,
  `Software & Technology`, `Engineering / Software`) and tell the model to look
  a row up by its domain or LinkedIn URL. The MCP server's lookup description
  still says search ids can be passed; that is for the MCP owners to align.
- **`strict_input_schema`** is generated by `scripts/gen_tool_schemas.py` for
  OpenAI strict mode, with `maxLength`, bounds and defaults moved into the
  descriptions.
- **Lookups of the four named document categories** always send `by` (`id` by
  default): the API's own default for those routes is `name`.

---

## 2026-10-01 — `spec/` directory, members resolve, top-ups, fuller records

The contract files moved into one directory, `spec/`: `openapi.json` (was
`specs/openapi.v1.json`), `error-codes.json`, `conformance/`, and four new data
files — `routes.json`, `retry-policy.json`, `surface-map.json`,
`defaults.json` — that the JS SDK vendors alongside them.

Snapshot refreshed via `scripts/export_openapi.py` from the API service's
`SDK-Review-fixes` branch at `36accb9` (the QA tip, including PR #101) plus
description-only edits. Service version still reads `0.1.0`.
**55 changes: 1 the SDK has to act on, 54 absorbed by design.**

### New routes

| Method | Path | SDK | Billed |
|---|---|---|---|
| POST | `/v1/members/resolve` | `members.resolve` (Python 0.4.0) | free |
| POST | `/v1/billing/top-up/intents` | not wrapped — a browser purchase flow | free |
| GET | `/v1/billing/top-up/intents/{topup_id}` | not wrapped | free |
| GET, PUT | `/v1/billing/auto-topup` | not wrapped — session only | — |

### Needs SDK work

- `SubjectRef.id` `maxLength` 64 → 128 (and 64 only when `kind=agent_run`).
  The Python SDK mirrors 64 locally and so refuses valid ids; the fix is to stop
  mirroring the bound (contract §11), not to copy the new one.

### Absorbed, worth knowing

- New error code `payment.topup_not_found` (404, `not_found`), added to
  `error-codes.json`.
- New filter `b2b_b2c` (`FilterName`, `DiscoverFilters`). A raw dict filter
  reaches it today; the SDK constants and typed builders have to add it
  (`tests/test_contract.py` fails until they do).
- `CompanyRecord` gains 30 fields and `PersonRecord` 13 (complete records, PR
  #101). Response models keep unknown fields, so nothing breaks; the generated
  `types/records.py` has to be regenerated from this snapshot
  (`scripts/gen_python_records.py --check` fails until it is).
- History metrics gain `total_pending` and a per-bucket `pending`.

---

## 2026-09-15 — ten new key-authenticated routes, two response shapes changed

Refreshed from the QA branch of the API service at commit `aeaf655`
(2026-09-14) via `scripts/export_openapi.py` — the same document the
deployment serves at `/openapi.json`. Service version still reads `0.1.0`.
**160 changes: 45 the SDK had to act on, 115 absorbed by design.**

Wrapped in Python SDK `0.3.0`.

### New routes

| Method | Path | SDK | Billed |
|---|---|---|---|
| POST | `/v1/relationships/reach` | `relationships.reach` | yes (`dsp.relationships`) |
| POST | `/v1/relationships/institutions` | `relationships.institutions` | yes (`dsp.relationships`) |
| POST | `/v1/relationships/ask` | `relationships.ask` | yes (`dsp.relationships.ask`) |
| POST | `/v1/org-chart` | `org_chart` / `org_chart.retrieve` | yes (`dsp.org_chart`) |
| POST | `/v1/org-chart/departments` | `org_chart.departments` | yes |
| POST | `/v1/org-chart/locations` | `org_chart.locations` | yes |
| GET | `/v1/sorts/{category}` | `search.sorts` | free |
| GET | `/v1/search/filters/{category}/{name}` | `search.document_filter_values` | free |
| POST | `/v1/feedback` | `feedback.create` | free |
| GET | `/v1/feedback` | `feedback.list` | free — offset-paginated |
| GET | `/v1/feedback/tags` | `feedback.tags` | free, unauthenticated |

Also added, and **not** wrapped, all session-authenticated: nine `/v1/auth/*`
routes (`activate`, `check-domain`, `forgot-password`, `organizations`,
`request-access`, `reset-password`, `sso/land-tokens`, `teams/join-requests`,
`teams/joinable`), six `/v1/billing/*` routes, `/v1/oauth/consent`,
`/v1/slack/install-ticket`, `/v1/transcribe`. Each is listed in
`tests/test_contract.py::SESSION_ONLY_ROUTES` with its reason.

### Breaking on the wire, absorbed by the SDK

These are the changes that broke 0.2.0 at runtime, and how 0.3.0 reads both
shapes.

| Schema | Change | SDK |
|---|---|---|
| `EntityHit[*]` | `fields`, `field_provenance` removed; `matches: list[Record]` added | `matches` read; `fields` filled from `matches[0]`, deprecated |
| `RelationshipHit` | `connection_score`, `shared_institution_count`, `currently_there` removed; `match_reason_count`, `match_type`, `number_of_contacts_overlapping_tenure_with`, `currently_at_target` added | score optional; old names filled from new; new names typed |
| `ViaInstitution` | `match_type` required; `started`, `ended`, `role` added | typed, defaulted |
| `RelationshipRequest` | `viewer` removed; `RelationKind.from_my_company` removed; `connection_basis` added | refused locally with a `DeprecationWarning`; member kept |
| `DiscoverFilters` / `FilterName` | `prior_company` removed; `employment_history`, `governance_level`, `employment_type`, `has_direct_access_to_c_suite` added | `PRIOR_COMPANY` kept deprecated; builders added |
| Records | 6 nested models and 12 fields removed (see `scripts/gen_python_records.py::RETIRED_*`) | still emitted, marked retired |

### Changes to existing routes

- **`SearchRequest.sort`** — up to three `SortClause`s; `ResolvedSearch.sort`
  echoes them. The server also tightened `RelationshipRequest`: `companies`
  beside `query` is refused, `between_companies` needs exactly two companies,
  `via_institution` exactly one plus an institution, `institutions_combine="all"`
  two or more institutions. Mirrored locally.
- **Envelope** gains `suggestion` (`SearchSuggestion`) and `columns`;
  `Coverage.similarity`; `RunResult.summary`, `exclusions`, `insight_sources`,
  `degradation`.
- **`GET /v1/search/filters/{name}`** gains `parent` and `level`
  (`parents|children`), mutually exclusive.
- **`GET /v1/usage/history`** `action_type` is a repeatable enum of thirteen
  values (adds `dsp.relationships`, `dsp.relationships.ask`, `dsp.org_chart`,
  `dsp.agent.run.{minimal,low,medium,high,xhigh}`).
- **Bearer delegation tokens** are accepted on `/v1` alongside keys. No SDK
  change: this library authenticates a key.

### New enums and members

`DegradationReason` +5 (`billing_bypassed`, `axis_not_applicable`,
`anchor_list_capped`, `planner_step_incomplete`, `upstream_advisory`).
Inline vocabularies the schema-diff cannot see, each pinned in
`tests/test_contract.py`: `SortDirection`, `connection_basis`, `AskEnvelope.route`,
`GovernanceLevel` (7), `EmploymentType` (5), feedback `kind`/`sentiment`,
history `action_type`. Two live only in the service's source and are pinned by
size: `DiscoverSortField` (24, `app/schemas/sorts.py`) and the feedback tag
vocabulary (11, v2, `app/feedback/tags.py`).

### New error codes

| Code | Status | Concept | Retry |
|---|---|---|---|
| `relationship.anchor_ambiguous` | 422 | invalid_request | no |
| `feedback.subject_not_found` | 404 | not_found | no |
| `feedback.unavailable` | 503 | service_unavailable | yes |
| `payment.invalid_amount` | 422 | invalid_request | no |
| `payment.forbidden` | 403 | permission_denied | no |
| `payment.unavailable` | 503 | service_unavailable | yes |
| `payment.declined` | 402 | insufficient_credits | no |
| `payment.no_method` | 409 | invalid_request | no |

The `payment.*` family is raised only by `/v1/billing/*`, which a key cannot
reach; it is mapped by meaning so `.code` still names the cause.

### Observed, not fixed here

`POST /v1/relationships/ask` issues a `next_cursor` only when the route is
`relationships`. For a `reach` answer the service computes `has_more` from its
upstream cursor but builds the sub-envelope with `next_cursor=None`, so
`has_more: true, next_cursor: null` is possible — the envelope invariant does
not hold there. The SDK pages on `next_cursor` and is unaffected; reported to
the service team.

---

## 2026-08-20 — eleven new key-authenticated routes

Refreshed from the QA deployment's `/openapi.json`, service
version `0.1.0`. **29 additive changes, zero breaking** — every route, field and
enum member from the 2026-08-13 snapshot is unchanged in shape and meaning.

Wrapped in Python SDK `0.2.0`.

### New routes

| Method | Path | SDK | Billed |
|---|---|---|---|
| POST | `/v1/relationships` | `client.relationships(...)` | yes |
| POST | `/v1/agents/runs` | `runs.create` | hold, settled on finish |
| GET | `/v1/agents/runs` | `runs.list` | free |
| GET | `/v1/agents/runs/{run_id}` | `runs.retrieve` | free |
| POST | `/v1/agents/runs/{run_id}/cancel` | `runs.cancel` | free — releases the hold |
| GET | `/v1/agents/runs/{run_id}/events` | `runs.events` | free (SSE) |
| GET | `/v1/agents/runs/{run_id}/results` | `runs.results` | free |
| GET | `/v1/usage/history` | `usage.history` | free |
| GET | `/v1/usage/history/{run_id}` | `usage.retrieve` | free |
| GET | `/v1/usage/metrics` | `usage.metrics` | free |
| GET | `/v1/search/filters/{name}` | `search.filter_values` | free |

Also added, and **not** wrapped: `GET /v1/members`, `GET /v1/members/roles`,
`PUT /v1/members/{user_id}/role`. Session-authenticated control-plane routes, like
`/v1/auth/*` and `/v1/keys` — a key cannot reach them, so a wrapper would only
ever produce `403`.

### Changes to existing routes

- **`SimilarRequest` gained `filters`** (`DiscoverFilters`). Anchors decide who is
  similar; filters decide which of those come back. Not an intent on their own.
- **`coverage` appears on the search envelope** and on `RunResult` — `universe`,
  `enumerated`, `universe_exhausted`, `truncated_by`, `linkage_coverage` and the
  rest. Absent means the server did not say, which is not the same as complete.
- **New error code `history.not_found`** (404), plus a `404 → not_found` status
  fallback in `error-codes.json`.

### New enums

`RelationKind`, `FilterName` (49 members), `GeoLevel`, `GeoScope`, `ResolveBy` are
named schemas. Two more are inline and so invisible to a schema-comparison test —
each needs its own check, and `tests/test_contract.py` has one:

- **`effort`** is a *pattern*, not an enum: `^(minimal|low|medium|high|xhigh|auto)$`.
  Six values. An SDK enum with only `low|medium|high` would refuse work the server
  accepts.
- **`institution_type`** is an inline `employment | education`.

### Two pagination shapes now, not one

`/v1/agents/runs/{run_id}/results` and `/v1/usage/history` are **GET**-paginated:
the cursor is a query parameter, not a body field. The signing rule is unchanged —
the cursor is still bound to a fingerprint of the request — so the frozen-request
discipline applies either way, it just has to go to the query string. An SDK that
assumed a body would silently drop the cursor on page 2.

### Behaviour worth knowing before wrapping runs

Drawn from the route descriptions rather than the schema, so it is recorded here:

- Creation is ordered so nothing irreversible precedes something reversible: the
  replay lookup, then the credit hold, then the engine call, with the run row
  written inside the hold. A crash between them leaves a hold that expires rather
  than a run nobody is charged for.
- Cancelling **releases** rather than settles. A run that had already finished
  stays finished and is charged; cancelling late is not a refund.
- Ownership on `/events` is checked *before* the stream opens, so an authorisation
  failure is a status code rather than an error frame inside a `200`.
- SSE frames are proxied unchanged, and their `id` is the engine's durable per-run
  sequence number — which is the only reason `Last-Event-ID` resumption works.
- `/results` is named in the server's own free-under-a-metered-prefix list rather
  than inferred from the path.
- `relation` cannot express "one person who worked at both A and B". The
  affiliation corpus denormalises a person's single current employer onto every
  edge, so such a query matches nobody; the server returns `422` rather than an
  empty page, because an empty page would read as "no such people".

---

## 2026-08-13 — initial snapshot

Captured from the QA deployment's `/openapi.json`, service
version `0.1.0`.

Public surface the SDKs cover:

| Method | Path | Scope | Billed |
|---|---|---|---|
| POST | `/v1/search` | `dsp.search.read` | yes |
| POST | `/v1/similar` | `dsp.search.read` | yes |
| POST | `/v1/entities/companies` | `dsp.entities.read` | yes |
| POST | `/v1/entities/persons` | `dsp.entities.read` | yes |
| POST | `/v1/entities/patents` | `dsp.entities.read` | yes |
| POST | `/v1/entities/news` | `dsp.entities.read` | yes |
| POST | `/v1/entities/trends` | `dsp.entities.read` | yes |
| POST | `/v1/entities/market-reports` | `dsp.entities.read` | yes |
| POST | `/v1/entities/fundings` | `dsp.entities.read` | yes |
| POST | `/v1/entities/academic-reports` | `dsp.entities.read` | yes |
| POST | `/v1/entities/job-openings` | `dsp.entities.read` | yes |
| GET | `/v1/coverage` | `dsp.search.read` | free |
| GET | `/v1/credits` | `dsp.usage.read` | free |
| GET | `/v1/keys/usage` | `dsp.usage.read` | free |

Deliberately **not** wrapped: `/v1/auth/*` and `POST|GET|DELETE /v1/keys`. Those
are dashboard-session routes secured by a cookie and CSRF token, not by a key —
a key cannot mint another key. They carry no compatibility guarantee.

### Differences from the design documents

Noted here because the planning docs and the `feat/v1-wrapper` branch describe an
earlier shape, and the deployed schema is what the SDKs must match.

- **`POST /v1/entities` no longer exists.** It was replaced by nine
  per-category routes, each returning a *typed* record rather than an open
  dictionary. `EntityCategory` is a path segment now, not a body field.
- **Typed record models exist** for all nine categories — `CompanyRecord` (31
  fields), `PersonRecord` (50), `PatentRecord` (15), `NewsRecord` (16),
  `AcademicReportRecord` (16), `JobOpeningRecord` (13), `FundingRecord` (10),
  `MarketReportRecord` (10), `TrendRecord` (9). `/v1/search` and `/v1/similar`
  results remain untyped (`Envelope[dict[str, Any]]`).
- **`EntityCategory` gained `job_opening`** — nine members, not eight.
- **`include_domains` / `exclude_domains` now accept `job_opening`** as well as
  `company` and `person`. For a job opening the domain is the company that
  posted the role.
- **Company and person entity lookups gained `by`** — `auto | domain | li_url |
  name` (person: no `domain`). When set, `ids` are raw identifier values rather
  than internal ids; `auto` classifies each entry independently. Omitting `by`
  keeps the original behaviour.
- **Id limits differ by route.** Company and person accept 1,000 ids; the seven
  document routes accept 100, because a document record is the whole document.
- **SSO routes were added** under `/v1/auth/sso/*`. Dashboard-only; out of scope.

### Not in the schema, and why it matters

The OpenAPI document declares only `200`/`201`/`202`/`204` and FastAPI's generic
`422`. The RFC 9457 problem shape, the closed error-code enum, and the
`402/403/429/501/503/504` cases are absent from it entirely. That is the single
biggest reason these SDKs are hand-written: a generator reading this schema would
produce a client with no error handling at all. `error-codes.json` in this
directory is the missing half of the contract, maintained by hand.

Also absent, and tracked upstream:

- No `RateLimit-*` response headers yet (W-14). Key-scoped rate limiting is not
  enforced. The SDKs parse the headers defensively so the feature appears
  without a client change.
- No `Idempotency-Key` support yet (W-36). Until it lands, a retry of a billed
  `POST` after a lost response can charge twice — which is why the SDKs do not
  retry read timeouts on billed routes.

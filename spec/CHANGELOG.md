# API contract changelog

What changed in the Sprouts Data API contract that both SDKs are built against, newest
first. Each SDK's own changelog says what it did about it.

The contract is the files in this directory: `openapi.json` (the published `/v1/*` API),
`records.schema.json` (the entity record shapes), `routes.json` (what each operation costs
and how it pages), `error-codes.json`, `retry-policy.json`, `defaults.json`, the tool specs
in `tools/` and the behavioural cases in `conformance/`.

---

## 2026-11-27 — partial matches; search defaults to `auto`; whole records are paid for once

- **openapi.json**: a company or person search (and an `auto` search answered with companies
  or people) returns, after the rows meeting every filter, the rows meeting part of it,
  ranked by how much they meet. It is on by default; `partial_matches: false` asks for exact
  matches only. Each row says which filters it meets in full (`matched_filters`), how much it
  meets (`match_score`, 1 for every filter) and, on a partial row, each filter it misses and
  how (`unmet`, new schema `UnmetFilter`). A page gains `total_exact`, the rows meeting every
  filter; `total` counts both. Partial rows are charged like any other row.
- **openapi.json**: a search sent without `mode` is now read in `auto` mode and billed as
  an AI search (it was `fast`). `fast` now reads the words only for what they are about
  (keywords, a description matched by meaning, people's titles or skills; a document's
  topic) and sets no other filter, so hard constraints go in `filters`.
- **openapi.json**: `AddItemsResponse` and `ListItemsResponse` gain `credits_charged`. The
  first time a workspace sees a record whole (through a lookup, a saved list or an export)
  it pays the lookup price, and the record stays unlocked for 90 days by any of those
  routes. What is due is checked first: too few credits is a `402` and nothing is added,
  shown or exported. Card fields stay free.
- **openapi.json**: `re_enrich` says which repeats are free: a value already found for the
  same LinkedIn profile or Sprouts record. A row sent with only a name and company is
  looked up, and charged, each time.
- Not in the document, but part of the contract: reading saved lists and their exports
  needs the `dsp.lists.read` scope, and changing them `dsp.lists.write`. Keys made without
  choosing scopes now get both. Whole records go only to a paid workspace calling with
  `dsp.entities.read`; anything else gets the search-row fields.

## 2026-11-25 — blank queries, protected headers, sealed company ids

- **defaults.json** (version 4): `owned_headers` and `forbidden_headers`, the headers a
  client sets itself (now with `content-type` and `last-event-id`) and the ones it never
  sends, so both SDKs refuse the same default headers.
- **tools/messages.json** (version 4): `rules.query_blank`. A `query` of only whitespace
  beside filters is refused, not dropped: the API refuses a blank query whatever comes with
  it. `caveats.search_ids_not_found` names a company row's sealed id as well as a person
  row's hash.
- **tools/shaping.json**: `search_id_pattern` matches a company row's sealed `d1_…` id too.
- **tools**: the search and lookup descriptions say a company row's `id` is a sealed
  reference, not a lookup key. A look-alike row is matched to a domain anchor by its own
  `domain` only, and `anchors_removed` names it by that domain. The search, look-alike and
  lookup fixtures carry sealed company ids; `invalid_blank_query_with_filters` is new.
- **tools/README.md**: a redirect is raised to the application (its base URL is wrong), as a
  401, 403 or 402 is, instead of being returned to the model.

## 2026-11-25 — a gateway's answer is not the API's

- **retry-policy.json** (version 4): the API's own `504` (`upstream.timeout`: the work was
  abandoned before any charge) is retried for `safe`, `billed` and `keyed` calls and raised
  for `once` calls, where a write may have landed. A `504` without that code comes from a
  gateway in front of the API, which stopped waiting while the API may still be working:
  like a `408` or `502`, it is retried only where a repeat is free (`safe`) or recognised
  by its Idempotency-Key (`keyed`). `503` alone stays always retried.
- **error-codes.json** (version 3): new concept `gateway` for a `408`, `502` or `504`
  without a code. A `502` was `service_unavailable` ("nothing was charged") and a code-less
  `504` `upstream_timeout` ("abandoned, not charged"): promises only the API can make.
- **tools/shaping.json** (version 3): `retryable_concepts`. A tool error is `retryable` by
  concept, so `credits.refused` and `quota.concurrency_exceeded`, whose codes say a repeat
  cannot help, are no longer offered to a model as retryable.
- **conformance**: six cases for the above, and `expect.error.message_contains`.
- **public-text.json** (new): what public text in this directory and in both SDKs may not
  say. The descriptions in `openapi.json` and `records.schema.json` no longer name the
  services behind the API, and the documents no longer carry `x-source`.

## 2026-11-24 — enrichment, idempotent billed calls, every error code

- **Enrichment**: `/v1/enrichment/*`. A job (`POST /v1/enrichment/jobs`, 202, an
  `Idempotency-Key` required) is followed to its rows; a lookup of a few rows is answered
  in the call. Each field has its own price (an email 1 credit, a phone number 9), a request
  holds at most 30,000 credits, only values newly found are charged (`values_found`), and a
  field with no value says why (`reason`). Scopes `dsp.enrichment.read` and `.write`.
- **Idempotent billed calls**: search, look-alikes, the entity lookups, relationships and
  the org chart read an optional `Idempotency-Key`; a call repeated with its key is charged
  once. In `routes.json` every billed operation is `keyed`, and none is `billed`.
- **Org chart people**: `POST /v1/org-chart/people`, the people one org chart cell counts.
- **Search**: deep search is gone (`mode` is `fast` or `auto`; agent runs do that work).
  `lock_filters` and `fields` on every search body; `resolved_search.read_as` and
  `anchor_matches`; document filters `topic`, `topic_description`, `languages`,
  `inventors`, `authors`, `company_city` and the trend fields; a funding search's
  `investors` takes `match_all`.
- **Effort** is `quick`, `basic`, `standard`, `detailed`, `maximum` or `auto`; the earlier
  names are still read. An agent run needs only its question.
- **error-codes.json**: every code the API sends an API key is mapped (44). New concepts
  `results_expired` (410), `concurrency_limit` and `credits_refused`.
- **retry-policy.json** (version 3): a row may match on the problem's `code`;
  `quota.concurrency_exceeded` and `credits.refused` are never retried, and neither is 410.
- **Not wrapped** (`routes.json`, each with its reason): the dashboard's institution
  type-ahead and its credit purchase routes.

## 2026-11-17 — every key is live; empty answers explained

- Test keys are retired: keys are `sk_dsp_live_…`, and `environment` on responses is a
  deprecated constant, `"live"`.
- `POST /v1/credits/quote`: what a call would cost, free.
- An empty first page says why (`degradation` `no_match`), a `relax` suggestion names the
  filters whose removal alone finds records, and thin filters are named (`sparse_filter`).
- `meta.credits_balance`: the credits left after the call. `next_step` on every problem:
  what to do now.

## 2026-11-11 — the current API

The contract was rebuilt for the current API: 50 operations; keys exchanged for short-lived
tokens; credits charged as the last step of the work; the entity record shapes in the new
`records.schema.json`; `routes.json` v2 (each operation's cost class, response kind,
idempotency and paging); `error-codes.json` v2; the conformance cases validated against
`openapi.json`. The earlier contract is not a base for anything above.

Before 2026-11-11 the SDKs were built against an earlier version of the API; each SDK's
changelog keeps that history.

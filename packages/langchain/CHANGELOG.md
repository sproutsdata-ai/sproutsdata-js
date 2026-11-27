# Changelog

## 0.1.0 — Unreleased

- Requires `sproutsdata` 0.1 (`>=0.1.0 <0.2.0`): the adapter imports what 0.0.1 does not
  have, so it no longer installs beside it.
- Built on the realigned `sproutsdata` client and its `sproutsdata/tools`
  connection helpers: a client you pass is used as it is, and connection
  settings beside a client throw `ClientValidationError`.
- The retriever sends `mode: 'fast'` unless told otherwise, and no mode with
  `category: 'auto'`; its documents read the new rows and carry
  `credits_charged`. A search without a mode now runs in `auto` on the API, so
  pinning `fast` keeps what a deployed retriever bills; `fast` reads the words only
  for what they are about, so constraints belong in `filters`.
- Partial matches: the retriever asks for exact matches only (`partial_matches: false`
  is sent for a company, person or `auto` search unless you set `partialMatches`), so a
  chain reading `pageContent` never takes a close match for a match. With
  `partialMatches: true`, a close match's `pageContent` starts with a line saying so,
  and each document carries `match_score`, `unmet` (set on a row meeting only part of
  the search) and the page's `total_exact`. The tools keep a partial row's
  `unmet`, return `total_exact` and add a `partial_rows` caveat.
- The `X-SproutsData-Client` header is no longer sent.
- Documents and tool results no longer carry `environment`: test keys were
  retired, so every answer is a live one.
- Requires Node.js 22.12.0 or later.
- The tools inherit the SDK's error and look-alike changes: nothing whose work may have run
  is retryable (a gateway's answer, a timeout after sending, a 500, the API's own timeout:
  every tool is charged, and a new call is a new request), nor are a refused credit hold and
  a concurrency limit, a redirect is thrown to the application, and an anchor among the
  look-alikes is recognised by its domain.

## 0.0.1 — 2026-10-14

The first public release of `@sproutsdata.ai/langchain`: the Sprouts tools as
LangChain tools, and Sprouts search as a retriever. Until 1.0, a minor version
may include breaking changes; each one will be listed here.

### Included

- `sproutsDataTools()` returns the three Sprouts tools (`sprouts_search`,
  `sprouts_similar`, `sprouts_entity_lookup`), with the same names, schemas and
  results as the Sprouts MCP server and the SDK's `sproutsdata/tools`.
- The tool classes `SproutsDataSearchResults`, `SproutsDataFindSimilar` and
  `SproutsDataEntityLookup`, for building the tools one at a time.
- `SproutsDataRetriever`, which turns a Sprouts search into LangChain
  documents.
- `sproutsdata` (`>=0.0.1 <0.1.0`) and `@langchain/core` (`^1.0.0`) are peer
  dependencies. Node.js 20 or later.

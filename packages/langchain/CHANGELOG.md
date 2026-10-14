# Changelog

## 0.2.0 (Unreleased)

A rebuild as a thin layer over `sproutsdata/tools`, the SDK's tools module.
The tools now have the Sprouts MCP server's contract — names, input schemas,
results and error policy — not only its names, so a prompt written for one
surface works with the others. Breaking; the package was never published, so
no aliases are kept. The SDK's own changes are in
[`packages/sdk/CHANGELOG.md`](../sdk/CHANGELOG.md).

### Migrating from 0.1.1

| Kind | What | 0.1.1 | 0.2.0 |
|---|---|---|---|
| Package | SDK | `@sproutsdata.ai/sprouts-js-sdk` `^0.2.0`, a dependency | `sproutsdata` `^0.4.0`, a peer dependency (`npm install @sproutsdata.ai/langchain sproutsdata @langchain/core`) |
| Package | `@langchain/core` | Peer `^1.0.0` | Peer `^1.0.0` (unchanged) |
| Package | `zod` | A dependency | Not a dependency |
| Package | Node.js | 20 or later | 20 or later (unchanged) |
| Name | Tools | `sproutsTools(cfg)` (search and similar) | `sproutsDataTools(options)` (all three, or those `include` names) |
| Name | Tool classes | `SproutsSearchResults`, `SproutsFindSimilar`, `SproutsEntityLookup` | `SproutsDataSearchResults`, `SproutsDataFindSimilar`, `SproutsDataEntityLookup`, each built from `{ toolset }` |
| Name | Retriever | `SproutsSearchRetriever` | `SproutsDataRetriever` |
| Name | Document metadata | `SproutsDocumentMetadata` | `SproutsDataDocumentMetadata` |
| Configuration | Search settings | `category` / `mode` / `combine` / `includeDomains` tool config | `fixed: { sprouts_search: { category: 'person' } }` (hidden from the model) or `defaults` (the model may change) |
| Configuration | Baseline filters | `filters`, replacing the model's filter of the same name | `baselineFilters`, merged per key; the result's `caveats` say when a model's value was replaced |
| Configuration | `maxResults` | Documented as 1–100 | 1–25, refused outside that range |
| Configuration | Retriever | `category: null`; `k` checked as 1–100 | `category` is a category (default `'company'`); `k` and every field sent as given |
| Behaviour | Arguments | Flattened camelCase (`industries`, `countries`, `kind` + `identifiers`, …) | The spec schema: nested `filters`, `category`, `ids`, `by`, `fields`, `sort`, `cursor`, `limit`; unknown arguments refused rather than dropped |
| Behaviour | Error result | `{"error": "…"}` | `{"error": {"code", "message", "retryable", "retry_after", "field_errors", "request_id"}}` |
| Behaviour | Failures | Every failure returned as data; schema violations threw `ToolInputParsingException` | Invalid input returned as data, with every problem named; 401, 403 and 402 thrown |
| Behaviour | **A billed call that timed out after sending** | "Retrying the same call may succeed" | Not retryable: it may have been charged |

### Added

- `sproutsDataTools(options)` — options `include`, `fixed`, `defaults`,
  `maxResults`, `baselineFilters`, and the connection settings `client`,
  `apiKey`, `baseUrl`, `timeoutMs`, `maxRetries`. One client and one
  `Toolset` shared by every tool.
- `SproutsDataTool`, the base class, for building one tool over your own
  toolset.
- Calls send `X-SproutsData-Client: langchain/<version>`.
- `VERSION`.

### Changed

- The README's Cost section states the API's per-result prices, and the tool
  descriptions carry them, from the shared tool specs.
- Input LangChain's own schema check refuses goes to the SDK, which answers
  with every problem named (or coerces a representation, as the MCP server
  does), so a bad argument no longer ends the run.
- Results carry `interpreted_as`, `caveats`, `suggestion`, `request_id` and
  `environment`; lookups return up to three `matches` with `ambiguous`.
- The retriever runs on the core client, takes any search mode the SDK does,
  and reads `request_id` from the `X-Request-Id` header when the body has no
  `meta`. The key never becomes a field: `toJSON()` and `util.inspect` of a
  tool or the retriever never show it.
- Errors are recognised by name, so a client from a second copy of
  `sproutsdata` (another version, or CommonJS beside ESM) behaves the same.
- The browser check is the SDK's own: building a client in a browser-like
  environment throws, naming `403 auth.browser_origin`.

### Removed

- `SproutsSearchMode`, the per-tool config types, the shaped result types,
  and the copied schema, translation, shaping and error modules.
- The unused `@langchain/anthropic` development dependency.

## 0.1.1

### Fixed

- `priorCompanies` now translates to the `employment_history` filter
  (`{ groups: [{ company: { include: [...] } }] }` — one group, "worked at
  any of these"). The `prior_company` filter it used to emit was retired
  server-side in filters v3 and the API now refuses it with a 422, so any
  search that set `priorCompanies` failed. The model-facing schema is
  unchanged.

### Changed

- Requires `@sproutsdata.ai/sprouts-js-sdk` `^0.2.0`.

## 0.1.0

Initial release.

- `SproutsSearchResults`, `SproutsFindSimilar`, `SproutsEntityLookup` —
  `StructuredTool`s carrying the frozen Sprouts MCP tool names
  (`sprouts_search`, `sprouts_similar`, `sprouts_entity_lookup`), with the
  developer/model config split: the model sets query and flattened filters,
  the developer locks mode, category, caps, domain lists, and baseline
  filters.
- `sproutsTools()` — the two default-on tools as a plain array; lookup is
  added explicitly.
- `SproutsSearchRetriever` — lossy `pageContent` by construction, with the
  complete raw record always under `metadata.record` and request-level fields
  (`request_id`, `total_is_estimate`, `degradation`, `resolved_search`, …)
  copied onto every document. Zero results return `[]`; parser-inferred
  zero-result searches log one warning.
- Tools return errors as data (JSON `{"error": …}` with `request_id`); the
  retriever throws the SDK's typed errors. No adapter-level retry — policy
  belongs to `withRetry()` and the SDK transport.
- `mode: 'deep'` and `updated_after` deliberately not exposed (documented
  501s). Category typos fail locally in the constructor, never billed.
- Node-only: constructors throw early in browser-like environments, naming
  the platform's 403 `auth.browser_origin` rule.

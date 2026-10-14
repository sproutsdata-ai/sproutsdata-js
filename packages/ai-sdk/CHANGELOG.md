# Changelog

## 0.2.0 (Unreleased)

A rebuild as a thin layer over `sproutsdata/tools`, the SDK's tools module.
The tools now have the Sprouts MCP server's contract — names, input schemas,
results and error policy — instead of a flattened copy of their own, so a
prompt written for one surface works with the others. Breaking; the package
was never published, so no aliases are kept. The SDK's own changes are in
[`packages/sdk/CHANGELOG.md`](../sdk/CHANGELOG.md).

### Migrating from 0.1.1

| Kind | What | 0.1.1 | 0.2.0 |
|---|---|---|---|
| Package | SDK | `@sproutsdata.ai/sprouts-js-sdk` `^0.2.0`, a dependency | `sproutsdata` `^0.4.0`, a peer dependency (`npm install @sproutsdata.ai/ai-sdk sproutsdata ai`) |
| Package | `ai` | Peer `^6 \|\| ^7` | Peer `^7`; only 7 is tested |
| Package | `zod` | A dependency | Not a dependency |
| Package | Node.js | 18 or later | 22.12 or later (`engines.node` `>=22.12.0`): `ai` 7 is ESM-only, and the CommonJS build loads it through require(esm), which Node.js runs unflagged from 22.12 |
| Name | Tools | `{ sproutsSearch: sproutsSearch(cfg), sproutsSimilar: …, sproutsLookup: … }` | `sproutsDataTools(options)` → `{ sprouts_search, sprouts_similar, sprouts_entity_lookup }` |
| Name | Model-facing tool names | Your keys (`sproutsSearch`, …) | The spec names, always |
| Configuration | Search settings | `category` / `mode` / `combine` / `includeDomains` config | `fixed: { sprouts_search: { category: 'person' } }` (hidden from the model) or `defaults` (the model may change) |
| Configuration | Baseline filters | `filters`, replacing the model's filter of the same name | `baselineFilters`, merged per key; the result's `caveats` say when a model's value was replaced |
| Configuration | `maxResults` | Documented as 1–100 | 1–25, refused outside that range |
| Configuration | Deep search, `updatedAfter` | Config options | Removed: search mode is `fast` or `auto`, as on the MCP server |
| Configuration | Returned fields | `companyFields` / `personFields` | The model's `fields` argument, or `fixed` / `defaults` |
| Configuration | Client | Built on the first call | Built by `sproutsDataTools()`: a missing key throws there |
| Behaviour | Arguments | Flattened camelCase (`industries`, `countries`, `kind` + `identifiers`, …) | The spec schema: nested `filters`, `category`, `ids`, `by`, `fields`, `sort`, `cursor`, `limit`; unknown arguments refused rather than dropped |
| Behaviour | Error result | `{ error: string }` | `{ error: { code, message, retryable, retry_after, field_errors, request_id } }` |
| Behaviour | 401, 403, 402 | Returned as data | Thrown; add `raiseSproutsDataErrors` to `stopWhen` to have them reject `generateText` |
| Behaviour | **A billed call that timed out after sending** | "Retrying the same call may succeed" | Not retryable: it may have been charged |

### Added

- `sproutsDataTools(options)` — the three tools, or those `include` names,
  sharing one client and one `Toolset`. Options: `include`, `fixed`,
  `defaults`, `maxResults`, `baselineFilters`, and the connection settings
  `client`, `apiKey`, `baseUrl`, `timeoutMs`, `maxRetries`.
- `raiseSproutsDataErrors` — a stop condition that rethrows a 401, 403 or 402
  a tool raised, so it reaches the application instead of the model.
- Calls send `X-SproutsData-Client: ai-sdk/<version>`.
- `VERSION`.

### Changed

- The README's Cost section states the API's per-result prices, and the tool
  descriptions carry them, from the shared tool specs.
- Invalid model input is validated by the SDK and returned with every problem
  named.
- Results carry `interpreted_as`, `caveats`, `suggestion`, `request_id` and
  `environment`; lists put the values the request asked for first and end in
  `"… +N more"`; lookups return up to three `matches` with `ambiguous`.
- Errors are recognised by name, so a client from a second copy of
  `sproutsdata` (another version, or CommonJS beside ESM) behaves the same.

### Removed

- `sproutsSearch`, `sproutsSimilar`, `sproutsLookup` and their config and
  result types, with the copied schema, translation and shaping modules.
- The unused `@ai-sdk/anthropic` development dependency.

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

- Three Vercel AI SDK tools over `@sproutsdata.ai/sprouts-js-sdk`:
  `sproutsSearch`, `sproutsSimilar`, `sproutsLookup`.
- Flattened, camelCase model-facing schemas translated to the DSP filter
  vocabulary; cursors, deep mode, anchor weights, and domain lists are
  developer-config only.
- Results shaped for context windows: field whitelists, 300-char text caps,
  nulls dropped, employer data nested under `company` on person records.
- Failures returned as `{ error }` data so agent loops can self-correct;
  aborts and programmer errors still throw.
- No runtime dependency on `ai` (peer `^6 || ^7`): tools are plain objects,
  so the dual ESM/CJS build works with ESM-only ai v7.

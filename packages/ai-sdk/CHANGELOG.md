# Changelog

## 0.1.0 — Unreleased

- Requires `sproutsdata` 0.1 (`>=0.1.0 <0.2.0`): the adapter imports what 0.0.1 does not
  have, so it no longer installs beside it.
- Built on the realigned `sproutsdata` client: `sproutsDataTools()` resolves its
  client with `sproutsdata/tools`' `resolveClient`, so a client you pass is used
  as it is, and connection settings beside it throw `ClientValidationError`.
- `raiseSproutsDataErrors` recognises the application errors with
  `sproutsdata/tools`' own check, including errors from a second copy of the
  package.
- The `X-SproutsData-Client` header is no longer sent.
- Tool results no longer carry `environment`: test keys were retired, so every
  answer is a live one.
- Requires Node.js 22.12.0 or later.
- Partial matches: the search tool takes `partial_matches`, keeps a partial row's
  `unmet`, `matched_filters` and `match_score`, returns `total_exact`, and adds a
  `partial_rows` caveat so a model reports close matches as such.
- The tools inherit the SDK's error and look-alike changes: a gateway's answer is not
  retryable, nor are a refused credit hold and a concurrency limit, a redirect is thrown to
  the application, and an anchor among the look-alikes is recognised by its domain.

## 0.0.1 — 2026-10-14

The first public release of `@sproutsdata.ai/ai-sdk`: the Sprouts tools for the
Vercel AI SDK. Until 1.0, a minor version may include breaking changes; each
one will be listed here.

### Included

- `sproutsDataTools()` returns the three Sprouts tools (`sprouts_search`,
  `sprouts_similar`, `sprouts_entity_lookup`), with the same names, schemas and
  results as the Sprouts MCP server and the SDK's `sproutsdata/tools`.
- `raiseSproutsDataErrors()`, a stop condition that makes a rejected key, a
  missing scope or an empty credit balance (401, 403, 402) reject
  `generateText` / `streamText`, instead of reaching the model as a tool error.
- `sproutsdata` (`>=0.0.1 <0.1.0`) and `ai` (`^7.0.0`) are peer dependencies.
  Node.js 22.12 or later.

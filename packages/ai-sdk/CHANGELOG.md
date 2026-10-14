# Changelog

## 0.0.1 (Unreleased)

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

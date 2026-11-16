# Changelog

## Unreleased

- Built on the realigned `sproutsdata` client and its `sproutsdata/tools`
  connection helpers: a client you pass is used as it is, and connection
  settings beside a client throw `ClientValidationError`.
- The retriever sends `mode: 'fast'` unless told otherwise, and no mode with
  `category: 'auto'`; its documents read the new rows and carry
  `credits_charged`.
- The `X-SproutsData-Client` header is no longer sent.
- Requires Node.js 22.12.0 or later.

## 0.0.1

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

# Changelog

## 0.0.1 (Unreleased)

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

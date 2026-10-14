/**
 * `@sproutsdata.ai/langchain` — the Sprouts tools and search as LangChain
 * tools and a retriever.
 *
 * ```ts
 * import { sproutsDataTools } from '@sproutsdata.ai/langchain';
 *
 * const tools = sproutsDataTools(); // reads SPROUTSDATA_API_KEY
 * ```
 *
 * A thin layer over the `sproutsdata` SDK. The tools — `sprouts_search`,
 * `sprouts_similar`, `sprouts_entity_lookup` — are `sproutsdata/tools`, with
 * the Sprouts MCP server's names, input schemas and result shape; this
 * package adds only what LangChain needs to call them. Transport, retries,
 * validation, result shaping and the error policy all live in the SDK.
 */

export type { SproutsDataConnection } from './connection';
export type { SproutsDataDocumentMetadata } from './document';
export { SproutsDataRetriever, type SproutsDataRetrieverFields } from './retriever';
export { sproutsDataTools, type SproutsDataToolsOptions } from './toolkit';
export {
  SproutsDataEntityLookup,
  SproutsDataFindSimilar,
  SproutsDataSearchResults,
  SproutsDataTool,
  type SproutsDataToolFields,
} from './tools';
export { VERSION } from './version';

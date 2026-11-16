/**
 * The Sprouts Data API as tools a language model can call: `sproutsdata/tools`.
 *
 * ```ts
 * import { SproutsData } from 'sproutsdata';
 * import { Toolset } from 'sproutsdata/tools';
 *
 * const tools = new Toolset(new SproutsData());
 * tools.openai();      // Chat Completions tool definitions
 * tools.anthropic();   // Anthropic Messages tool definitions
 * await tools.run('sprouts_search', { query: 'fintech companies in Germany' });
 * ```
 *
 * Three tools, `sprouts_search`, `sprouts_similar` and `sprouts_entity_lookup`, with the same
 * names, input schemas and result shape as the Sprouts MCP server and the Python SDK's
 * `sproutsdata.tools`, all from `spec/tools/`. Built on the public client only, so an adapter
 * (LangChain, the AI SDK) needs nothing else. The provider helpers build plain objects and
 * import no provider SDK.
 *
 * @packageDocumentation
 */

import { Catalog } from './catalog-set.js';
import type { AnthropicTool, OpenAIChatTool, OpenAIResponsesTool, ToolDefinition, ToolSettings } from './types.js';

export { toJson } from './canonical.js';
export { MAX_RESULTS_CEILING, TOOL_NAMES } from './catalog.js';
export { APPLICATION_ERRORS, isApplicationError, isSproutsData, resolveClient, type ConnectionOptions } from './connection.js';
export { Toolset, type ToolsetOptions } from './toolset.js';
export type * from './types.js';
export type { LookupArguments, SearchArguments, SimilarArguments } from './specs.gen.js';

/** Provider-neutral tool specs, without a client. See {@link Toolset} for the options. */
export function definitions(include?: readonly string[], options: { readonly fixed?: ToolSettings } = {}): ToolDefinition[] {
  return new Catalog(include, options.fixed).definitions();
}

/** OpenAI function tools, without a client. See {@link Toolset.openai}. */
export function openai(
  include?: readonly string[],
  options: { readonly fixed?: ToolSettings; readonly strict?: boolean; readonly api?: 'chat' | 'responses' } = {},
): (OpenAIChatTool | OpenAIResponsesTool)[] {
  return new Catalog(include, options.fixed).openai(options.strict ?? true, options.api ?? 'chat');
}

/** Anthropic tool definitions, without a client. See {@link Toolset.anthropic}. */
export function anthropic(include?: readonly string[], options: { readonly fixed?: ToolSettings } = {}): AnthropicTool[] {
  return new Catalog(include, options.fixed).anthropic();
}

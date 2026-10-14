/**
 * The Sprouts tools, for any model that calls functions.
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
 * Three tools — `sprouts_search`, `sprouts_similar` and
 * `sprouts_entity_lookup` — with the same names, input schemas and result
 * shape as the Sprouts MCP server and the Python SDK's `sproutsdata.tools`,
 * all generated from `spec/tools/`. One name means one contract on every
 * surface, so a prompt written for one works with the others.
 *
 * The provider helpers build plain objects and import no provider SDK.
 * `handleOpenAIToolCalls` and `handleAnthropicToolUse` run every call in a
 * model's message and answer each one — an unknown tool name or bad
 * arguments included — so the conversation can always continue.
 *
 * What a model may fix comes back as data (`{ error: {...} }`); what only the
 * application can fix — a rejected key, a missing scope, no credits — is
 * thrown.
 */

export { TOOL_NAMES, toJson } from './spec';
export {
  DEFAULT_INTEGRATION,
  MAX_RESULTS_CEILING,
  Toolset,
  anthropic,
  definitions,
  openai,
  type CatalogOptions,
  type OpenAIOptions,
  type ToolsetOptions,
} from './toolset';
export type { OpenAIApi } from './providers';
export type {
  AnthropicTool,
  AnthropicToolResult,
  InterpretedAs,
  JsonSchema,
  JsonValue,
  LookupToolHit,
  LookupToolResult,
  OpenAIChatTool,
  OpenAIChatToolMessage,
  OpenAIResponsesTool,
  OpenAIResponsesToolOutput,
  SearchToolResult,
  ToolArguments,
  ToolDefinition,
  ToolError,
  ToolName,
  ToolResult,
  ToolSettings,
} from './types';

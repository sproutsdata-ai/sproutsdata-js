/**
 * The shapes of `spec/tools/` and of what the tools module hands back. The
 * provider shapes are written out here as plain objects, so no provider SDK
 * is imported, and they use the providers' own `snake_case` keys.
 */

/** The three tools, named as the Sprouts MCP server names them. */
export type ToolName = 'sprouts_search' | 'sprouts_similar' | 'sprouts_entity_lookup';

/** Any JSON value. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * The JSON Schema subset the tool specs use. `type` is a list (with `null`)
 * and `enum` may hold `null` only in a strict-mode schema, where an optional
 * argument is nullable instead of omittable.
 */
export interface JsonSchema {
  type: string | string[];
  description?: string;
  enum?: Array<string | null>;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  default?: JsonValue;
}

/** One tool file in `spec/tools/`. */
export interface ToolSpecFile {
  name: ToolName;
  /** The description proper, which names no other tool. */
  description: string;
  /** Sentences appended only when the tool they name is in the same toolset. */
  description_hints: Partial<Record<ToolName, string>>;
  /** Argument names a model is likely to send but the tool does not take, and the refusal for each. */
  refused_arguments: Record<string, string>;
  /** The loose schema: validation, Anthropic, and OpenAI with `strict: false`. */
  input_schema: JsonSchema;
  /** Generated for OpenAI strict mode: every property required, optional ones nullable. */
  strict_input_schema: JsonSchema;
}

/** `spec/tools/shaping.json`. */
export interface ShapingSpec {
  $comment: string;
  version: number;
  list_max_entries: number;
  text_max_chars: number;
  matches_max: number;
  ellipsis: string;
  more_marker: string;
  max_results_ceiling: number;
  identity_fields: string[];
  default_projection: Record<string, string[]>;
  domain_categories: string[];
  lookup_by: Record<string, { accepts: string[]; default: string | null }>;
  search_id_pattern: string;
}

/** `spec/tools/messages.json`: sections of `{placeholder}` templates. */
export interface MessagesSpec {
  $comment: string;
  version: number;
  validation: Record<string, string>;
  rules: Record<string, string>;
  caveats: Record<string, string>;
  errors: Record<string, string>;
}

/** A provider-neutral tool definition: what {@link Toolset.definitions} returns. */
export interface ToolDefinition {
  name: ToolName;
  description: string;
  input_schema: JsonSchema;
}

/** An OpenAI Chat Completions function tool. */
export interface OpenAIChatTool {
  type: 'function';
  function: { name: ToolName; description: string; parameters: JsonSchema; strict: boolean };
}

/** An OpenAI Responses API function tool. */
export interface OpenAIResponsesTool {
  type: 'function';
  name: ToolName;
  description: string;
  parameters: JsonSchema;
  strict: boolean;
}

/** An Anthropic Messages API tool. */
export interface AnthropicTool {
  name: ToolName;
  description: string;
  input_schema: JsonSchema;
}

/** The answer to one Chat Completions tool call. */
export interface OpenAIChatToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

/** The answer to one Responses API function call. */
export interface OpenAIResponsesToolOutput {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

/** The answer to one Anthropic `tool_use` block. */
export interface AnthropicToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  /** Present, and true, only when the call failed. */
  is_error?: true;
}

/** What a model sent: OpenAI's JSON string, Anthropic's object, or nothing. */
export type ToolArguments = string | Record<string, unknown> | null | undefined;

/** Per tool (full or short name), arguments the application sets. */
export type ToolSettings = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/**
 * The error every tool returns for what a model can act on. All six keys
 * are always present.
 */
export interface ToolError {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    /** Seconds to wait before calling again, when the server said. */
    retry_after: number | null;
    /** `path: problem` for each argument at fault. */
    field_errors: string[];
    request_id: string | null;
  };
}

/** What the engine decided a search meant: `resolved_search`, never dropped. */
export interface InterpretedAs {
  filters: Record<string, unknown>;
  /** `filters_source`: `caller`, `parser`, `caller+parser`, or `none`. */
  source: string;
  conflicts: unknown[];
}

/** A `sprouts_search` or `sprouts_similar` result. */
export interface SearchToolResult {
  /** Projected, trimmed rows; a company or person row may carry `lookup: { by, value }`. */
  results: Array<Record<string, unknown>>;
  total: number;
  /** When true, `total` is a floor. */
  total_is_estimate: boolean;
  has_more: boolean;
  next_cursor: string | null;
  interpreted_as: InterpretedAs;
  caveats: string[];
  suggestion: Record<string, unknown> | null;
  request_id: string | null;
  environment: string | null;
}

/** One id of a `sprouts_entity_lookup` call, answered. */
export interface LookupToolHit {
  id: string;
  found: boolean;
  /** Up to three records, then a `"… +N more"` marker when there were more. */
  matches: Array<Record<string, unknown> | string>;
  /** True when more than one record matched. */
  ambiguous: boolean;
}

/** A `sprouts_entity_lookup` result: every id answered, in order. */
export interface LookupToolResult {
  results: LookupToolHit[];
  caveats: string[];
  request_id: string | null;
  environment: string | null;
}

/** A tool result: the shaped answer (contract 02 §12.2) or a {@link ToolError}. */
export type ToolResult = SearchToolResult | LookupToolResult | ToolError;

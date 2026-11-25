/**
 * The shapes of `spec/tools/` and of what `sproutsdata/tools` hands back. The provider shapes
 * are written out as plain objects, so no provider SDK is imported, and they keep the
 * providers' own `snake_case` keys.
 */

/** The three tools, named as the Sprouts MCP server names them. */
export type ToolName = 'sprouts_search' | 'sprouts_similar' | 'sprouts_entity_lookup';

/** Any JSON value. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * The JSON Schema subset the tool specs use. `type` is a list (with `null`) and `enum` may hold
 * `null` only in a strict-mode schema, where an optional argument is nullable instead of omittable.
 */
export interface JsonSchema {
  readonly type: string | readonly string[];
  readonly description?: string;
  readonly enum?: readonly (string | null)[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: JsonSchema;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly default?: JsonValue;
}

/** One tool file in `spec/tools/`. */
export interface ToolSpecFile {
  readonly name: ToolName;
  /** The description proper, which names no other tool. */
  readonly description: string;
  /** Sentences appended only when the tool they name is in the same toolset. */
  readonly description_hints: Readonly<Partial<Record<ToolName, string>>>;
  /** Argument names a model is likely to send but the tool does not take, and the refusal for each. */
  readonly refused_arguments: Readonly<Record<string, string>>;
  /** The loose schema: validation, Anthropic, and OpenAI with `strict: false`. The strict one is derived (`strict.ts`). */
  readonly input_schema: JsonSchema;
}

/** `spec/tools/shaping.json`, without its `$comment` and `version`. */
export interface ShapingSpec {
  readonly list_max_entries: number;
  readonly text_max_chars: number;
  readonly matches_max: number;
  readonly ellipsis: string;
  readonly more_marker: string;
  readonly max_results_ceiling: number;
  readonly identity_fields: readonly string[];
  readonly default_projection: Readonly<Record<string, readonly string[]>>;
  readonly domain_categories: readonly string[];
  readonly lookup_by: Readonly<Record<string, { readonly accepts: readonly string[]; readonly default: string | null }>>;
  readonly search_id_pattern: string;
  readonly document_categories: readonly string[];
  readonly resolved_filters_skipped: readonly string[];
  /** The error concepts (`spec/error-codes.json`) a tool error calls retryable. */
  readonly retryable_concepts: readonly string[];
}

/** `spec/tools/messages.json`, without its `$comment` and `version`: sections of `{placeholder}` templates. */
export interface MessagesSpec {
  readonly validation: Readonly<Record<string, string>>;
  readonly rules: Readonly<Record<string, string>>;
  readonly caveats: Readonly<Record<string, string>>;
  readonly errors: Readonly<Record<string, string>>;
}

/** A provider-neutral tool definition: what `Toolset.definitions()` returns. */
export interface ToolDefinition {
  readonly name: ToolName;
  readonly description: string;
  readonly input_schema: JsonSchema;
}

/** An OpenAI Chat Completions function tool. */
export interface OpenAIChatTool {
  readonly type: 'function';
  readonly function: { readonly name: ToolName; readonly description: string; readonly parameters: JsonSchema; readonly strict: boolean };
}

/** An OpenAI Responses API function tool. */
export interface OpenAIResponsesTool {
  readonly type: 'function';
  readonly name: ToolName;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly strict: boolean;
}

/** An Anthropic Messages API tool. */
export interface AnthropicTool {
  readonly name: ToolName;
  readonly description: string;
  readonly input_schema: JsonSchema;
}

/** The answer to one Chat Completions tool call. */
export interface OpenAIChatToolMessage {
  readonly role: 'tool';
  readonly tool_call_id: string;
  readonly content: string;
}

/** The answer to one Responses API function call. */
export interface OpenAIResponsesToolOutput {
  readonly type: 'function_call_output';
  readonly call_id: string;
  readonly output: string;
}

/** The answer to one Anthropic `tool_use` block. */
export interface AnthropicToolResult {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string;
  /** Present, and true, only when the call failed. */
  readonly is_error?: true;
}

/** What a model sent: OpenAI's JSON string, Anthropic's object, or nothing. */
export type ToolArguments = string | Readonly<Record<string, unknown>> | null | undefined;

/** Per tool (full or short name), arguments the application sets. */
export type ToolSettings = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** The error every tool returns for what a model can act on. All six keys are always present. */
export interface ToolError {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    /** Seconds to wait before calling again, when the server said. */
    readonly retry_after: number | null;
    /** `path: problem` for each argument at fault. */
    readonly field_errors: readonly string[];
    readonly request_id: string | null;
  };
}

/** What the engine decided a search meant: `resolved_search`, never dropped. */
export interface InterpretedAs {
  readonly filters: Readonly<Record<string, unknown>>;
  /** `filters_source`: `caller`, `parser`, `caller+parser`, or `none`. */
  readonly source: string;
  readonly conflicts: readonly unknown[];
  /**
   * Applied filters whose field few records hold, thinnest first: a small count may be thin
   * data rather than a narrow ask. Only when there are some, so other answers read as before.
   */
  readonly sparse_filters?: readonly SparseFilterNote[];
}

/** One thin filter, as `resolved_search.sparse_filters` reports it. */
export interface SparseFilterNote {
  readonly filter: string;
  readonly record_type: string;
  /** Records of that type holding the filter's field. */
  readonly populated: number;
  /** Records of that type in the index. */
  readonly of: number;
  /** `populated` / `of`, 0 to 1. */
  readonly share: number;
}

/** A `sprouts_search` or `sprouts_similar` result. */
export interface SearchToolResult {
  /** Projected, trimmed rows; a row a lookup can take carries `lookup: { by, value }`. */
  readonly results: readonly Readonly<Record<string, unknown>>[];
  readonly total: number;
  /** When true, `total` is a floor. */
  readonly total_is_estimate: boolean;
  readonly has_more: boolean;
  readonly next_cursor: string | null;
  readonly interpreted_as: InterpretedAs;
  readonly caveats: readonly string[];
  readonly suggestion: Readonly<Record<string, unknown>> | null;
  readonly request_id: string;
}

/** One id of a `sprouts_entity_lookup` call, answered. */
export interface LookupToolHit {
  readonly id: string;
  readonly found: boolean;
  /** Up to three records, then a `"… +N more"` marker when there were more. */
  readonly matches: readonly (Readonly<Record<string, unknown>> | string)[];
  /** True when more than one record matched. */
  readonly ambiguous: boolean;
}

/** A `sprouts_entity_lookup` result: every id answered, in order. */
export interface LookupToolResult {
  readonly results: readonly LookupToolHit[];
  readonly caveats: readonly string[];
  readonly request_id: string;
}

/** A tool result: the shaped answer, or a {@link ToolError}. */
export type ToolResult = SearchToolResult | LookupToolResult | ToolError;

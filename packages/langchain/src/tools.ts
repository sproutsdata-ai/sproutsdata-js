/**
 * The three Sprouts tools as LangChain `StructuredTool`s, over
 * `sproutsdata/tools`.
 *
 * Each class is framework glue and nothing else. The name, the description
 * and the JSON Schema come from a `Toolset`'s `definitions()`, so a LangChain
 * agent sees exactly the contract the Sprouts MCP server and every other
 * surface use (contract 02 §12). A call goes to `Toolset.run`, and the model
 * gets the toolset's canonical JSON back.
 *
 * Invalid input — an unknown argument, a wrong type, a broken tool rule —
 * comes back to the model as an `{"error": {...}}` result it can correct,
 * never as an exception that ends the run. API failures the model can act
 * on (404, 409, 422, 429, 5xx, timeouts) come back the same way. What only
 * the application can fix — a rejected key (401), a missing scope (403), no
 * credits (402) — is thrown.
 */

import { ToolMessage } from '@langchain/core/messages';
import type { ToolCall } from '@langchain/core/messages/tool';
import {
  StructuredTool,
  ToolInputParsingException,
  type StructuredToolCallInput,
  type ToolParams,
  type ToolReturnType,
  type ToolRunnableConfig,
} from '@langchain/core/tools';
import type { JSONSchema } from '@langchain/core/utils/json_schema';
import { toJson, type Toolset, type ToolName } from 'sproutsdata/tools';

type Args = Record<string, unknown>;

export interface SproutsDataToolFields extends ToolParams {
  /**
   * The toolset that runs the tool. Build it with `include` naming exactly
   * the tools you give the model: a description mentions only tools in its
   * own set. `sproutsDataTools()` builds one for you.
   */
  toolset: Toolset;
}

function isToolCall(value: unknown): value is ToolCall {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'tool_call';
}

/**
 * A Sprouts tool for LangChain, run by a `sproutsdata/tools` toolset.
 *
 * Returns the toolset's canonical JSON string. Throws
 * `AuthenticationError`, `PermissionDeniedError` and
 * `InsufficientCreditsError`; every other failure is returned as data.
 */
export abstract class SproutsDataTool extends StructuredTool<JSONSchema, Args, Args, string> {
  name: string;
  description: string;
  schema: JSONSchema;
  readonly #toolset: Toolset;

  protected constructor(toolName: ToolName, { toolset, ...fields }: SproutsDataToolFields) {
    super(fields);
    const definition = toolset.definitions().find((entry) => entry.name === toolName);
    if (definition === undefined) {
      throw new TypeError(
        `The toolset does not offer ${toolName} (it offers ${toolset.toolNames.join(', ')}). ` +
          `Build it with include naming ${toolName}.`,
      );
    }
    this.name = definition.name;
    this.description = definition.description;
    this.schema = definition.input_schema as JSONSchema;
    this.#toolset = toolset;
  }

  protected async _call(input: Args): Promise<string> {
    return toJson(await this.#toolset.run(this.name, input));
  }

  /**
   * LangChain checks a JSON-schema tool's input against `schema` itself, and
   * throws `ToolInputParsingException` on a mismatch — which would end the
   * agent run, with less to go on than the toolset gives. So a refused input
   * goes to the toolset as it is: it answers with every problem named, or
   * coerces a representation (`"25"` for 25) as the MCP server does and runs
   * the call. LangChain has not started the run's callbacks at that point,
   * and this answer does not start them either.
   */
  override async call<TArg extends StructuredToolCallInput<JSONSchema, Args>, TConfig extends ToolRunnableConfig | undefined>(
    arg: TArg,
    configArg?: TConfig,
    /** @deprecated */
    tags?: string[],
  ): Promise<ToolReturnType<TArg, TConfig, string>> {
    try {
      return await super.call(arg, configArg, tags);
    } catch (err) {
      if (!(err instanceof ToolInputParsingException)) throw err;
      const toolCall = isToolCall(arg) ? arg : configArg?.toolCall;
      const content = await this._call(isToolCall(arg) ? arg.args : (arg as Args));
      const answer =
        toolCall?.id === undefined
          ? content
          : new ToolMessage({ status: 'success', content, tool_call_id: toolCall.id, name: this.name });
      return answer as ToolReturnType<TArg, TConfig, string>;
    }
  }
}

/** `sprouts_search`: companies, people, or documents, from words, filters, or both. */
export class SproutsDataSearchResults extends SproutsDataTool {
  static override lc_name(): string {
    return 'SproutsDataSearchResults';
  }

  constructor(fields: SproutsDataToolFields) {
    super('sprouts_search', fields);
  }
}

/** `sprouts_similar`: companies like one or more anchor companies. */
export class SproutsDataFindSimilar extends SproutsDataTool {
  static override lc_name(): string {
    return 'SproutsDataFindSimilar';
  }

  constructor(fields: SproutsDataToolFields) {
    super('sprouts_similar', fields);
  }
}

/** `sprouts_entity_lookup`: full records for identifiers the model already holds. */
export class SproutsDataEntityLookup extends SproutsDataTool {
  static override lc_name(): string {
    return 'SproutsDataEntityLookup';
  }

  constructor(fields: SproutsDataToolFields) {
    super('sprouts_entity_lookup', fields);
  }
}

/** Spec tool name → class, in the spec's order. */
export const TOOL_CLASSES: Readonly<Record<ToolName, new (fields: SproutsDataToolFields) => SproutsDataTool>> = {
  sprouts_search: SproutsDataSearchResults,
  sprouts_similar: SproutsDataFindSimilar,
  sprouts_entity_lookup: SproutsDataEntityLookup,
};

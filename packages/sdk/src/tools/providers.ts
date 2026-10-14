/**
 * Tool definitions and tool-call plumbing for OpenAI and Anthropic, as plain
 * objects.
 *
 * No provider SDK is imported, here or anywhere in `sproutsdata`. The shapes
 * are small, stable and documented, and building them by hand means the SDK
 * works with whatever version of `openai` or `@anthropic-ai/sdk` an
 * application pins — or with neither, through a gateway that speaks the same
 * JSON. Those SDKs' response objects are plain JSON already, so they are read
 * as they are.
 */

import { ClientValidationError } from '../errors';
import type {
  AnthropicTool,
  AnthropicToolResult,
  JsonSchema,
  OpenAIChatTool,
  OpenAIChatToolMessage,
  OpenAIResponsesTool,
  OpenAIResponsesToolOutput,
  ToolName,
} from './types';
import { isObject } from './validate';

/** Which OpenAI API the tool definitions and answers are for. */
export type OpenAIApi = 'chat' | 'responses';

/** One call a model asked for, whichever API it arrived through. */
export interface ToolCall {
  id: string;
  name: string;
  /** A JSON string from OpenAI, an object from Anthropic. */
  arguments: unknown;
  /** Decides the shape of the answer. */
  kind: OpenAIApi | 'anthropic';
}

/** One function tool, for Chat Completions or for the Responses API. */
export function openaiTool(
  name: ToolName,
  description: string,
  parameters: JsonSchema,
  strict: boolean,
  api: OpenAIApi,
): OpenAIChatTool | OpenAIResponsesTool {
  if (api === 'chat') return { type: 'function', function: { name, description, parameters, strict } };
  return { type: 'function', name, description, parameters, strict };
}

export function checkApi(api: unknown): asserts api is OpenAIApi {
  if (api !== 'chat' && api !== 'responses') {
    throw new ClientValidationError(`api must be 'chat' or 'responses', got '${String(api)}'.`);
  }
}

export function anthropicTool(name: ToolName, description: string, schema: JsonSchema): AnthropicTool {
  return { name, description, input_schema: schema };
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

function str(value: unknown): string {
  return value === undefined ? '' : String(value);
}

/**
 * Every function call in an OpenAI message, response, or list of either's
 * parts: a Chat Completions assistant message (or its `tool_calls`), or a
 * Responses API response (or its `output` items). Output items that are not
 * function calls — text, reasoning — are passed over: they need no answer.
 */
export function openaiCalls(message: unknown): ToolCall[] {
  let items: unknown;
  if (isObject(message)) {
    if ('tool_calls' in message) items = message.tool_calls ?? [];
    else if ('output' in message) items = message.output ?? [];
    else items = [message];
  } else if (Array.isArray(message)) {
    items = message;
  } else {
    throw new TypeError(
      'Expected an OpenAI assistant message, a Responses API response, or a list of tool ' +
        `calls; got ${describe(message)}.`,
    );
  }

  const calls: ToolCall[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!isObject(item)) continue;
    if (item.type === 'function_call') {
      calls.push({ id: str(item.call_id), name: str(item.name), arguments: item.arguments, kind: 'responses' });
    } else if ('function' in item) {
      const fn = isObject(item.function) ? item.function : {};
      calls.push({ id: str(item.id), name: str(fn.name), arguments: fn.arguments, kind: 'chat' });
    }
  }
  return calls;
}

/** Every `tool_use` block in an Anthropic message, or in a list of content blocks. */
export function anthropicCalls(message: unknown): ToolCall[] {
  let blocks: unknown;
  if (isObject(message)) blocks = message.content ?? [];
  else if (Array.isArray(message)) blocks = message;
  else {
    throw new TypeError(
      `Expected an Anthropic message or a list of content blocks; got ${describe(message)}.`,
    );
  }

  const calls: ToolCall[] = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (isObject(block) && block.type === 'tool_use') {
      calls.push({ id: str(block.id), name: str(block.name), arguments: block.input, kind: 'anthropic' });
    }
  }
  return calls;
}

/** The answer to one Chat Completions call. */
export function chatAnswer(call: ToolCall, content: string): OpenAIChatToolMessage {
  return { role: 'tool', tool_call_id: call.id, content };
}

/** The answer to one Responses API call. */
export function responsesAnswer(call: ToolCall, content: string): OpenAIResponsesToolOutput {
  return { type: 'function_call_output', call_id: call.id, output: content };
}

/**
 * The answer to one Anthropic call. `is_error` is Anthropic's own signal that
 * the tool failed; OpenAI has none, and reads the `error` object in the
 * content instead.
 */
export function anthropicAnswer(call: ToolCall, content: string, isError: boolean): AnthropicToolResult {
  const block: AnthropicToolResult = { type: 'tool_result', tool_use_id: call.id, content };
  if (isError) block.is_error = true;
  return block;
}

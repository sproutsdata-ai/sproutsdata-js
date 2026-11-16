/**
 * `sproutsDataTools`: the Sprouts tools as Vercel AI SDK tools.
 *
 * Framework glue and nothing else. The names, descriptions and input schemas
 * come from `sproutsdata/tools`, so a model sees exactly the contract the
 * Sprouts MCP server and every other surface use, and a
 * call goes to `Toolset.run`, which validates the arguments, applies the
 * developer's settings, calls the API and shapes the answer.
 *
 * The AI SDK does no validation of its own here: `jsonSchema()` without a
 * `validate` function hands the model's arguments through unchecked. The
 * toolset checks them, and what a model can fix (an unknown argument, a
 * wrong type, a broken tool rule, a 404, 422, 429 or 5xx, a timeout) comes
 * back as an `{ error: {...} }` result, never as an exception.
 */

import { jsonSchema, type JSONSchema7, type Tool, tool } from 'ai';
import { type ConnectionOptions, resolveClient, Toolset, type ToolResult, type ToolsetOptions } from 'sproutsdata/tools';

/** One Sprouts tool: the arguments a model sent, answered with a {@link ToolResult}. */
export type SproutsDataTool = Tool<Record<string, unknown>, ToolResult>;

/**
 * How to reach the API (a `client`, used as it is, or the settings to build one) and the
 * toolset's settings the model cannot change.
 */
export interface SproutsDataToolsOptions extends ConnectionOptions, ToolsetOptions {}

/**
 * `sprouts_search`, `sprouts_similar` and `sprouts_entity_lookup` as AI SDK
 * tools, keyed by those names — the names the model sees.
 *
 * ```ts
 * const result = await generateText({
 *   model,
 *   tools: sproutsDataTools(),
 *   stopWhen: [stepCountIs(5), raiseSproutsDataErrors],
 *   prompt: 'Find payments companies in Germany.',
 * });
 * ```
 *
 * Every tool shares one client and one `Toolset`. The client is resolved
 * here, so a missing key, a refused base URL or a connection setting beside
 * a client throws `ClientValidationError` where the tools are made, before
 * any model call: build them inside a request handler where the environment
 * is only set at run time.
 *
 * A tool resolves to the toolset's result object. It throws only what the
 * model cannot fix (`AuthenticationError`, `PermissionDeniedError`,
 * `InsufficientCreditsError`), and the AI SDK records a throw as a
 * `tool-error` for the model rather than rejecting; add
 * {@link raiseSproutsDataErrors} to `stopWhen` to have them reject the call.
 */
export function sproutsDataTools(options: SproutsDataToolsOptions = {}): Record<string, SproutsDataTool> {
  const { client, apiKey, baseUrl, timeoutMs, maxRetries, ...settings } = options;
  const toolset = new Toolset(resolveClient({ client, apiKey, baseUrl, timeoutMs, maxRetries }), settings);
  const tools: Record<string, SproutsDataTool> = {};
  for (const definition of toolset.definitions()) {
    tools[definition.name] = tool({
      description: definition.description,
      // The spec's own schema, which the tool specs keep to plain JSON Schema.
      inputSchema: jsonSchema<Record<string, unknown>>(definition.input_schema as JSONSchema7),
      execute: (input) => toolset.run(definition.name, input),
    });
  }
  return tools;
}

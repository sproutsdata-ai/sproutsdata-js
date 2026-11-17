/**
 * Which tools a toolset offers, and how each is described to a model: the spec's schemas with
 * the application's fixed arguments taken out of the model's view.
 */

import { ClientValidationError } from '../index.js';
import { composeDescription, SHORT_NAMES, TOOL_NAMES, toolName, toolSpec } from './catalog.js';
import { anthropicTool, checkApi, openaiTool } from './providers.js';
import { strictSchema } from './strict.js';
import type { AnthropicTool, JsonSchema, OpenAIChatTool, OpenAIResponsesTool, ToolDefinition, ToolName, ToolSettings } from './types.js';
import { dropNulls, isObject, validate } from './validate.js';

/** One offered tool, as the model sees it and as the toolset checks it. */
export interface OfferedTool {
  readonly name: ToolName;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly strictInputSchema: JsonSchema;
  readonly refusedArguments: Readonly<Record<string, string>>;
  readonly fullSchema: JsonSchema;
}

/** The tools to offer, in emitting order; short names (`search`) accepted. */
export function resolveNames(names: unknown): readonly ToolName[] {
  if (names === undefined) return TOOL_NAMES;
  if (typeof names === 'string') throw new ClientValidationError('include must be a list of tool names, not a single string.');
  if (!Array.isArray(names)) throw new ClientValidationError('include must be a list of tool names.');
  const resolved = new Set(
    names.map((name: unknown) => {
      const full = typeof name === 'string' ? toolName(name) : undefined;
      if (full === undefined) {
        throw new ClientValidationError(
          `Unknown tool '${String(name)}'. Choose from ${TOOL_NAMES.join(', ')} (or ${Object.keys(SHORT_NAMES).join(', ')}).`,
        );
      }
      return full;
    }),
  );
  if (resolved.size === 0) throw new ClientValidationError('include must name at least one tool.');
  return TOOL_NAMES.filter((name) => resolved.has(name));
}

/**
 * Developer-set arguments (`fixed`, `defaults`), checked against each tool's schema. Refused at
 * construction: a typo here would otherwise surface as a model mysteriously unable to do
 * something, long after deployment.
 */
export function checkSettings(option: string, settings: ToolSettings | undefined, included: readonly ToolName[]): Map<ToolName, Record<string, unknown>> {
  const checked = new Map<ToolName, Record<string, unknown>>();
  for (const [name, values] of Object.entries(settings ?? {})) {
    const tool = toolName(name);
    if (tool === undefined || !included.includes(tool)) {
      throw new ClientValidationError(`${option} names '${name}', which is not in this toolset (${included.join(', ')}).`);
    }
    const schema = toolSpec(tool).input_schema;
    const [value, problems] = validate({ ...schema, required: [] }, dropNulls(values), [option, tool]);
    if (problems.length > 0) throw new ClientValidationError(`Invalid ${option}: ${problems.join('; ')}`);
    checked.set(tool, isObject(value) ? { ...value } : {});
  }
  return checked;
}

function without(schema: JsonSchema, names: readonly string[]): JsonSchema {
  const properties = Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([name]) => !names.includes(name)));
  const required = schema.required?.filter((name) => !names.includes(name));
  return required === undefined ? { ...schema, properties } : { ...schema, properties, required };
}

/** Which tools are offered, and how each is described to a model. */
export class Catalog {
  readonly included: readonly ToolName[];
  readonly fixed: ReadonlyMap<ToolName, Readonly<Record<string, unknown>>>;
  readonly offered: ReadonlyMap<ToolName, OfferedTool>;

  constructor(include: unknown, fixed: ToolSettings | undefined) {
    this.included = resolveNames(include);
    this.fixed = checkSettings('fixed', fixed, this.included);
    this.offered = new Map(
      this.included.map((name) => {
        const spec = toolSpec(name);
        const hidden = Object.keys(this.fixed.get(name) ?? {});
        const tool: OfferedTool = {
          name,
          description: composeDescription(name, this.included),
          inputSchema: without(spec.input_schema, hidden),
          strictInputSchema: strictSchema(without(spec.input_schema, hidden)),
          refusedArguments: spec.refused_arguments,
          fullSchema: spec.input_schema,
        };
        return [name, tool];
      }),
    );
  }

  /** Provider-neutral tool specs: `[{ name, description, input_schema }]`. */
  definitions(): ToolDefinition[] {
    return [...this.offered.values()].map((t) => ({ name: t.name, description: t.description, input_schema: structuredClone(t.inputSchema) }));
  }

  /** OpenAI function tools; `strict` sends the strict-mode schema. */
  openai(strict: boolean, api: unknown): (OpenAIChatTool | OpenAIResponsesTool)[] {
    const checked = checkApi(api);
    return [...this.offered.values()].map((t) =>
      openaiTool(t.name, t.description, structuredClone(strict ? t.strictInputSchema : t.inputSchema), strict, checked),
    );
  }

  /** Anthropic Messages tool definitions. */
  anthropic(): AnthropicTool[] {
    return [...this.offered.values()].map((t) => anthropicTool(t.name, t.description, structuredClone(t.inputSchema)));
  }
}

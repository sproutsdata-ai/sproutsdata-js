/**
 * The tool specs, and every sentence the tools write to a model.
 *
 * Nothing a model reads from `sproutsdata/tools` is written in TypeScript. Names, descriptions,
 * schemas, refusals and caveats come from `spec/tools/` (embedded as `specs.gen.ts`), which the
 * Python SDK ships too, so a tool means one thing in both languages and `spec/tools/fixtures/`
 * holds the two to identical output.
 */

import { toJson } from './canonical.js';
import { MESSAGES, SHAPING, TOOL_SPECS } from './specs.gen.js';
import type { ToolName, ToolSpecFile } from './types.js';

export { SHAPING };

export const SEARCH = 'sprouts_search';
export const SIMILAR = 'sprouts_similar';
export const LOOKUP = 'sprouts_entity_lookup';

/** The MCP tool names, in the order definitions are emitted. */
export const TOOL_NAMES: readonly ToolName[] = [SEARCH, SIMILAR, LOOKUP];

/** Accepted in `include` beside the full names, for brevity. */
export const SHORT_NAMES: Readonly<Record<string, ToolName>> = { search: SEARCH, similar: SIMILAR, lookup: LOOKUP };

/** The most rows a model may receive per call: a page of 100 shaped rows is over 20,000 tokens. */
export const MAX_RESULTS_CEILING: number = SHAPING.max_results_ceiling;

const PLACEHOLDER = /\{([a-z_]+)\}/g;

/** One of the three tool names, else `undefined`. */
export function toolName(name: string): ToolName | undefined {
  return TOOL_NAMES.find((known) => known === name) ?? SHORT_NAMES[name];
}

/** One tool's spec file, as a fresh copy the caller may change. */
export function toolSpec(name: ToolName): ToolSpecFile {
  return structuredClone(TOOL_SPECS[name]);
}

/**
 * A tool's description, naming only tools the model can actually call. Cross-references are
 * appended only when the tool they name is in the same toolset: a description that points at a
 * tool the model was never given is an invitation to call it.
 */
export function composeDescription(name: ToolName, included: readonly ToolName[]): string {
  const spec = TOOL_SPECS[name];
  const hints = Object.entries(spec.description_hints).flatMap(([tool, hint]) =>
    included.some((offered) => offered === tool) ? [hint] : [],
  );
  return [spec.description, ...hints].join('\n\n');
}

/** A value as it appears inside a sentence: strings verbatim, the rest as JSON. */
export function render(value: unknown): string {
  return typeof value === 'string' ? value : toJson(value);
}

/** A section of `messages.json`. */
export type MessageSection = 'validation' | 'rules' | 'caveats' | 'errors';

/** A message from `messages.json`, with its `{placeholders}` filled in. */
export function text(section: MessageSection, key: string, values: Readonly<Record<string, unknown>> = {}): string {
  const template: string | undefined = MESSAGES[section][key];
  if (template === undefined) throw new Error(`spec/tools/messages.json has no ${section}.${key}`);
  return template.replace(PLACEHOLDER, (_, name: string) => render(values[name]));
}

/** A list inside a sentence: `a, b, c`. */
export function join(values: readonly unknown[]): string {
  return values.map(render).join(', ');
}

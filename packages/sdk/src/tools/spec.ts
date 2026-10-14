/**
 * The tool specs, and every sentence this module writes to a model.
 *
 * Nothing a model reads from `sproutsdata/tools` is written in TypeScript.
 * Names, descriptions, schemas, refusals and caveats all come from
 * `spec/tools/` (embedded in `specs.gen.ts`), which the Python SDK's
 * `sproutsdata.tools` is built from too — so a tool means one thing in both
 * languages, and `spec/tools/fixtures/` holds the two to identical output.
 *
 * {@link toJson} is the other half of that promise: the one serialisation
 * every result goes through, defined tightly enough that both languages
 * produce the same bytes.
 */

import { MESSAGES, SHAPING, TOOL_SPECS } from './specs.gen';
import type { JsonSchema, ToolName, ToolSpecFile } from './types';

export { SHAPING };

export const SEARCH = 'sprouts_search';
export const SIMILAR = 'sprouts_similar';
export const LOOKUP = 'sprouts_entity_lookup';

/** The frozen MCP tool names, in the order definitions are emitted. */
export const TOOL_NAMES: readonly ToolName[] = [SEARCH, SIMILAR, LOOKUP];

/** Accepted in `include` beside the full names, for brevity. */
export const SHORT_NAMES: Readonly<Record<string, ToolName>> = {
  search: SEARCH,
  similar: SIMILAR,
  lookup: LOOKUP,
};

const PLACEHOLDER = /\{([a-z_]+)\}/g;

/** A deep copy of JSON data, so a caller can change what it is handed. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** One tool's spec file, as a fresh copy the caller may change. */
export function toolSpec(name: ToolName): ToolSpecFile {
  return clone(TOOL_SPECS[name]);
}

/** One tool's loose input schema, shared and read-only. */
export function inputSchema(name: ToolName): JsonSchema {
  return TOOL_SPECS[name].input_schema;
}

/**
 * A tool's description, naming only tools the model can actually call.
 *
 * Cross-references live apart from the body, keyed by the tool they name,
 * and are appended only when that tool is in the same toolset. A
 * description that points at a tool the model was never given is an
 * invitation to call it.
 */
export function composeDescription(name: ToolName, included: readonly ToolName[]): string {
  const spec = TOOL_SPECS[name];
  const hints = Object.entries(spec.description_hints)
    .filter(([tool]) => included.includes(tool as ToolName))
    .map(([, hint]) => hint);
  return [spec.description, ...hints].join('\n\n');
}

/** A value as it appears inside a sentence: strings verbatim, the rest as JSON. */
export function render(value: unknown): string {
  return typeof value === 'string' ? value : toJson(value);
}

/** A list inside a sentence: `a, b, c`. */
export function join(values: readonly unknown[]): string {
  return values.map(render).join(', ');
}

type Messages = typeof MESSAGES;
type Section = 'validation' | 'rules' | 'caveats' | 'errors';

/** A message from `messages.json`, with its `{placeholders}` filled in. */
export function text<S extends Section>(
  section: S,
  key: keyof Messages[S] & string,
  values: Readonly<Record<string, unknown>> = {},
): string {
  // The key is checked against the generated data at compile time.
  const template = (MESSAGES[section] as Readonly<Record<string, string>>)[key] as string;
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    if (!(name in values)) throw new Error(`messages.json ${section}.${key} needs a value for {${name}}`);
    return render(values[name]);
  });
}

/**
 * Two strings in Unicode code point order, which is how Python sorts them.
 * JavaScript's default sort compares UTF-16 code units, which puts a
 * character above U+FFFF before one in U+E000–U+FFFF.
 */
function byCodePoint(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i) ?? 0;
    const y = b.codePointAt(j) ?? 0;
    if (x !== y) return x - y;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  return a.length - i - (b.length - j);
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function write(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new RangeError(`${value} has no JSON representation`);
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(write).join(',')}]`;
      if (!isPlainObject(value)) {
        throw new TypeError(`${String(value)} is not JSON-serialisable`);
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort(byCodePoint);
      return `{${keys.map((key) => `${JSON.stringify(key)}:${write(record[key])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`${typeof value} is not JSON-serialisable`);
  }
}

/**
 * The canonical text of a tool result: what a model is handed, and what the
 * cross-language fixtures compare byte for byte.
 *
 * Keys sorted by code point, separators `,` and `:` with no spaces (the
 * spaced form costs about a fifth more tokens), non-ASCII characters as
 * themselves, and numbers as JavaScript writes them — so `5000000.0` from
 * Python and `5000000` from here are the same text. An object member set to
 * `undefined` is left out, as `JSON.stringify` does; a non-finite number, a
 * non-plain object and anything else JSON cannot hold are refused.
 */
export function toJson(value: unknown): string {
  return write(value);
}

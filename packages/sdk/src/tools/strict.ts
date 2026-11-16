/**
 * A tool's OpenAI strict-mode schema, derived from its loose one as sproutsdata-py's
 * `scripts/gen_tool_schemas.py` derives the `strict_input_schema` in `spec/tools/` (the tests
 * hold the two equal). Deriving it here instead of embedding both keeps `sproutsdata/tools`
 * within its size budget.
 *
 * Strict mode accepts a subset of JSON Schema: every property listed in `required`,
 * `additionalProperties: false` on every object, and an optional argument made nullable. A
 * bound outside the subset moves into the description, where the model still reads it.
 */

import type { JsonSchema, JsonValue } from './types.js';

function literal(value: JsonValue): string {
  return typeof value === 'string' ? `\`${value}\`` : JSON.stringify(value);
}

function bound(low: number | undefined, high: number | undefined, unit: string, nonEmpty: string): string[] {
  if (low !== undefined && high !== undefined) return [unit === '' ? `Between ${String(low)} and ${String(high)}.` : `${String(low)}-${String(high)} ${unit}.`];
  if (low === 1 && unit !== '') return [nonEmpty];
  if (low !== undefined) return [unit === '' ? `At least ${String(low)}.` : `At least ${String(low)} ${unit}.`];
  if (high !== undefined) return [unit === '' ? `At most ${String(high)}.` : `At most ${String(high)} ${unit}.`];
  return [];
}

function notes(schema: JsonSchema): string[] {
  const out = [
    ...bound(schema.minLength, schema.maxLength, 'characters', 'Not empty.'),
    ...bound(schema.minItems, schema.maxItems, 'items', 'At least one item.'),
    ...bound(schema.minimum, schema.maximum, '', ''),
  ];
  if (schema.default !== undefined) out.push(`Default: ${literal(schema.default)}.`);
  return out;
}

type Mutable = { -readonly [K in keyof JsonSchema]: JsonSchema[K] };

function children(schema: JsonSchema, kind: string, out: Mutable): void {
  if (kind === 'object') {
    const required = new Set(schema.required ?? []);
    const properties = schema.properties ?? {};
    out.properties = Object.fromEntries(Object.entries(properties).map(([name, child]) => [name, strictSchema(child, !required.has(name))]));
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  } else if (kind === 'array' && schema.items !== undefined) {
    out.items = strictSchema(schema.items);
  }
}

/** The strict-mode form of one schema node; `optional` when its parent left it out of `required`. */
export function strictSchema(schema: JsonSchema, optional = false): JsonSchema {
  const description = [schema.description ?? '', ...notes(schema)].filter((part) => part !== '').join(' ');
  const kind = typeof schema.type === 'string' ? schema.type : (schema.type[0] ?? '');
  const out: Mutable = description === '' ? { type: kind } : { description, type: kind };
  out.type = optional ? [kind, 'null'] : kind;
  if (schema.enum !== undefined) out.enum = optional ? [...schema.enum, null] : [...schema.enum];
  children(schema, kind, out);
  return out;
}

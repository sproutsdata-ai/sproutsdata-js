/**
 * Checking a model's arguments against a tool's input schema.
 *
 * A small validator for exactly the JSON Schema the tool specs use (`type`, `enum`,
 * `properties`, `required`, `additionalProperties: false`, `items`, and the length, size and
 * range bounds) rather than a general one: the SDK takes no dependency for this. The same three
 * rules as the Python SDK's:
 *
 * - **Every problem is reported**, each as `path: problem`, so a model fixes a call in one turn.
 * - **An unknown key is refused**: a silently dropped argument runs a different search from the
 *   one the model asked for, and bills it.
 * - **A representation is coerced; a value is never invented.** `"25"` where an integer belongs
 *   becomes 25, and a bare string where a list of strings belongs becomes a one-item list. An
 *   out-of-range number stays an error.
 *
 * `null` means "not set" and is removed first ({@link dropNulls}), which lets OpenAI strict
 * mode, where optional arguments arrive as `null`, share the loose schema's validation.
 */

import { join, text } from './catalog.js';
import type { JsonSchema } from './types.js';

type Path = readonly (string | number)[];

const DIGITS = /^-?[0-9]+$/;

/** An object a JSON parser could have produced: not null, not an array. */
export function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `value` with every `null` object member removed, at any depth (`__proto__` stays a key). */
export function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null)
        .map(([key, item]) => [key, dropNulls(item)]),
    );
  }
  return value;
}

/**
 * `value` with each absent property that declares a `default` filled in, only inside objects the
 * value has: a default for `sort[].direction` applies to each clause given and never makes a `sort`.
 */
export function applyDefaults(schema: JsonSchema, value: unknown): unknown {
  if (schema.type === 'object' && isObject(value)) {
    const filled: Record<string, unknown> = { ...value };
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(filled, name)) filled[name] = applyDefaults(child, filled[name]);
      else if (child.default !== undefined) filled[name] = structuredClone(child.default);
    }
    return filled;
  }
  const items = schema.items;
  if (schema.type === 'array' && Array.isArray(value) && items !== undefined) {
    return value.map((item: unknown) => applyDefaults(items, item));
  }
  return value;
}

/** `schema` with every property that has a default made required: the shape after {@link applyDefaults}. */
export function withDefaultsRequired(schema: JsonSchema): JsonSchema {
  const properties = schema.properties;
  const items = schema.items;
  if (properties !== undefined) {
    const defaulted = Object.entries(properties).flatMap(([name, child]) => (child.default === undefined ? [] : [name]));
    return {
      ...schema,
      properties: Object.fromEntries(Object.entries(properties).map(([name, child]) => [name, withDefaultsRequired(child)])),
      required: [...new Set([...(schema.required ?? []), ...defaulted])],
    };
  }
  return items === undefined ? schema : { ...schema, items: withDefaultsRequired(items) };
}

function problem(path: Path, key: string, values: Readonly<Record<string, unknown>> = {}): string {
  const label = path.length > 0 ? path.join('.') : text('validation', 'root');
  return `${label}: ${text('validation', key, values)}`;
}

/** Python's `len()` of a string: Unicode code points, not UTF-16 units. */
function codePoints(value: string): number {
  let count = 0;
  for (const _ of value) count++;
  return count;
}

function coerce(schema: JsonSchema, value: unknown): unknown {
  if (schema.type === 'integer' && typeof value === 'string' && DIGITS.test(value.trim())) {
    return Number(value.trim());
  }
  if (schema.type === 'array' && typeof value === 'string' && schema.items?.type === 'string') return [value];
  return value;
}

function isType(kind: string, value: unknown): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    default:
      return false;
  }
}

function bounds(schema: JsonSchema, size: number, path: Path, kind: 'length' | 'items' | 'value'): string[] {
  const [low, high, lowKey, highKey] =
    kind === 'length'
      ? [schema.minLength, schema.maxLength, 'min_length', 'max_length']
      : kind === 'items'
        ? [schema.minItems, schema.maxItems, 'min_items', 'max_items']
        : [schema.minimum, schema.maximum, 'minimum', 'maximum'];
  const problems: string[] = [];
  if (low !== undefined && size < low) problems.push(problem(path, lowKey, { limit: low }));
  if (high !== undefined && size > high) problems.push(problem(path, highKey, { limit: high }));
  return problems;
}

/** Check `value` against `schema`. Returns the coerced value and every problem. */
export function validate(schema: JsonSchema, input: unknown, path: Path = []): [unknown, string[]] {
  const value = coerce(schema, input);
  const kind = typeof schema.type === 'string' ? schema.type : '';
  if (!isType(kind, value)) return [value, [problem(path, 'type', { expected: kind })]];
  const problems: string[] = [];
  if (schema.enum !== undefined && !schema.enum.some((allowed) => allowed === value)) {
    problems.push(problem(path, 'enum', { allowed: join(schema.enum) }));
  }
  if (typeof value === 'string') return [value, [...problems, ...bounds(schema, codePoints(value), path, 'length')]];
  if (typeof value === 'number') return [value, [...problems, ...bounds(schema, value, path, 'value')]];
  if (Array.isArray(value)) return validateArray(schema, value, path, problems);
  if (isObject(value)) {
    const [checked, found] = validateObject(schema, value, path);
    return [checked, [...problems, ...found]];
  }
  return [value, problems];
}

function validateArray(schema: JsonSchema, value: readonly unknown[], path: Path, problems: string[]): [unknown, string[]] {
  const found = [...problems, ...bounds(schema, value.length, path, 'items')];
  const itemSchema = schema.items;
  if (itemSchema === undefined) return [value, found];
  const items = value.map((item, index) => {
    const [checked, itemProblems] = validate(itemSchema, item, [...path, index]);
    found.push(...itemProblems);
    return checked;
  });
  return [items, found];
}

/** Unknown keys (input order), then missing required keys, then each property (schema order). */
function validateObject(schema: JsonSchema, value: Readonly<Record<string, unknown>>, path: Path): [Record<string, unknown>, string[]] {
  const properties = schema.properties ?? {};
  const allowed = join(Object.keys(properties));
  const problems = Object.keys(value)
    .filter((key) => !Object.hasOwn(properties, key))
    .map((key) => problem([...path, key], 'unknown_argument', { allowed }));
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key)) problems.push(problem([...path, key], 'required'));
  }
  const checked: [string, unknown][] = [];
  for (const [name, child] of Object.entries(properties)) {
    if (!Object.hasOwn(value, name)) continue;
    const [item, found] = validate(child, value[name], [...path, name]);
    checked.push([name, item]);
    problems.push(...found);
  }
  return [Object.fromEntries(checked), problems];
}

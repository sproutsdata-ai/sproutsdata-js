/**
 * Checking a model's arguments against a tool's input schema.
 *
 * A small validator for exactly the JSON Schema the tool specs use — `type`,
 * `enum`, `properties`, `required`, `additionalProperties: false`, `items`,
 * and the length, size and range bounds — rather than a general one. The SDK
 * takes no dependency for this, and a validator that understood more of the
 * standard than the specs use would be code nobody exercises.
 *
 * Three rules decide what it does with a model's input, the same as the
 * Python SDK's:
 *
 * - **Every problem is reported, not just the first**, each as
 *   `path: problem`, so a model can fix a call in one turn.
 * - **An unknown key is refused** (`additionalProperties: false`
 *   everywhere). A silently dropped argument — an MCP-style `country`, a
 *   misspelt `limt` — runs a different search from the one asked for, and
 *   bills it.
 * - **A representation is coerced; a value is never invented.** `"25"` where
 *   an integer belongs becomes 25, and a bare string where a list of strings
 *   belongs becomes a one-item list. An out-of-range number stays an error.
 *   These are the MCP server's coercions, so one input means one thing on
 *   every surface.
 *
 * `null` means "not set" and is removed before validation
 * ({@link dropNulls}), which is what lets OpenAI strict mode — where every
 * argument is required and optional ones arrive as `null` — share the loose
 * schema's validation.
 */

import { clone, join, text } from './spec';
import type { JsonSchema } from './types';

type Path = ReadonlyArray<string | number>;

const DIGITS = /^-?[0-9]+$/;

/** An object a JSON parser could have produced: not null, not an array. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * `value` with every `null` object member removed, at any depth. Objects are
 * rebuilt with `Object.fromEntries`, so a `__proto__` key stays a key.
 */
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
 * `value` with each absent property that declares a `default` filled in.
 *
 * Only inside objects the value actually has: a default for
 * `sort[].direction` applies to each sort clause given, and never conjures a
 * `sort`.
 */
export function applyDefaults(schema: JsonSchema, value: unknown): unknown {
  if (schema.type === 'object' && isObject(value)) {
    const filled: Record<string, unknown> = { ...value };
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(filled, name)) filled[name] = applyDefaults(child, filled[name]);
      else if (child.default !== undefined) filled[name] = clone(child.default);
    }
    return filled;
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items !== undefined) {
    const items = schema.items;
    return value.map((item) => applyDefaults(items, item));
  }
  return value;
}

function label(path: Path): string {
  return path.length > 0 ? path.join('.') : text('validation', 'root');
}

function problem(
  path: Path,
  key: Parameters<typeof text<'validation'>>[1],
  values: Readonly<Record<string, unknown>> = {},
): string {
  return `${label(path)}: ${text('validation', key, values)}`;
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
  if (schema.type === 'array' && typeof value === 'string' && schema.items?.type === 'string') {
    return [value];
  }
  return value;
}

function isType(kind: string, value: unknown): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
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

/** Check `value` against `schema`. Returns the coerced value and every problem. */
export function validate(schema: JsonSchema, input: unknown, path: Path = []): [unknown, string[]] {
  const value = coerce(schema, input);
  const kind = String(schema.type);
  if (!isType(kind, value)) return [value, [problem(path, 'type', { expected: kind })]];

  const problems: string[] = [];
  if (schema.enum !== undefined && !schema.enum.includes(value as string)) {
    problems.push(problem(path, 'enum', { allowed: join(schema.enum) }));
  }

  if (typeof value === 'string') {
    const length = codePoints(value);
    if (schema.minLength !== undefined && length < schema.minLength) {
      problems.push(problem(path, 'min_length', { limit: schema.minLength }));
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      problems.push(problem(path, 'max_length', { limit: schema.maxLength }));
    }
    return [value, problems];
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      problems.push(problem(path, 'minimum', { limit: schema.minimum }));
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      problems.push(problem(path, 'maximum', { limit: schema.maximum }));
    }
    return [value, problems];
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      problems.push(problem(path, 'min_items', { limit: schema.minItems }));
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      problems.push(problem(path, 'max_items', { limit: schema.maxItems }));
    }
    const itemSchema = schema.items;
    if (itemSchema === undefined) return [value, problems];
    const items = value.map((item, index) => {
      const [checked, found] = validate(itemSchema, item, [...path, index]);
      problems.push(...found);
      return checked;
    });
    return [items, problems];
  }
  if (isObject(value)) {
    const [checked, found] = validateObject(schema, value, path);
    return [checked, [...problems, ...found]];
  }
  return [value, problems];
}

/**
 * Unknown keys (input order), then missing required keys (schema order),
 * then each property (schema order). The result holds only the schema's
 * properties.
 */
function validateObject(
  schema: JsonSchema,
  value: Record<string, unknown>,
  path: Path,
): [Record<string, unknown>, string[]] {
  const properties = schema.properties ?? {};
  const allowed = join(Object.keys(properties));
  const problems = Object.keys(value)
    .filter((key) => !Object.hasOwn(properties, key))
    .map((key) => problem([...path, key], 'unknown_argument', { allowed }));
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key)) problems.push(problem([...path, key], 'required'));
  }
  const checked: Array<[string, unknown]> = [];
  for (const [name, child] of Object.entries(properties)) {
    if (!Object.hasOwn(value, name)) continue;
    const [item, found] = validate(child, value[name], [...path, name]);
    checked.push([name, item]);
    problems.push(...found);
  }
  return [Object.fromEntries(checked), problems];
}

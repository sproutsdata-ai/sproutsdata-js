/**
 * A request body checked against its type, as the server's models check it: no field the
 * type does not take, every required field, each value within the server's limits and
 * among its closed values, and every nested part against its own type and rules.
 *
 * The types come from `generated/request-shapes.ts` (the spec's request models); the
 * cross-field rules are `RULES` in `filters.ts`, keyed by the same type names.
 */

import { REQUEST_SHAPES, type RequestField, type RequestShape } from '../generated/request-shapes.js';
import { isObject, present, refuse } from './build.js';
import { checkKeywordTree, KEYWORD_TREES, RULES } from './filters.js';

/** Refuse `body` unless the server would accept it as a `type`. */
export function checkShape(what: string, body: unknown, type: string, path = ''): void {
  const shape = REQUEST_SHAPES[type];
  if (shape === undefined) return;
  if (!isObject(body)) refuse(what, `${path || 'body'}: must be an object`);
  const missing = shape.required.find((name) => body[name] === undefined || body[name] === null);
  if (missing !== undefined) refuse(what, `${at(path, missing)}: Field required`);
  // A member left `undefined` is never sent (JSON drops it), so it is not judged: what the server
  // reads is what is checked.
  for (const [name, value] of Object.entries(body)) if (value !== undefined) checkMember(what, shape, name, value, path);
  checkRules(what, body, type, path);
}

function checkRules(what: string, body: Readonly<Record<string, unknown>>, type: string, path: string): void {
  const reason = RULES[type]?.(body);
  if (reason !== undefined) refuse(what, path ? `${path}: ${reason}` : reason);
  const tree = KEYWORD_TREES[type];
  if (tree !== undefined && present(body[tree])) checkKeywordTree(what, body[tree], at(path, tree));
}

function checkMember(what: string, shape: RequestShape, name: string, value: unknown, path: string): void {
  const field = shape.fields[name];
  if (field === undefined) refuse(what, `${at(path, name)}: not a field this request takes`);
  if (present(value)) checkField(what, value, field, at(path, name));
}

function checkField(what: string, value: unknown, field: RequestField, path: string): void {
  if (typeof value === 'string' || Array.isArray(value)) {
    bound(what, path, value.length, field.minLength, field.maxLength, typeof value === 'string' ? ' characters' : ' entries');
  }
  if (typeof value === 'number') bound(what, path, value, field.minimum, field.maximum, '');
  const entries: readonly unknown[] = Array.isArray(value) ? value : [value];
  entries.forEach((entry, index) => {
    checkEntry(what, entry, field, Array.isArray(value) ? `${path}[${String(index)}]` : path);
  });
}

function checkEntry(what: string, entry: unknown, field: RequestField, path: string): void {
  if (field.values !== undefined && !field.values.some((allowed) => allowed === entry)) {
    refuse(what, `${path}: must be one of ${field.values.map((v) => JSON.stringify(v)).join(', ')}`);
  }
  if (field.type !== undefined) checkShape(what, entry, field.type, path);
}

function bound(what: string, path: string, actual: number, min: number | undefined, max: number | undefined, unit: string): void {
  if (min !== undefined && actual < min) refuse(what, `${path}: must be at least ${String(min)}${unit} (got ${String(actual)})`);
  if (max !== undefined && actual > max) refuse(what, `${path}: must be at most ${String(max)}${unit} (got ${String(actual)})`);
}

function at(path: string, name: string): string {
  return path ? `${path}.${name}` : name;
}

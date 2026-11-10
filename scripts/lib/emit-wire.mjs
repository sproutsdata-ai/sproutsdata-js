// Renders the model IR (spec/models.json) as TypeScript types: packages/sdk/src/generated/wire.ts.
//
// The IR has already decided what both SDKs must agree on (which schemas are request
// forms and which response forms, every name, every type expression; see
// sproutsdata-py scripts/codegen/ir.py). This file only spells those decisions in
// TypeScript, per direction:
//
// - Response form, from the API (origin `api`): every property is present, because the
//   server serialises every field of its models; nullable ones are `T | null`. Enums
//   are open (`'a' | 'b' | (string & {})`): a member this release does not know still
//   type-checks, as it still parses. An object the schema leaves open gets an
//   `unknown` index signature.
// - Response form, from prism's records (origin `records`): any property may be absent,
//   except `id` and the flexible lists, which the SDK normalises to arrays.
// - Request form: optional unless the schema requires it, closed enums, and readonly
//   everywhere, so a caller can pass a frozen value.

import { docLines } from './generated.mjs';

const PRIMS = { string: 'string', integer: 'number', number: 'number', boolean: 'boolean', null: 'null', any: 'unknown' };
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const isNull = (node) => node.prim === 'null' && node.format === undefined;
const members = (node) => node.union ?? [node];

/**
 * The TypeScript type for an IR type expression, in a response (`output`) or request
 * (`input`) position. `prefix` qualifies each named type (`W.` from another module).
 */
export function renderExpr(node, direction, prefix = '') {
  if (node.ref !== undefined) return `${prefix}${node.ref}`;
  if (node.literal !== undefined) return JSON.stringify(node.literal);
  if (node.array !== undefined) return `readonly ${parenthesise(renderExpr(node.array, direction, prefix))}[]`;
  if (node.map !== undefined) return `Readonly<Record<string, ${renderExpr(node.map, direction, prefix)}>>`;
  if (node.union !== undefined) return renderUnion(node.union, direction, prefix);
  const prim = PRIMS[node.prim];
  if (prim === undefined) throw new Error(`unknown primitive in the IR: ${JSON.stringify(node)}`);
  return prim;
}

function renderUnion(items, direction, prefix) {
  const parts = [...new Set(items.filter((m) => !isNull(m)).map((m) => renderExpr(m, direction, prefix)))];
  // A response's inline enum is open, like a named one: a new member must not break a type.
  const onlyStringLiterals = items.every((m) => isNull(m) || typeof m.literal === 'string');
  if (direction === 'output' && onlyStringLiterals) parts.push('(string & {})');
  if (items.some(isNull)) parts.push('null');
  return parts.join(' | ');
}

/** Parentheses an element type needs before `[]`: a union, or an array that is itself readonly. */
function parenthesise(type) {
  const union = /[|&]/.test(type) && !type.startsWith('Readonly<');
  return union || type.startsWith('readonly ') ? `(${type})` : type;
}

function property(name) {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

function renderField(field, named) {
  const doc = field.description ? docLines(field.description, '  ') : [];
  const key = property(field.name);
  if (named.direction === 'input') {
    const optional = field.required ? '' : '?';
    return [...doc, `  readonly ${key}${optional}: ${renderExpr(field.type, 'input')};`];
  }
  if (named.origin === 'records' && field.flex_list === true) {
    const inner = members(field.type).filter((m) => !isNull(m));
    return [...doc, `  readonly ${key}: ${renderExpr(inner.length === 1 ? inner[0] : { union: inner }, 'output')};`];
  }
  const optional = named.origin === 'records' && !field.required ? '?' : '';
  return [...doc, `  readonly ${key}${optional}: ${renderExpr(field.type, 'output')};`];
}

function renderObject(name, named) {
  const doc = named.description ? docLines(named.description, '') : [];
  const fields = named.fields.flatMap((field) => renderField(field, named));
  const open = named.direction === 'output' ? named.additional !== false : named.additional === true;
  if (fields.length === 0 && !open) return [...doc, `export type ${name} = Readonly<Record<string, never>>;`];
  if (open) fields.push('  readonly [key: string]: unknown;');
  return [...doc, `export interface ${name} {`, ...fields, '}'];
}

function renderEnum(name, named) {
  const doc = named.description ? docLines(named.description, '') : [];
  const values = named.values.map((value) => JSON.stringify(value));
  if (named.direction === 'output') values.push('(string & {})');
  return [...doc, `export type ${name} =`, ...values.map((v, i) => `  | ${v}${i === values.length - 1 ? ';' : ''}`)];
}

function renderNamedUnion(name, named) {
  const doc = named.description ? docLines(named.description, '') : [];
  const variants = [...new Set(named.variants.map((v) => renderExpr(v, named.direction)))];
  return [...doc, `export type ${name} =`, ...variants.map((v, i) => `  | ${v}${i === variants.length - 1 ? ';' : ''}`)];
}

/** The whole of generated/wire.ts for an IR document. */
export function renderWire(ir) {
  const out = [
    '// Generated by scripts/generate.mjs from spec/models.json. Do not edit: change the',
    '// spec in sproutsdata-py, re-sync it, and regenerate.',
    '//',
    '// Every request and response type of the Sprouts Data API. Types only: nothing here',
    '// reaches the runtime bundle. The public names are in src/types/.',
  ];
  for (const [name, named] of Object.entries(ir.types).sort(([a], [b]) => (a < b ? -1 : 1))) {
    out.push('');
    if (named.kind === 'object') out.push(...renderObject(name, named));
    else if (named.kind === 'enum') out.push(...renderEnum(name, named));
    else if (named.kind === 'union') out.push(...renderNamedUnion(name, named));
    else throw new Error(`unknown kind ${named.kind} for ${name}`);
  }
  return `${out.join('\n')}\n`;
}

/**
 * The runtime shape of each record type, for the normaliser that turns a raw record's
 * flexible lists into arrays (null -> [], a bare value -> [value]): which fields are
 * flexible lists, and which fields hold another record type to walk into.
 */
export function renderRecordShapes(ir) {
  const records = Object.entries(ir.types)
    .filter(([, named]) => named.origin === 'records' && named.kind === 'object')
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const out = [
    '// Generated by scripts/generate.mjs from spec/models.json. Do not edit.',
    '',
    '/** How to normalise one record type: its flexible lists, and the fields holding another record. */',
    'export interface RecordShape {',
    '  readonly lists: readonly string[];',
    '  readonly nested: Readonly<Record<string, string>>;',
    '}',
    '',
    '/** Every record type, by name. */',
    'export const RECORD_SHAPES: Readonly<Record<string, RecordShape>> = {',
  ];
  for (const [name, named] of records) {
    const lists = named.fields.filter((f) => f.flex_list === true).map((f) => JSON.stringify(f.name));
    const nested = named.fields.flatMap((f) => {
      const refs = members(f.type).flatMap((m) => (m.ref !== undefined ? [m.ref] : m.array?.ref !== undefined ? [m.array.ref] : []));
      return refs.length === 1 ? [`${property(f.name)}: ${JSON.stringify(refs[0])}`] : [];
    });
    out.push(`  ${name}: {`, `    lists: [${lists.join(', ')}],`, `    nested: { ${nested.join(', ')} },`, '  },');
  }
  out.push('};', '', '/** The record type each result category answers with. */', 'export const RECORD_TYPES: Readonly<Record<string, string>> = {');
  for (const [category, name] of Object.entries(ir.records).sort(([a], [b]) => (a < b ? -1 : 1))) {
    out.push(`  ${category}: ${JSON.stringify(name)},`);
  }
  out.push('};', '');
  return out.join('\n');
}


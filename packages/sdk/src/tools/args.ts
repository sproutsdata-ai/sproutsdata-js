/**
 * A model's arguments, from what it sent to the typed arguments a plan is made from.
 *
 * Each tool's argument type is generated from its input schema (`specs.gen.ts`), and each guard
 * here checks a value against that same schema (defaults applied), so a value the guard passes
 * is the type it claims. The client's parameter types are narrower than the tool schemas in one
 * place (a sort field is a closed list the tool schema leaves open); the client checks every
 * body before sending and throws `ClientValidationError`, which the toolset returns to the
 * model, so {@link isSearchParams} needs to check no more than the shape it routes on.
 */

import type { SearchParams, SimilarParams } from '../index.js';
import { text } from './catalog.js';
import { error, type ErrorResult } from './errors.js';
import { TOOL_SPECS, type LookupArguments, type SearchArguments, type SimilarArguments } from './specs.gen.js';
import { isObject, validate, withDefaultsRequired } from './validate.js';

export type { LookupArguments, SearchArguments, SimilarArguments };

const FULL = {
  sprouts_search: withDefaultsRequired(TOOL_SPECS.sprouts_search.input_schema),
  sprouts_similar: withDefaultsRequired(TOOL_SPECS.sprouts_similar.input_schema),
  sprouts_entity_lookup: withDefaultsRequired(TOOL_SPECS.sprouts_entity_lookup.input_schema),
};

const conforms = (schema: typeof FULL.sprouts_search, value: unknown): boolean => validate(schema, value)[1].length === 0;

/** `value` is complete `sprouts_search` arguments. */
export function isSearchArguments(value: unknown): value is SearchArguments {
  return conforms(FULL.sprouts_search, value);
}

/** `value` is complete `sprouts_similar` arguments. */
export function isSimilarArguments(value: unknown): value is SimilarArguments {
  return conforms(FULL.sprouts_similar, value);
}

/** `value` is complete `sprouts_entity_lookup` arguments. */
export function isLookupArguments(value: unknown): value is LookupArguments {
  return conforms(FULL.sprouts_entity_lookup, value);
}

/** Search parameters built from checked arguments; the client checks the rest. */
export function isSearchParams(value: unknown): value is SearchParams {
  return isObject(value) && typeof value['category'] === 'string';
}

/** Look-alike parameters built from checked arguments; the client checks the rest. */
export function isSimilarParams(value: unknown): value is SimilarParams {
  return isObject(value) && Array.isArray(value['anchors']);
}

/**
 * `(arguments, undefined)` as an object, or `(undefined, error result)` saying why not. An empty
 * string or nothing is an empty object (some providers send `""`).
 */
export function parseArguments(args: unknown): [Readonly<Record<string, unknown>>, undefined] | [undefined, ErrorResult] {
  if (args === undefined || args === null || args === '') return [{}, undefined];
  let parsed: unknown = args;
  if (typeof args === 'string') {
    try {
      parsed = JSON.parse(args);
    } catch {
      return [undefined, error('invalid_arguments', text('validation', 'not_json'))];
    }
  }
  if (!isObject(parsed)) return [undefined, error('invalid_arguments', text('validation', 'not_an_object'))];
  return [parsed, undefined];
}

/**
 * Responses, as a model reads them (`spec/tools/README.md`, "Result shape").
 *
 * A raw page of ten companies is about 17,600 tokens; shaped, about 2,300. Four rules, all in
 * `spec/tools/shaping.json` so the Python SDK cuts identically: rows are projected (company and
 * person to a default field set, or to the `fields` named), absent values are dropped, long text
 * is cut, and long lists are capped with the values the request asked for first.
 *
 * Never cut: the totals, `interpreted_as`, `caveats`, `suggestion` and `request_id`, which are
 * how a model knows what it is looking at.
 */

import { type EntitiesEnvelope, lookupRef, type SearchEnvelope, type SearchHit } from '../index.js';
import { join, render, SHAPING, text } from './catalog.js';
import type { InterpretedAs, LookupToolResult, SearchToolResult, SparseFilterNote } from './types.js';
import { isObject } from './validate.js';

const PROJECTIONS = SHAPING.default_projection;
const SKIPPED: ReadonlySet<string> = new Set(SHAPING.resolved_filters_skipped);
const SEARCH_ID = new RegExp(SHAPING.search_id_pattern, 'u');
/** Rows whose lookup value comes from their record, and can be missing. */
const ADDRESSABLE: ReadonlySet<string> = new Set(['company', 'person']);

/** Field name to the lower-cased values the request asked for, for list ordering. */
export type Wanted = ReadonlyMap<string, ReadonlySet<string>>;

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' || Array.isArray(value)) return value.length === 0;
  return isObject(value) && Object.keys(value).length === 0;
}

/** The entry that ends a capped list. */
function moreMarker(count: number): string {
  return SHAPING.more_marker.replace('{count}', render(count));
}

function capList(values: readonly unknown[], limit: number): unknown[] {
  return values.length <= limit ? [...values] : [...values.slice(0, limit), moreMarker(values.length - limit)];
}

/** A string cut to the shaping length, counted in code points as Python counts them. */
function cutText(value: string): string {
  let kept = '';
  let count = 0;
  for (const point of value) {
    if (count === SHAPING.text_max_chars) return kept + SHAPING.ellipsis;
    kept += point;
    count += 1;
  }
  return value;
}

/** One value, trimmed. `wanted` moves a list's matching strings first. */
function compact(value: unknown, wanted?: ReadonlySet<string>): unknown {
  if (typeof value === 'string') return cutText(value);
  if (Array.isArray(value)) {
    const items = value.map((item: unknown) => compact(item)).filter((item) => !isEmpty(item));
    const hit = (item: unknown): boolean => typeof item === 'string' && wanted?.has(item.toLowerCase()) === true;
    // A stable partition: the original order holds within each half.
    return capList([...items.filter(hit), ...items.filter((item) => !hit(item))], SHAPING.list_max_entries);
  }
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const compacted = compact(item);
      if (!isEmpty(compacted)) out[key] = compacted;
    }
    return out;
  }
  return value;
}

/** A row or record, projected and trimmed. Absent fields are never invented. */
function compactRecord(
  record: Readonly<Record<string, unknown>>,
  category: string,
  fields: readonly string[] | undefined,
  wanted: Wanted = new Map(),
): Record<string, unknown> {
  const keep: ReadonlySet<string> | undefined =
    fields !== undefined ? new Set([...fields, ...SHAPING.identity_fields]) : category in PROJECTIONS ? new Set(PROJECTIONS[category]) : undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (keep !== undefined && !keep.has(key)) continue;
    const compacted = compact(value, wanted.get(key));
    if (!isEmpty(compacted)) out[key] = compacted;
  }
  return out;
}

/** The literal values inside one filter, whatever its shape. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return isObject(value) ? strings(value['include']) : [];
}

/**
 * What the request asked for, per field: its own filters plus the parser's. "Companies using
 * HubSpot" carries no `technology` filter from the caller, but the engine inferred one, and each
 * row's list has to show it.
 */
export function wantedValues(...filterSets: (Readonly<Record<string, unknown>> | null | undefined)[]): Wanted {
  const wanted = new Map<string, Set<string>>();
  for (const filters of filterSets) {
    for (const [name, value] of Object.entries(filters ?? {})) {
      const set = wanted.get(name) ?? new Set<string>();
      for (const item of strings(value)) set.add(item.toLowerCase());
      wanted.set(name, set);
    }
  }
  return wanted;
}

function degradation(entries: readonly { readonly reason: string; readonly detail: string; readonly impact: string }[]): string[] {
  return entries.map((d) => text('caveats', 'degradation', { reason: d.reason, detail: d.detail, impact: d.impact }));
}

/** The filters a search resolved to, without a look-alike's anchors and `combine`. */
function resolvedFilters(resolved: SearchEnvelope['resolved_search']): Record<string, unknown> {
  const filters = resolved?.filters ?? {};
  return Object.fromEntries(Object.entries(filters).filter(([key]) => !SKIPPED.has(key)));
}

/** Whether words were sent and nothing parsed them (`parser_version: "none"`). */
function parserSkipped(resolved: SearchEnvelope['resolved_search'], askedInWords: boolean): boolean {
  if (resolved === null || !askedInWords) return false;
  return (resolved.parser_version === '' || resolved.parser_version === 'none') && Object.keys(resolvedFilters(resolved)).length === 0;
}

/** `resolved_search` as the model needs it. Present even when the server sent none. */
export function interpretedAs(resolved: SearchEnvelope['resolved_search']): InterpretedAs {
  if (resolved === null) return { filters: {}, source: 'none', conflicts: [] };
  const shaped = { filters: resolvedFilters(resolved), source: resolved.filters_source, conflicts: resolved.conflicts };
  // Answers are not validated, and one from an older API has none.
  const sparse: readonly SparseFilterNote[] = resolved.sparse_filters;
  return Array.isArray(sparse) && sparse.length > 0 ? { ...shaped, sparse_filters: sparse } : shaped;
}

function lookupOf(hit: SearchHit): { readonly by?: string; readonly value: string } | undefined {
  const ref = lookupRef(hit);
  if (ref === undefined) return undefined;
  return ref.by === undefined ? { value: ref.value } : { by: ref.by, value: ref.value };
}

/** What a page needs shaped, beside the page itself. */
export interface PageShaping {
  readonly hits: readonly SearchHit[];
  readonly category: string;
  readonly fields: readonly string[] | undefined;
  readonly wanted: Wanted;
  readonly withLookup: boolean;
  readonly askedInWords: boolean;
  readonly caveats: readonly string[];
}

/** A search or look-alike page. `hits` are the page's rows still to be shown. */
export function shapePage(page: SearchEnvelope, shaping: PageShaping): SearchToolResult {
  let unaddressed = 0;
  const rows = shaping.hits.map((hit) => {
    const row = compactRecord(hit, hit.category, shaping.fields, shaping.wanted);
    const lookup = shaping.withLookup ? lookupOf(hit) : undefined;
    if (lookup !== undefined) row['lookup'] = lookup;
    else if (shaping.withLookup && ADDRESSABLE.has(hit.category)) unaddressed += 1;
    return row;
  });
  const notes = degradation(page.degradation);
  if (parserSkipped(page.resolved_search, shaping.askedInWords)) notes.push(text('caveats', 'parser_not_run'));
  notes.push(...shaping.caveats);
  if (unaddressed > 0) notes.push(text('caveats', 'rows_without_lookup', { count: unaddressed, shown: shaping.hits.length }));
  const suggestion = page.suggestion ?? null;
  return {
    results: rows,
    total: page.total,
    total_is_estimate: page.total_is_estimate,
    has_more: page.has_more,
    next_cursor: page.next_cursor ?? null,
    interpreted_as: interpretedAs(page.resolved_search),
    caveats: notes,
    suggestion: suggestion === null ? null : Object.fromEntries(Object.entries(suggestion).filter(([, v]) => !isEmpty(v))),
    request_id: page.meta.request_id,
  };
}

/** An entity lookup: every id answered, in the answer's order, misses included. */
export function shapeLookup(answer: EntitiesEnvelope, category: string, fields: readonly string[] | undefined, byWasSet: boolean): LookupToolResult {
  const results = answer.results.map((hit) => ({
    id: hit.id,
    found: hit.found,
    matches: capList(
      hit.matches.map((record) => compactRecord(record, category, fields)),
      SHAPING.matches_max,
    ).map((item) => (isObject(item) || typeof item === 'string' ? item : String(item))),
    ambiguous: hit.matches.length > 1,
  }));
  const notes = degradation(answer.degradation);
  const searchIds = answer.results.filter((hit) => !hit.found && SEARCH_ID.test(hit.id)).map((hit) => hit.id);
  if (ADDRESSABLE.has(category) && !byWasSet && searchIds.length > 0) notes.push(text('caveats', 'search_ids_not_found', { ids: join(searchIds) }));
  const empty = answer.results.filter((hit) => hit.found && hit.matches.length === 0).map((hit) => hit.id);
  if (empty.length > 0) notes.push(text('caveats', 'record_unavailable', { ids: join(empty) }));
  return { results, caveats: notes, request_id: answer.meta.request_id };
}

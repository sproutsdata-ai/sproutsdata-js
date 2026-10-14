/**
 * Responses → what a model reads (contract 02 §12.2).
 *
 * A raw page of ten companies is about 17,600 tokens; shaped, about 2,300.
 * The cut comes from four rules, all in `spec/tools/shaping.json` so both
 * SDKs cut identically:
 *
 * - **Rows are projected** to a default field set per category (company and
 *   person; documents have no grounded default and pass whole), or to the
 *   `fields` the model named. `id` and `category` always survive.
 * - **Absent is absent.** `null`, `""`, `[]` and `{}` are dropped: they cost
 *   tokens and read as "we checked and it is empty", which the server never
 *   said.
 * - **Long text is cut** at 300 characters, marked `…`.
 * - **Long lists are capped** at 15, marked `"… +N more"` — and values that
 *   match the request's filters go first. Without that, "companies using
 *   HubSpot" showed HubSpot in none of ten rows: it sat at positions 31 to
 *   252 of each `technology` list.
 *
 * What is never cut: the totals, `interpreted_as`, `caveats`, `suggestion`,
 * `request_id` and `environment`. Those are how a model knows what it is
 * looking at.
 */

import { lookupRef } from '../lookup';
import type { SearchHit } from '../types';
import { join, render, SHAPING, text } from './spec';
import type { InterpretedAs, LookupToolHit, LookupToolResult, SearchToolResult } from './types';
import { isObject } from './validate';

const TEXT_MAX = SHAPING.text_max_chars;
const LIST_MAX = SHAPING.list_max_entries;
const MATCHES_MAX = SHAPING.matches_max;
const SEARCH_ID = new RegExp(SHAPING.search_id_pattern);

/** Categories whose rows `lookupRef` can address, and whose misses the id mix-up explains. */
const ADDRESSABLE: readonly string[] = ['company', 'person'];

/** Field name → lower-cased values the request asked for, for list ordering. */
export type Wanted = Map<string, Set<string>>;

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return isObject(value) && Object.keys(value).length === 0;
}

/** The entry that ends a capped list. */
function moreMarker(count: number): string {
  return SHAPING.more_marker.replace('{count}', render(count));
}

/** Cut at `TEXT_MAX` code points, as Python slices. */
function truncate(value: string): string {
  const chars = Array.from(value);
  return chars.length <= TEXT_MAX ? value : chars.slice(0, TEXT_MAX).join('') + SHAPING.ellipsis;
}

function cap<T>(values: T[], limit: number): Array<T | string> {
  return values.length <= limit ? values : [...values.slice(0, limit), moreMarker(values.length - limit)];
}

function matchesWanted(item: unknown, wanted: Set<string>): boolean {
  return typeof item === 'string' && wanted.has(item.toLowerCase());
}

/** One value, trimmed. `wanted` orders a list's matching strings first. */
function compact(value: unknown, wanted?: Set<string>): unknown {
  if (typeof value === 'string') return truncate(value);
  if (Array.isArray(value)) {
    let items = value.map((item) => compact(item)).filter((item) => !isEmpty(item));
    if (wanted !== undefined && wanted.size > 0) {
      // A stable partition: the original order holds within each half.
      items = [
        ...items.filter((item) => matchesWanted(item, wanted)),
        ...items.filter((item) => !matchesWanted(item, wanted)),
      ];
    }
    return cap(items, LIST_MAX);
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, compact(item)] as const)
        .filter(([, item]) => !isEmpty(item)),
    );
  }
  return value;
}

/** A row or record, projected and trimmed. Absent fields are never invented. */
export function compactRecord(
  record: Record<string, unknown>,
  category: string,
  fields: readonly string[] | undefined,
  wanted: Wanted = new Map(),
): Record<string, unknown> {
  let keep: ReadonlySet<string> | undefined;
  if (fields !== undefined) keep = new Set([...fields, ...SHAPING.identity_fields]);
  else if (Object.hasOwn(SHAPING.default_projection, category)) {
    keep = new Set(SHAPING.default_projection[category]);
  }
  const out: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(record)) {
    if (keep !== undefined && !keep.has(key)) continue;
    const compacted = compact(value, wanted.get(key));
    if (!isEmpty(compacted)) out.push([key, compacted]);
  }
  return Object.fromEntries(out);
}

/** The literal values inside one filter, whatever its shape. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (isObject(value)) return strings(value.include);
  return [];
}

/**
 * What the request asked for, per field: its own filters plus the parser's.
 *
 * The parser's half matters most. "Companies using HubSpot" carries no
 * `technology` filter from the caller; the engine inferred one, and that is
 * the value each row's list has to show.
 */
export function wantedValues(...filterSets: Array<Record<string, unknown> | undefined>): Wanted {
  const wanted: Wanted = new Map();
  for (const filters of filterSets) {
    for (const [name, value] of Object.entries(filters ?? {})) {
      const set = wanted.get(name) ?? new Set<string>();
      for (const item of strings(value)) set.add(item.toLowerCase());
      wanted.set(name, set);
    }
  }
  return wanted;
}

// -- caveats ------------------------------------------------------------------

function degradationCaveats(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  return entries.filter(isObject).map((entry) =>
    text('caveats', 'degradation', {
      reason: entry.reason ?? null,
      detail: entry.detail ?? null,
      impact: entry.impact ?? null,
    }),
  );
}

function coverageCaveats(coverage: unknown): string[] {
  if (!isObject(coverage)) return [];
  const notes: string[] = [];
  if (coverage.truncated_by) {
    notes.push(
      text('caveats', 'coverage_truncated', {
        enumerated: coverage.enumerated ?? 0,
        universe: coverage.universe ?? 0,
        truncated_by: coverage.truncated_by,
      }),
    );
  }
  const unmet = Array.isArray(coverage.constraints_unmet) ? coverage.constraints_unmet : [];
  for (const constraint of unmet) notes.push(text('caveats', 'constraint_unmet', { constraint }));
  return notes;
}

/**
 * Whether words were sent and nothing parsed them. `parser_version: "none"`
 * with no filters is the engine saying it did not read the sentence —
 * reported exactly like "read it and found nothing", which is why `fast`
 * mode dropping a country went unnoticed.
 */
function parserSkipped(resolved: Record<string, unknown> | undefined, askedInWords: boolean): boolean {
  if (resolved === undefined || !askedInWords) return false;
  const version = resolved.parser_version ?? '';
  return (version === '' || version === 'none') && isEmpty(resolved.filters);
}

function suggestion(value: unknown): Record<string, unknown> | null {
  if (!isObject(value)) return null;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => !isEmpty(item)));
}

/** `resolved_search` as the model needs it. Present even when the server sent none. */
function interpretedAs(resolved: Record<string, unknown> | undefined): InterpretedAs {
  if (resolved === undefined) return { filters: {}, source: 'none', conflicts: [] };
  return {
    filters: (resolved.filters ?? {}) as Record<string, unknown>,
    source: (resolved.filters_source ?? 'none') as string,
    conflicts: (resolved.conflicts ?? []) as unknown[],
  };
}

function meta(body: Record<string, unknown>): Record<string, unknown> {
  return isObject(body.meta) ? body.meta : {};
}

/** The response's `resolved_search`, when it sent one. */
export function resolvedSearch(body: Record<string, unknown>): Record<string, unknown> | undefined {
  return isObject(body.resolved_search) ? body.resolved_search : undefined;
}

export interface PageShaping {
  /** The page's rows still to be shown. */
  hits: SearchHit[];
  category: string;
  fields: readonly string[] | undefined;
  wanted: Wanted;
  withLookup: boolean;
  askedInWords: boolean;
  caveats: readonly string[];
}

/** A search or look-alike page. */
export function shapePage(body: Record<string, unknown>, options: PageShaping): SearchToolResult {
  const { hits } = options;
  let unaddressed = 0;
  const rows = hits.map((hit) => {
    const declared: unknown = hit.category;
    const hitCategory = typeof declared === 'string' && declared !== '' ? declared : options.category;
    const row = compactRecord(hit, hitCategory, options.fields, options.wanted);
    if (options.withLookup && ADDRESSABLE.includes(hit.category)) {
      const ref = lookupRef(hit);
      if (ref === null) unaddressed += 1;
      else row.lookup = { by: ref.by, value: ref.value };
    }
    return row;
  });

  const resolved = resolvedSearch(body);
  const notes = [...degradationCaveats(body.degradation), ...coverageCaveats(body.coverage)];
  if (parserSkipped(resolved, options.askedInWords)) notes.push(text('caveats', 'parser_not_run'));
  notes.push(...options.caveats);
  if (unaddressed > 0) {
    notes.push(text('caveats', 'rows_without_lookup', { count: unaddressed, shown: hits.length }));
  }

  return {
    results: rows,
    total: (body.total || 0) as number,
    total_is_estimate: Boolean(body.total_is_estimate),
    has_more: Boolean(body.has_more),
    next_cursor: (body.next_cursor ?? null) as string | null,
    interpreted_as: interpretedAs(resolved),
    caveats: notes,
    suggestion: suggestion(body.suggestion),
    request_id: (meta(body).request_id || null) as string | null,
    environment: (meta(body).environment ?? null) as string | null,
  };
}

/** A domain or URL, as opposed to a record id. */
function looksRaw(identifier: string): boolean {
  return identifier.includes('.') || identifier.includes('/');
}

/** An entity lookup: every id answered, in order, misses included. */
export function shapeLookup(
  body: Record<string, unknown>,
  category: string,
  fields: readonly string[] | undefined,
  byWasSet: boolean,
): LookupToolResult {
  const hits = (Array.isArray(body.results) ? body.results : []).filter(isObject);
  const results: LookupToolHit[] = hits.map((hit) => {
    const matches = (Array.isArray(hit.matches) ? hit.matches : []).filter(isObject);
    return {
      id: hit.id as string,
      found: hit.found === true,
      matches: cap(
        matches.map((match) => compactRecord(match, category, fields)),
        MATCHES_MAX,
      ),
      ambiguous: matches.length > 1,
    };
  });

  const misses = results.filter((hit) => !hit.found).map((hit) => hit.id);
  const notes = degradationCaveats(body.degradation);
  if (ADDRESSABLE.includes(category) && !byWasSet) {
    const searchIds = misses.filter((id) => SEARCH_ID.test(id));
    const raw = misses.filter(looksRaw);
    if (searchIds.length > 0) notes.push(text('caveats', 'search_ids_not_found', { ids: join(searchIds) }));
    if (raw.length > 0) notes.push(text('caveats', 'raw_values_without_by', { ids: join(raw) }));
  }
  const empty = results.filter((hit) => hit.found && hit.matches.length === 0).map((hit) => hit.id);
  if (empty.length > 0) notes.push(text('caveats', 'record_unavailable', { ids: join(empty) }));

  return {
    results,
    caveats: notes,
    request_id: (meta(body).request_id || null) as string | null,
    environment: (meta(body).environment ?? null) as string | null,
  };
}

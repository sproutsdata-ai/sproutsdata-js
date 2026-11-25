/**
 * From a model's checked arguments to the exact client call, under the application's settings.
 *
 * Cost and scope are never model-settable. A `fixed` argument is taken out of the schema the
 * model sees; a baseline filter is merged in after validation, and when it overrides what the
 * model asked for, the result says so rather than quietly answering a different question.
 */

import type { SearchParams, SimilarParams } from '../index.js';
import { type LookupArguments, type SearchArguments, type SimilarArguments, isSearchParams, isSimilarParams } from './args.js';
import { join, LOOKUP, SEARCH, SHAPING, SIMILAR, text } from './catalog.js';
import { type ErrorResult, refused } from './errors.js';
import { isObject } from './validate.js';

/** The category a lookup takes, and the `client.entities` method that answers it. */
export type LookupCategory = LookupArguments['category'];

/** A search or look-alike call, and what shaping its page needs. */
export type PagePlan =
  | { readonly tool: typeof SEARCH; readonly params: SearchParams; readonly shaping: Shaping }
  | { readonly tool: typeof SIMILAR; readonly params: SimilarParams; readonly shaping: Shaping; readonly anchors: readonly Anchor[] };

/** A lookup call, and what shaping its answer needs. */
export interface LookupPlan {
  readonly tool: typeof LOOKUP;
  readonly category: LookupCategory;
  readonly ids: readonly string[];
  readonly by: string | undefined;
  readonly fields: readonly string[] | undefined;
  readonly byWasSet: boolean;
}

/** One prepared call: what to send, and what shaping the answer needs. */
export type Plan = PagePlan | LookupPlan;

/** What shaping a page needs from the request. */
export interface Shaping {
  readonly category: string;
  readonly fields: readonly string[] | undefined;
  readonly filters: Readonly<Record<string, unknown>> | undefined;
  readonly askedInWords: boolean;
  readonly caveats: readonly string[];
}

type Anchor = SimilarArguments['anchors'][number];

/** What the application set: the row cap and the filters every search carries. */
export interface Settings {
  readonly maxResults: number;
  readonly baseline: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

const DOCUMENTS: ReadonlySet<string> = new Set(SHAPING.document_categories);
const ID_ONLY: ReadonlySet<string> = new Set(
  Object.entries(SHAPING.lookup_by).flatMap(([category, rule]) => (rule.accepts.length === 0 ? [category] : [])),
);

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The model's filters under the application's, merged per sub-key: a baseline `industry.include`
 * must not discard the model's `industry.exclude`. Where both set a key the application wins,
 * and the model is told.
 */
export function mergeFilters(
  settings: Settings,
  requested: Readonly<Record<string, unknown>> | undefined,
): [Record<string, unknown> | undefined, string[]] {
  if (Object.keys(settings.baseline).length === 0) return [requested === undefined ? undefined : { ...requested }, []];
  const merged: Record<string, unknown> = structuredClone({ ...requested });
  const notes: string[] = [];
  for (const [name, baseline] of Object.entries(settings.baseline)) {
    const mine = merged[name];
    const combined: Record<string, unknown> = isObject(mine) ? { ...mine } : {};
    for (const [key, value] of Object.entries(baseline)) {
      if (Object.hasOwn(combined, key) && !sameJson(combined[key], value)) {
        notes.push(text('caveats', 'application_filter', { path: `${name}.${key}`, value, requested: combined[key] }));
      }
      combined[key] = structuredClone(value);
    }
    merged[name] = combined;
  }
  return [merged, notes];
}

/** `limit` lowered to the application's cap, with a caveat when the model asked for more. */
export function cap(settings: Settings, limit: number, explicit: number | undefined): [number, string[]] {
  if (limit <= settings.maxResults) return [limit, []];
  const notes = explicit === undefined ? [] : [text('caveats', 'limit_capped', { requested: explicit, limit: settings.maxResults })];
  return [settings.maxResults, notes];
}

function firstDuplicate(sort: readonly { readonly field: string }[]): string | undefined {
  const seen = new Set<string>();
  for (const clause of sort) {
    if (seen.has(clause.field)) return clause.field;
    seen.add(clause.field);
  }
  return undefined;
}

const hasDomains = (args: SearchArguments): boolean => (args.include_domains?.length ?? 0) > 0 || (args.exclude_domains?.length ?? 0) > 0;
const hasFilters = (args: SearchArguments): boolean => args.filters !== undefined && Object.keys(args.filters).length > 0;

/** The first tool rule this search breaks (`messages.json`, `rules`), or `undefined`. */
function searchRefusal(settings: Settings, args: SearchArguments): string | undefined {
  return wordsRefusal(args) ?? (args.category === 'auto' ? autoRefusal(settings, args) : categoryRefusal(args));
}

/**
 * A search that says nothing, or says it with a blank query. An empty `filters` and a blank
 * `query` say nothing, so they count as absent; a blank query beside filters is refused rather
 * than dropped, as the API refuses it.
 */
function wordsRefusal(args: SearchArguments): string | undefined {
  const blank = args.query?.trim() === '';
  if ((args.query === undefined || blank) && !hasFilters(args)) return text('rules', 'needs_query_or_filters');
  return blank ? text('rules', 'query_blank') : undefined;
}

function categoryRefusal(args: SearchArguments): string | undefined {
  const { category } = args;
  if (hasDomains(args) && !SHAPING.domain_categories.includes(category)) return text('rules', 'domains_need_entity_category', { category });
  if (hasFilters(args) && DOCUMENTS.has(category)) return text('rules', 'documents_take_no_filters', { category });
  const duplicate = firstDuplicate(args.sort ?? []);
  return duplicate === undefined ? undefined : text('rules', 'sort_duplicate_field', { field: duplicate });
}

function autoRefusal(settings: Settings, args: SearchArguments): string | undefined {
  if (args.query === undefined) return text('rules', 'auto_needs_query');
  if (args.mode !== 'auto') return text('rules', 'auto_needs_auto_mode');
  if (args.filters !== undefined || hasDomains(args) || args.sort !== undefined) return text('rules', 'auto_takes_query_only');
  if (Object.keys(settings.baseline).length > 0) return text('rules', 'auto_conflicts_with_application');
  return undefined;
}

/** A search call: the rules first, then the application's filters and row cap. */
export function planSearch(settings: Settings, args: SearchArguments, explicitLimit: number | undefined): Plan | ErrorResult {
  const refusal = searchRefusal(settings, args);
  if (refusal !== undefined) return refused(refusal);
  const [merged, notes] = args.category === 'auto' ? [undefined, []] : mergeFilters(settings, args.filters);
  const [limit, capped] = cap(settings, args.limit, explicitLimit);
  const { fields: _fields, filters: _filters, ...rest } = args;
  const params: unknown = { ...rest, limit, ...(merged !== undefined && Object.keys(merged).length > 0 ? { filters: merged } : {}) };
  if (!isSearchParams(params)) throw new Error('a checked search builds search parameters');
  const shaping = { category: args.category, fields: args.fields, filters: merged, askedInWords: args.query !== undefined, caveats: [...notes, ...capped] };
  return { tool: SEARCH, params, shaping };
}

/** A look-alike call, with what the response cannot say about its anchors. */
export function planSimilar(settings: Settings, args: SimilarArguments, explicitLimit: number | undefined): Plan | ErrorResult {
  const [merged, notes] = mergeFilters(settings, args.filters);
  const [limit, capped] = cap(settings, args.limit, explicitLimit);
  const { fields: _fields, filters: _filters, ...rest } = args;
  const params: unknown = { ...rest, limit, ...(merged !== undefined && Object.keys(merged).length > 0 ? { filters: merged } : {}) };
  if (!isSimilarParams(params)) throw new Error('a checked look-alike builds look-alike parameters');
  const { anchors } = args;
  if (anchors.length > 1) notes.push(text('caveats', 'anchors_unreported', { count: anchors.length }));
  const byName = anchors.filter((a) => a.by === 'name').map((a) => a.value);
  if (byName.length > 0) notes.push(text('caveats', 'anchors_by_name', { names: join(byName) }));
  const unweighted = anchors.filter((a) => a.weight === 0).map((a) => a.value);
  if (unweighted.length > 0) notes.push(text('caveats', 'anchors_zero_weight', { names: join(unweighted) }));
  const shaping = { category: 'company', fields: args.fields, filters: merged, askedInWords: false, caveats: [...notes, ...capped] };
  return { tool: SIMILAR, params, shaping, anchors };
}

function byRefusal(category: string, by: string): string | undefined {
  const rules = SHAPING.lookup_by[category];
  if (rules === undefined || rules.accepts.length === 0) return text('rules', 'by_not_accepted', { category });
  if (category === 'person' && by === 'domain') return text('rules', 'person_has_no_domain');
  if (!rules.accepts.includes(by)) return text('rules', 'by_not_valid', { by, category, allowed: join(rules.accepts) });
  return undefined;
}

/** A lookup call: `by` as the category takes it, `fields` for the client to apply. */
export function planLookup(args: LookupArguments): Plan | ErrorResult {
  const { category, by } = args;
  if (by !== undefined) {
    const refusal = byRefusal(category, by);
    if (refusal !== undefined) return refused(refusal);
  }
  const resolved = ID_ONLY.has(category) ? undefined : (by ?? SHAPING.lookup_by[category]?.default ?? undefined);
  return { tool: LOOKUP, category, ids: args.ids, by: resolved, fields: args.fields, byWasSet: by !== undefined };
}

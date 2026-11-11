/**
 * What a caller does with an answer that the schema cannot say: how to look a search row up
 * again, a category's total without double counting, and a lookup's rows by value. Pure
 * functions over the answers; each mirrors a method on sproutsdata-py's models.
 */

import { asRecords, type AnyRecord, type RecordTypes } from '../core/records.js';
import type * as W from '../generated/wire.js';
import type { LookupRef } from '../types/index.js';

const DOCUMENT_ID_PREFIX = 'd1_';
/** The `by` each document category's lookup takes a search row's `d1_...` id with. */
const DOCUMENT_BY: Readonly<Record<string, LookupRef['by']>> = {
  // Patents, trends and academic reports are looked up by id alone: they take no `by`.
  patent: undefined,
  trend: undefined,
  academic_report: undefined,
  news_article: 'id',
  market_report: 'id',
  funding_round: 'id',
  job_opening: 'id',
};

/**
 * How to look a search row up in `client.entities`, or `undefined` when it cannot be. A
 * company by its domain (its `id`), a person by their LinkedIn URL, and a document by its
 * `d1_...` id. A person without a LinkedIn URL has nothing the lookup takes: their `id` is a
 * hash of the record, which no route resolves.
 */
export function lookupRef(hit: W.SearchHit): LookupRef | undefined {
  if (hit.category === 'company') return { category: hit.category, by: 'domain', value: hit.id };
  if (hit.category === 'person') {
    const url = hit['linkedin_url'];
    return typeof url === 'string' && url !== '' ? { category: hit.category, by: 'li_url', value: url } : undefined;
  }
  if (!(hit.category in DOCUMENT_BY) || !hit.id.startsWith(DOCUMENT_ID_PREFIX)) return undefined;
  return { category: hit.category, by: DOCUMENT_BY[hit.category], value: hit.id };
}

/**
 * How many records of `category` the index holds, summed over its segments. People's ties to
 * institutions (`affiliations`) are left out: they are rows about people, not people.
 */
export function totalFor(coverage: W.CoverageResponse, category: string): number {
  return coverage.segments.filter((s) => s.category === category && s.name !== 'affiliations').reduce((sum, s) => sum + s.total, 0);
}

/** A lookup's row for `value` as it was sent, or `undefined` if it was not sent. */
export function entityHit(answer: W.EntitiesEnvelope, value: string): W.EntityHit | undefined {
  return answer.results.find((hit) => hit.id === value);
}

/** The values a lookup sent that matched no record, in the order the answer lists them. */
export function missingValues(answer: W.EntitiesEnvelope): string[] {
  return answer.results.filter((hit) => !hit.found).map((hit) => hit.id);
}

/**
 * A lookup row's matches as its category's record type, each flexible list made a list. A row
 * whose category is known to the compiler gets that record type; any other, the union.
 */
export function recordsOf<C extends keyof RecordTypes>(hit: W.EntityHit & { readonly category: C }): RecordTypes[C][];
export function recordsOf(hit: W.EntityHit): AnyRecord[];
export function recordsOf(hit: W.EntityHit): AnyRecord[] {
  return asRecords(hit.category, hit.matches);
}

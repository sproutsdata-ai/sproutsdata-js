/**
 * The bodies of `POST /v1/enrichment/jobs` and `/lookups`, checked as the server checks them,
 * and the queries of their pages. A request enriches `contacts` (people: `EMAIL`, `PHONE`) or
 * `accounts` (companies: `DOMAIN`, `PHONE`, `LINKEDIN_URL`).
 *
 * Each rule is the API's own for `JobRequest` and `LookupRequest` (as in `spec/openapi.json`).
 */

import type * as W from '../generated/wire.js';
import type { PageParams } from '../types/index.js';
import { checkLimit, present, refuse } from './build.js';
import { checkShape } from './shape.js';

type Entity = NonNullable<W.EnrichmentJobRequest['entity']>;

/** The fields each entity is enriched for, as the API lists them. */
export const FIELDS: Readonly<Record<Entity, ReadonlySet<string>>> = {
  contacts: new Set(['EMAIL', 'PHONE']),
  accounts: new Set(['DOMAIN', 'PHONE', 'LINKEDIN_URL']),
};
const CONTACT_ONLY: readonly (keyof W.EnrichmentItem)[] = ['first_name', 'last_name', 'full_name', 'email_hint', 'person_id', 'es_id'];
const ACCOUNT_ONLY: readonly (keyof W.EnrichmentItem)[] = ['company_id'];
/** `limit` on the job list. */
export const MAX_JOBS_PAGE = 100;
/** `limit` on a job's rows. */
export const MAX_RESULTS_PAGE = 500;
/** The enrichment service answers a lookup within no less than 100 ms (its shortest deadline). */
const MIN_WAIT_SECONDS = 0.1;

/** The states a job does not leave (`cancelling` is on its way to `cancelled`). */
export const SETTLED: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

/** A job's body, checked locally. */
export function jobBody(params: W.EnrichmentJobRequest): W.EnrichmentJobRequest {
  checkShape('enrichment.create', params, 'EnrichmentJobRequest');
  return checkAsk('enrichment.create', params);
}

/** A lookup's body (at most 20 items), checked locally, with a wait the enrichment service can keep. */
export function lookupBody(params: W.EnrichmentLookupRequest): W.EnrichmentLookupRequest {
  const what = 'enrichment.lookup';
  checkShape(what, params, 'EnrichmentLookupRequest');
  const body = checkAsk(what, params);
  const wait = body.wait_seconds;
  if (typeof wait === 'number' && wait < MIN_WAIT_SECONDS) refuse(what, `wait_seconds: at least ${String(MIN_WAIT_SECONDS)} (got ${String(wait)})`);
  return body;
}

/** The query of a page of jobs or of a job's rows. */
export function pageQuery<T extends PageParams>(what: string, params: T, maximum: number): T {
  checkLimit(what, 'limit', params.limit, maximum);
  return params;
}

/** The rules every request shares, in the server's order and words. */
function checkAsk<T extends W.EnrichmentJobRequest | W.EnrichmentLookupRequest>(what: string, body: T): T {
  if (new Set(body.fields).size !== body.fields.length) refuse(what, 'fields: fields must not repeat');
  const entity = body.entity ?? 'contacts';
  const asked = new Set<string>(body.fields);
  const foreignKeys = entity === 'contacts' ? ACCOUNT_ONLY : CONTACT_ONLY;
  body.items.forEach((item, index) => {
   
    const own = item.fields ?? [];
    for (const field of own) asked.add(field);
    const foreign = foreignKeys.filter((name) => Boolean(item[name])).sort();
    if (foreign.length > 0) refuse(what, `items.${String(index)}: [${foreign.map((name) => `'${name}'`).join(', ')}] do not apply to ${entity}`);
    if (own.length > 0 && !own.every((field) => body.fields.includes(field))) refuse(what, `items.${String(index)}.fields must be a subset of fields`);
  });
  const allowed = FIELDS[entity];
  if (![...asked].every((field) => allowed.has(field))) refuse(what, `${entity} are enriched for ${[...allowed].sort().join(', ')}`);
  if (present(body.verify_mode) && entity !== 'contacts') refuse(what, 'verify_mode applies to contacts only');
  return body;
}

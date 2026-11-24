/**
 * The body of `POST /v1/credits/quote`, checked as the server checks it (be
 * `src/dsp/features/billing/quote.py`).
 */

import type * as W from '../generated/wire.js';
import { refuse } from './build.js';
import { currentEffort } from './effort.js';
import { FIELDS } from './enrichment.js';
import { checkShape } from './shape.js';

/** The most rows a page holds (be billing/actions.py `MAX_PAGE`). */
export const MAX_PAGE = 100;
/** The most records a lookup takes (be billing/actions.py `MAX_LOOKUP`). */
export const MAX_LOOKUP = 1000;
/** The most rows one enrichment job takes (be billing/actions.py `MAX_ENRICHMENT_ROWS`). */
export const MAX_ENRICHMENT_ROWS = 10_000;
/** The rows a quote prices when it names none (be quote.py `QuoteIn.rows`). */
const DEFAULT_ROWS = 10;
/** The operations charged by the page (be quote.py `_PAGED`). */
const PAGED: ReadonlySet<string> = new Set(['search', 'search_auto', 'similar', 'relationships']);
/** The fields enrichment finds, for a quote's `fields` (the shape table does not list them). */
const ENRICHMENT_FIELDS: readonly string[] = [...new Set([...FIELDS.contacts, ...FIELDS.accounts])].sort();

/**
 * A quote body: `effort` with an agent run and only with one (an earlier tier name sent as its
 * new one), `fields` with enrichment and only with it, and a page's rows, a lookup's records and
 * a job's rows capped as the server caps them. Whether an enrichment quote is over the 30,000
 * credits a job may hold depends on the price list, so the server alone says so.
 */
export function quoteBody(what: string, params: W.QuoteIn): W.QuoteIn {
  const named = params.effort === undefined || params.effort === null ? params : { ...params, effort: currentEffort(params.effort) };
  checkShape(what, named, 'QuoteIn');
  const broken = quoteRules(named).find(([breaks]) => breaks);
  if (broken !== undefined) refuse(what, broken[1]);
  return named;
}

/** Each rule the server checks, in its order (be quote.py `QuoteIn._fits`): broken, and its words. */
function quoteRules(params: W.QuoteIn): readonly (readonly [boolean, string])[] {
  const rows = params.rows ?? DEFAULT_ROWS;
  const fields = params.fields ?? undefined;
  const named = fields !== undefined;
  return [
    [!(fields ?? []).every((field) => ENRICHMENT_FIELDS.includes(field)), `fields: each is one of ${ENRICHMENT_FIELDS.join(', ')}`],
    [(params.operation === 'agent_run') !== (params.effort !== undefined && params.effort !== null), '`effort` is required for agent_run, and only for it'],
    [PAGED.has(params.operation) && rows > MAX_PAGE, `rows: a page holds at most ${String(MAX_PAGE)} rows (got ${String(rows)})`],
    [named && params.operation !== 'enrichment', '`fields` applies to enrichment only'],
    [named && new Set(fields).size !== fields.length, '`fields` must not repeat'],
    [params.operation === 'lookup' && rows > MAX_LOOKUP, `rows: a lookup takes at most 1,000 records (got ${String(rows)})`],
    [named && rows > MAX_ENRICHMENT_ROWS, `rows: a job takes at most 10,000 rows; split it (got ${String(rows)})`],
  ];
}

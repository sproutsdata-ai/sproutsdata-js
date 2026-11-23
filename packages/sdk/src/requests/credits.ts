/**
 * The body of `POST /v1/credits/quote`, checked as the server checks it (be
 * `src/dsp/features/billing/quote.py`).
 */

import type * as W from '../generated/wire.js';
import { refuse } from './build.js';
import { currentEffort } from './effort.js';
import { checkShape } from './shape.js';

/** The most rows a page holds (be billing/actions.py `MAX_PAGE`). */
export const MAX_PAGE = 100;
/** The most records a lookup takes (be billing/actions.py `MAX_LOOKUP`). */
export const MAX_LOOKUP = 1000;
/** The rows a quote prices when it names none (be quote.py `QuoteIn.rows`). */
const DEFAULT_ROWS = 10;
/** The operations charged by the page (be quote.py `_PAGED`). */
const PAGED: ReadonlySet<string> = new Set(['search', 'search_auto', 'similar', 'relationships']);

/**
 * A quote body: `effort` with an agent run and only with one (an earlier tier name sent as its
 * new one), and a page's rows and a lookup's records capped as the server caps them.
 */
export function quoteBody(what: string, params: W.QuoteIn): W.QuoteIn {
  const named = params.effort === undefined || params.effort === null ? params : { ...params, effort: currentEffort(params.effort) };
  checkShape(what, named, 'QuoteIn');
  const effort = named.effort ?? undefined;
  if ((params.operation === 'agent_run') !== (effort !== undefined)) refuse(what, '`effort` is required for agent_run, and only for it'); // be quote.py QuoteIn._fits
  const rows = params.rows ?? DEFAULT_ROWS;
  if (PAGED.has(params.operation) && rows > MAX_PAGE) refuse(what, `rows: a page holds at most ${String(MAX_PAGE)} rows (got ${String(rows)})`);
  if (params.operation === 'lookup' && rows > MAX_LOOKUP) refuse(what, `rows: a lookup takes at most 1,000 records (got ${String(rows)})`);
  return named;
}

/**
 * The body of `POST /v1/credits/quote`, checked as the server checks it (be
 * `src/dsp/features/billing/quote.py`).
 */

import type * as W from '../generated/wire.js';
import { refuse } from './build.js';
import { checkShape } from './shape.js';

/** The most rows a page holds (be billing/actions.py `MAX_PAGE`); `lookup` takes up to 1,000. */
export const MAX_PAGE = 100;
/** The rows a quote prices when it names none (be quote.py `QuoteIn.rows`). */
const DEFAULT_ROWS = 10;
/** The operations charged by the page (be quote.py `_PAGED`). */
const PAGED: ReadonlySet<string> = new Set(['search', 'search_auto', 'similar', 'relationships']);

/** A quote body: `effort` with an agent run and only with one, and a page's rows capped. */
export function quoteBody(what: string, params: W.QuoteIn): W.QuoteIn {
  checkShape(what, params, 'QuoteIn');
  const effort = params.effort ?? undefined;
  if ((params.operation === 'agent_run') !== (effort !== undefined)) refuse(what, '`effort` is required for agent_run, and only for it'); // be quote.py QuoteIn._fits
  const rows = params.rows ?? DEFAULT_ROWS;
  if (PAGED.has(params.operation) && rows > MAX_PAGE) refuse(what, `rows: a page holds at most ${String(MAX_PAGE)} rows (got ${String(rows)})`);
  return params;
}

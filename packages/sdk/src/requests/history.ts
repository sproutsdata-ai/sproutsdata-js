/** The queries of the usage history, metrics and the credit ledger. */

import type { HistoryParams, PageParams, TimeWindow } from '../types/index.js';
import { checkLimit, checkText, refuse } from './build.js';

const MAX_PAGE_SIZE = 100;
const MAX_ACTION_TYPE = 32;

/** The `from` and `to` of a time window, as the server reads them. */
export interface WindowQuery {
  readonly from?: string;
  readonly to?: string;
}

/** The query of a page of history: one `action_type` (the server keeps the last of several). */
export function historyQuery(params: HistoryParams): PageParams & WindowQuery & { readonly action_type?: string } {
  const actionType: unknown = params.action_type;
  if (actionType !== undefined && typeof actionType !== 'string') refuse('history.list', 'action_type takes one action; list the history once per action');
  checkText('history.list', 'action_type', params.action_type, MAX_ACTION_TYPE);
  checkLimit('history.list', 'limit', params.limit, MAX_PAGE_SIZE);
  const { from: _from, to: _to, ...rest } = params;
  return { ...rest, ...windowQuery(params) };
}

/** A time window's query: a `Date` as its ISO 8601 instant, a string as given. */
export function windowQuery(window: TimeWindow): WindowQuery {
  const iso = (value: Date | string | undefined): string | undefined => (value instanceof Date ? value.toISOString() : value);
  const from = iso(window.from);
  const to = iso(window.to);
  return { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) };
}

/** The query of a page of the credit ledger. */
export function ledgerQuery<T extends { readonly limit?: number }>(params: T): T {
  checkLimit('credits.transactions', 'limit', params.limit, MAX_PAGE_SIZE);
  return params;
}

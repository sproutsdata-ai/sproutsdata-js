/** The bodies of the saved-list and export routes, checked as the server checks them (`spec/openapi.json`). */

import type * as W from '../generated/wire.js';
import type { PageParams } from '../types/index.js';
import { checkLimit, refuse } from './build.js';
import { checkShape } from './shape.js';

const MAX_PAGE_SIZE = 100;

/** A list's name and kind (the server trims the name, so a blank one is refused). */
export function listBody<T extends W.ListName>(what: string, type: string, params: T): T {
  if (typeof params.name === 'string' && params.name.trim() === '') refuse(what, 'name: a list needs a name');
  checkShape(what, params, type);
  return params;
}

/** Up to 1,000 items to add or remove, each `{ entity_category, entity_id }`. */
export function itemsBody(what: string, items: readonly W.ItemRef[]): W.ItemsRequest {
  if (!Array.isArray(items)) refuse(what, 'items must be a list of `{ entity_category, entity_id }`');
  const body: W.ItemsRequest = { items };
  checkShape(what, body, 'ItemsRequest');
  return body;
}

/** Which rows of a list to export, newest first (omitted: the whole list). */
export function listExportBody(params: W.ListExportRequest): W.ListExportRequest {
  checkShape('lists.export', params, 'ListExportRequest');
  return params;
}

/** Search rows to export (up to 50,000), and the search they came from. */
export function searchExportBody(params: W.SearchExportRequest): W.SearchExportRequest {
  if (!Array.isArray(params.items)) refuse('searchExport', 'items must be a list of `{ entity_category, entity_id }`');
  checkShape('searchExport', params, 'SearchExportRequest');
  return params;
}

/** The query of a page of a list's items. */
export function itemsQuery(params: PageParams): PageParams {
  checkLimit('lists.items', 'limit', params.limit, MAX_PAGE_SIZE);
  return params;
}

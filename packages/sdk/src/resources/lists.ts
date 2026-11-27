/**
 * Saved lists: make one, fill it, read it, export it. Making, renaming and deleting a list,
 * and removing items, are free. Adding items, reading them and exporting them charge, once per
 * record: a paid workspace pays the lookup price for each record it is shown whole and has not
 * unlocked in the last 90 days, all or nothing (`InsufficientCreditsError` when the balance is
 * short, with nothing added, shown or exported); a free workspace sees the card fields, free.
 * These calls read no `Idempotency-Key` and charge before they unlock the records, so one whose
 * work may have run (a gateway's 502 or 504, a 500, the API's own timeout) is thrown, not
 * repeated: its message says it may have been charged.
 */

import type { RequestOptions } from '../core/transport.js';
import type * as W from '../generated/wire.js';
import { itemsBody, itemsQuery, listBody, listExportBody } from '../requests/lists.js';
import type { ExportResult, PageOptions, PageParams } from '../types/index.js';
import { Resource } from './resource.js';

/** The workspace's saved lists. */
export class Lists extends Resource {
  /** Every saved list, with the workspace's saved-items count and cap. */
  async list(options?: RequestOptions): Promise<W.ListsResponse> {
    return this.json('listsList', {}, options);
  }

  /**
   * Make a list. Its name is unique in the workspace (1 to 120 characters); `entity_category`
   * fixes the one kind of record it holds. Never retried: a create that timed out may have made
   * the list, so check `list()` first.
   *
   * @throws {ListNameTakenError} The workspace already has a list with this name (409).
   */
  async create(params: W.ListCreate, options?: RequestOptions): Promise<W.SavedListView> {
    return this.json('listsCreate', { body: listBody('lists.create', 'ListCreate', params) }, options);
  }

  /** Give a list a new name, unique in the workspace. */
  async rename(listId: string, params: W.ListName, options?: RequestOptions): Promise<W.SavedListView> {
    return this.json('listsRename', { path: { list_id: listId }, body: listBody('lists.rename', 'ListName', params) }, options);
  }

  /** Delete a list and its items. Never retried. */
  async delete(listId: string, options?: RequestOptions): Promise<void> {
    await this.empty('listsDelete', { path: { list_id: listId } }, options);
  }

  /**
   * One page of a list's items, newest first; `added_by` is who added each (`"user:1"`).
   * `credits_charged` is what it cost: records whose 90-day unlock has lapsed are charged again.
   *
   * @throws {InsufficientCreditsError} Too few credits for the records it would show whole.
   */
  async items(listId: string, params: PageParams = {}, options?: RequestOptions): Promise<W.ListItemsResponse> {
    return this.json('listsItems', { path: { list_id: listId }, query: itemsQuery(params) }, options);
  }

  /** Every item of a list, page after page. */
  iterItems(listId: string, params: Omit<PageParams, 'cursor'> & PageOptions = {}, options?: RequestOptions): AsyncGenerator<W.SavedItemView, void, undefined> {
    const { maxResults, ...query } = params;
    return this.rows('listsItems', { path: { list_id: listId }, query: itemsQuery(query) }, (page) => page.items, options, maxResults);
  }

  /**
   * Add up to 1,000 records, each `{ entity_category, entity_id }`. The answer counts what was
   * `added`, `already_present`, `suppressed` (Do-Not-Contact) and `not_found`, and says what it
   * cost (`credits_charged`): the lookup price for each record shown whole that the workspace
   * had not unlocked, all or nothing.
   *
   * @throws {InsufficientCreditsError} Too few credits: nothing was added.
   * @throws {InvalidRequestError} A record of another kind than the list holds (`lists.category_mismatch`).
   * @throws {ConflictError} The saved-items cap is reached (`lists.item_cap_reached`).
   */
  async addItems(listId: string, params: W.ItemsRequest, options?: RequestOptions): Promise<W.AddItemsResponse> {
    return this.json('listsAddItems', { path: { list_id: listId }, body: itemsBody('lists.addItems', params.items) }, options);
  }

  /** Remove up to 1,000 records, each `{ entity_category, entity_id }`. */
  async removeItems(listId: string, params: W.ItemsRequest, options?: RequestOptions): Promise<W.RemoveItemsResponse> {
    return this.json('listsRemoveItems', { path: { list_id: listId }, body: itemsBody('lists.removeItems', params.items) }, options);
  }

  /**
   * Export a list's rows (newest first) as CSV: `{ kind: 'file', csv }` at once, or
   * `{ kind: 'job', job }` for a larger list (`client.exports.wait` then `download`). Charged
   * like `items`: a file says what it cost (`creditsCharged`), a job is charged when its file is
   * ready.
   *
   * @throws {InsufficientCreditsError} Too few credits for the records it would show whole.
   */
  async export(listId: string, params: W.ListExportRequest = {}, options?: RequestOptions): Promise<ExportResult> {
    return this.fileOrJob('listsExport', { path: { list_id: listId }, body: listExportBody(params) }, options);
  }
}

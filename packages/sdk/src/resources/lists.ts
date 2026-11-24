/** Saved lists: make one, fill it, read it, export it. Free; exports are free too. */

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

  /** One page of a list's items, newest first; `added_by` is who added each (`"user:1"`). */
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
   * `added`, `already_present`, `suppressed` (Do-Not-Contact) and `not_found`.
   *
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
   * `{ kind: 'job', job }` for a larger list (`client.exports.wait` then `download`). Free.
   */
  async export(listId: string, params: W.ListExportRequest = {}, options?: RequestOptions): Promise<ExportResult> {
    return this.fileOrJob('listsExport', { path: { list_id: listId }, body: listExportBody(params) }, options);
  }
}

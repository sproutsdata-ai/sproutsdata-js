/** `search` and `similar`, and the walks over their pages (`iterSearch`, `iterSimilar`). */

import type { RequestOptions } from '../core/transport.js';
import type * as W from '../generated/wire.js';
import { searchBody, similarBody } from '../requests/search.js';
import type { IterSearchParams, IterSimilarParams, SearchParams, SimilarParams } from '../types/index.js';
import { Resource } from './resource.js';

/** The index, searched by description (`search`) or by example (`similar`). */
export class Search extends Resource {
  /**
   * Search the index: one page of results. Billed by the rows a search delivers: page 1 opens a
   * search session and costs the price list's base, which covers its first rows; a later page
   * costs only the rows it adds beyond those (often nothing). A repeat of page 1 opens a new
   * session and is charged again; `meta.credits_charged` is what the page cost. A search that
   * may have reached the server without an answer is thrown, never repeated (`reachedServer`).
   *
   * `category` defaults to `company`; `auto` lets the question pick it (and takes only `query`,
   * `mode`, `limit` and `cursor`). Document categories take their own `filters` and `sort`.
   *
   * @throws {ClientValidationError} The server would refuse these parameters (nothing is sent).
   * @throws {InsufficientCreditsError} Not enough credits for the call.
   * @throws {CursorExpiredError} The cursor is older than 24 hours.
   */
  async search(params: SearchParams, options?: RequestOptions): Promise<W.SearchEnvelope> {
    return this.json('search', { body: searchBody(params) }, options);
  }

  /**
   * Every result of a search, page after page, as they are read. Pages follow `next_cursor`
   * until it is `null`, so a short page is never mistaken for the last. The walk is one search
   * session, billed as `search` says; with `maxResults`, the last page asks only for the rows
   * still wanted.
   *
   * @throws {PaginationDepthExceededError} The walk would go past 10,000 results.
   */
  iterSearch(params: IterSearchParams, options?: RequestOptions): AsyncGenerator<W.SearchHit, void, undefined> {
    const { maxResults, ...search } = params;
    return this.rows('search', { body: searchBody(search) }, (page) => page.results, options, maxResults);
  }

  /**
   * Companies like the ones named: one page. Billed by session, as `search` is. An anchor is a
   * domain as a bare string, or `{ value, by, weight }`; `combine: 'or'` finds companies like
   * any one anchor rather than all of them. `resolved_search.filters` reports the anchors.
   *
   * @throws {ClientValidationError} The server would refuse these parameters.
   */
  async similar(params: SimilarParams, options?: RequestOptions): Promise<W.SearchEnvelope> {
    return this.json('similar', { body: similarBody(params) }, options);
  }

  /** Every look-alike, page after page: one session, billed as `search` says. */
  iterSimilar(params: IterSimilarParams, options?: RequestOptions): AsyncGenerator<W.SearchHit, void, undefined> {
    const { maxResults, ...similar } = params;
    return this.rows('similar', { body: similarBody(similar) }, (page) => page.results, options, maxResults);
  }
}

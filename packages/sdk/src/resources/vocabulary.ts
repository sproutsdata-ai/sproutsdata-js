/** Filter values and sort fields: the free catalogues a search is built from. */

import type { RequestOptions } from '../core/transport.js';
import type * as W from '../generated/wire.js';
import { valuesQuery } from '../requests/vocabulary.js';
import type { DocumentFilterValuesParams, FilterValuesParams, PageOptions } from '../types/index.js';
import { Resource } from './resource.js';

/** The values each filter takes and the fields each category sorts on. Free. */
export class Vocabulary extends Resource {
  /**
   * One page (20 values) of what a company or person filter accepts. Free. `values` holds the
   * page; `items` is set for the `company` filter only (each company's name and domain) and is
   * `null` for every other filter.
   */
  async filterValues(name: W.FilterName, params: FilterValuesParams = {}, options?: RequestOptions): Promise<W.FilterValues> {
    return this.json('filterValues', { path: { name }, query: valuesQuery('filterValues', params) }, options);
  }

  /** Every value a filter accepts, page after page, until the last page. Free. */
  iterFilterValues(name: W.FilterName, params: Omit<FilterValuesParams, 'page'> & PageOptions = {}, options?: RequestOptions): AsyncGenerator<string, void, undefined> {
    const { maxResults, ...query } = params;
    return this.rows('filterValues', { path: { name }, query: valuesQuery('filterValues', query) }, (page) => page.values, options, maxResults);
  }

  /** One page (20 values) of what a document category's filter accepts (`patent`, `offices`). Free. */
  async documentFilterValues(category: W.SearchCategory, name: string, params: DocumentFilterValuesParams = {}, options?: RequestOptions): Promise<W.DocumentFilterValues> {
    return this.json('documentFilterValues', { path: { category, name }, query: valuesQuery('documentFilterValues', params) }, options);
  }

  /** Every value a document filter accepts, page after page. Free. */
  iterDocumentFilterValues(
    category: W.SearchCategory,
    name: string,
    params: Omit<DocumentFilterValuesParams, 'page'> & PageOptions = {},
    options?: RequestOptions,
  ): AsyncGenerator<string, void, undefined> {
    const { maxResults, ...query } = params;
    const first = { path: { category, name }, query: valuesQuery('documentFilterValues', query) };
    return this.rows('documentFilterValues', first, (page) => page.values, options, maxResults);
  }

  /**
   * The fields a category's search can be ordered by, with labels and directions. Free. Each
   * option names its `field`, its `directions` and its `default_direction` (`asc` or `desc`).
   */
  async sorts(category: W.SearchCategory, options?: RequestOptions): Promise<W.SortOptions> {
    return this.json('sorts', { path: { category } }, options);
  }
}

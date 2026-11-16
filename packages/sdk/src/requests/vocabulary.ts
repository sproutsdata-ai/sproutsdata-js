/** The query of each vocabulary call, checked as the server checks it (be search/schemas/vocabulary.py). */

import type { FilterValuesParams } from '../types/index.js';
import { checkLimit, checkText } from './build.js';

const MAX_PAGE = 10_000;
const MAX_TEXT = 200;

/** The query of a page of filter values. */
export function valuesQuery(what: string, params: FilterValuesParams): FilterValuesParams {
  checkText(what, 'search', params.search, MAX_TEXT);
  checkText(what, 'parent', params.parent, MAX_TEXT);
  checkLimit(what, 'page', params.page, MAX_PAGE);
  return params;
}

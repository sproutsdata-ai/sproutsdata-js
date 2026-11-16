/** What the index holds, by corpus. */

import type { RequestOptions } from '../core/transport.js';
import type * as W from '../generated/wire.js';
import type { CoverageParams } from '../types/index.js';
import { Resource } from './resource.js';

/** The index's size, by corpus. Free. */
export class Coverage extends Resource {
  /**
   * How many records the index holds, by segment (corpus), counted when `as_of` says. Free.
   * `totalFor(coverage, category)` sums a category without counting people twice.
   */
  async coverage(params: CoverageParams = {}, options?: RequestOptions): Promise<W.CoverageResponse> {
    return this.json('coverage', { query: params }, options);
  }
}

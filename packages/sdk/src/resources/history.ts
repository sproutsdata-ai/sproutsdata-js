/** The usage history: every call, what it cost, and the daily totals. Free. */

import type { RequestOptions } from '../core/transport.js';
import type * as W from '../generated/wire.js';
import { historyQuery, windowQuery } from '../requests/history.js';
import type { HistoryParams, PageOptions, TimeWindow } from '../types/index.js';
import { Resource } from './resource.js';

/** What the workspace asked, and what it cost. */
export class History extends Resource {
  /**
   * One page of calls, newest first. Each row's `credits_charged` is a decimal string
   * (`"0.500"`) or `null` when the call was not metered; `latency_ms` and `request` may be
   * `null`. A row's `id` is a digit string, which `retrieve` takes as is.
   */
  async list(params: HistoryParams = {}, options?: RequestOptions): Promise<W.HistoryPage> {
    return this.json('historyList', { query: historyQuery(params) }, options);
  }

  /** Every call, page after page, following `next_cursor` until it is `null`. */
  iterList(params: Omit<HistoryParams, 'cursor'> & PageOptions = {}, options?: RequestOptions): AsyncGenerator<W.RunSummary, void, undefined> {
    const { maxResults, ...query } = params;
    return this.rows('historyList', { query: historyQuery(query) }, (page) => page.results, options, maxResults);
  }

  /**
   * One call in full: its `request`, and its `snapshot` when one was kept. `snapshot_state` is
   * `present`, `absent` or `continuation` (a later page, whose snapshot is its session's first).
   */
  async retrieve(runId: string, options?: RequestOptions): Promise<W.RunDetail> {
    return this.json('historyRetrieve', { path: { run_id: runId } }, options);
  }

  /** Daily totals by action: requests, outcomes and credits (decimal strings). */
  async metrics(window: TimeWindow = {}, options?: RequestOptions): Promise<W.MetricsResponse> {
    return this.json('historyMetrics', { query: windowQuery(window) }, options);
  }
}

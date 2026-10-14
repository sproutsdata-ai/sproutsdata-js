/**
 * The `/v1/usage/history` surface (`client.history`): this credential's own
 * billable runs, read back — list, one-run detail with a replayable snapshot,
 * and daily metrics.
 *
 * Separate from `client.credits.usage()` (per-key spend from the billing
 * ledger) on purpose, mirroring the backend's own split: key usage is the
 * ledger's numbers, history is the edge's record of runs. All three routes
 * are free and require `dsp.usage.read`.
 */

import type { RequestOptions } from './http';
import { envelopeShape, paginate, type PageOptions } from './paginate';
import { APIResource } from './resource';
import type { Envelope, ResponseMeta } from './types';
import { ensure, toIso } from './validate';

/**
 * The thirteen billable actions history can filter on today. The server
 * owns the list, so a value outside it is sent as-is and refused there with
 * the accepted set named.
 */
export type HistoryActionType =
  | 'dsp.search.fast'
  | 'dsp.search.auto'
  | 'dsp.search.deep'
  | 'dsp.similar'
  | 'dsp.entities'
  | 'dsp.relationships'
  | 'dsp.relationships.ask'
  | 'dsp.org_chart'
  | 'dsp.agent.run.minimal'
  | 'dsp.agent.run.low'
  | 'dsp.agent.run.medium'
  | 'dsp.agent.run.high'
  | 'dsp.agent.run.xhigh';

/** A history row's outcome. */
export type HistoryRunStatus = 'pending' | 'ok' | 'failed' | (string & {});

/**
 * Why `snapshot` is null when it is null, so you never have to guess.
 * `continuation` is a later page of a paginated search: charged and listed
 * like any run, but only a search's first page stores a replayable snapshot.
 */
export type SnapshotState = 'present' | 'expired' | 'omitted_too_large' | 'absent' | 'continuation';

/** Query for `GET /v1/usage/history`. */
export interface HistoryListParams {
  /** Opaque cursor from a previous page. */
  cursor?: string;
  /** Page size. Defaults to 25 on the server. */
  limit?: number;
  /**
   * Only runs of these billable actions. One value or several (OR); the
   * server de-duplicates and sorts the set, so argument order does not
   * change the cursor.
   */
  action_type?: HistoryActionType | (string & {}) | Array<HistoryActionType | (string & {})>;
  /** Window start (inclusive). A `Date` is serialized to ISO 8601. */
  from?: Date | string;
  /** Window end. */
  to?: Date | string;
}

/**
 * One row of the history list. Light on purpose — no request, no resolved
 * plan, no snapshot: the list is for recognising a run, `retrieve` is for
 * replaying it.
 */
export interface HistoryRunSummary {
  /** Numeric — unlike agent run ids, which are strings. */
  id: number;
  occurred_at: string;
  /**
   * The billable action. Open on the response side: an action added
   * server-side lists here before it becomes filterable.
   */
  action_type: string;
  /** `user` (a session) or `api_key`. */
  actor_type: string;
  environment: string;
  /**
   * `pending` while the call is still running (an agent run not yet
   * settled), then `ok` or `failed`. Open so a status added server-side
   * never breaks a switch.
   */
  status: HistoryRunStatus;
  error_code: string | null;
  /**
   * What makes the run recognisable: the search text, joined anchor values
   * for similar, joined ids for entities.
   */
  query: string | null;
  result_count: number | null;
  /** What the ledger charged, in credits; a run that failed before its charge reads zero. */
  credits_charged: number;
  latency_ms: number;
}

/**
 * Everything the list omits — enough to replay the run for free.
 */
export interface HistoryRunDetail extends HistoryRunSummary {
  /** The original request body, minus the cursor — what a re-run posts. */
  request: Record<string, unknown>;
  resolved_search: Record<string, unknown> | null;
  /**
   * The page-1 response envelope exactly as it was served. Typed loose on
   * purpose: it is stored "as served" from any action type and may predate
   * current envelope fields. Null when `snapshot_state` says so.
   */
  snapshot: Record<string, unknown> | null;
  snapshot_state: SnapshotState;
  snapshot_expires_at: string | null;
  meta: ResponseMeta;
}

/** Query for `GET /v1/usage/metrics`. */
export interface HistoryMetricsParams {
  /** Window start (inclusive). A `Date` is serialized to ISO 8601. */
  from?: Date | string;
  /** Window end. */
  to?: Date | string;
}

/**
 * One day of one action. `requests` counts every run, so it is
 * `ok + failed + pending`; still-running runs are `pending`, not failures.
 */
export interface HistoryMetricsBucket {
  day: string;
  action_type: string;
  requests: number;
  ok: number;
  failed: number;
  pending: number;
  credits: number;
}

/**
 * Requests, outcomes and credits per day, over the caller's own runs.
 * Credits are what the ledger charged, so they agree with it by construction.
 */
export interface HistoryMetricsResponse {
  period_from: string;
  period_to: string;
  total_requests: number;
  total_ok: number;
  total_failed: number;
  /** Runs still in flight — neither a success nor a failure yet. */
  total_pending: number;
  total_credits: number;
  buckets: HistoryMetricsBucket[];
  meta: ResponseMeta;
}

/**
 * The share of finished runs that failed: `failed / (ok + failed)`, from a
 * whole metrics response or one bucket. Pending runs are left out — they
 * have not failed — and so is `requests`, which counts them. Null when
 * nothing has finished, rather than a misleading 0.
 */
export function failureRate(
  metrics: Pick<HistoryMetricsResponse, 'total_ok' | 'total_failed'> | Pick<HistoryMetricsBucket, 'ok' | 'failed'>,
): number | null {
  const [ok, failed] =
    'total_ok' in metrics ? [metrics.total_ok, metrics.total_failed] : [metrics.ok, metrics.failed];
  const finished = ok + failed;
  return finished === 0 ? null : failed / finished;
}

export class History extends APIResource {
  /**
   * This credential's recent billable runs, newest first. Note the page's
   * `total` is its own count (`total_is_estimate: true`), not the all-time
   * number of runs.
   */
  async list(
    params: HistoryListParams = {},
    options?: RequestOptions,
  ): Promise<Envelope<HistoryRunSummary>> {
    let actionTypes: string[] | undefined;
    if (params.action_type !== undefined) {
      actionTypes = Array.isArray(params.action_type) ? params.action_type : [params.action_type];
      ensure(actionTypes.length > 0, '`action_type` must name at least one action when given');
    }
    const query = {
      cursor: params.cursor,
      limit: params.limit === undefined ? undefined : String(params.limit),
      action_type: actionTypes,
      from: params.from === undefined ? undefined : toIso(params.from, 'from'),
      to: params.to === undefined ? undefined : toIso(params.to, 'to'),
    };
    return this.transport.request('GET', '/v1/usage/history', { query, options });
  }

  /** Iterate history pages, as `searchPages` does. Free. */
  listPages(
    params: HistoryListParams = {},
    options?: PageOptions,
  ): AsyncGenerator<Envelope<HistoryRunSummary>, void, undefined> {
    return paginate((page, opts) => this.list(page, opts), params, options, envelopeShape());
  }

  /**
   * One run plus its replayable snapshot. An unknown or foreign run id is a
   * 404 with code `history.not_found` ({@link NotFoundError}).
   */
  async retrieve(runId: number, options?: RequestOptions): Promise<HistoryRunDetail> {
    ensure(
      Number.isInteger(runId) && runId > 0,
      `\`runId\` must be a positive integer (got ${runId})`,
    );
    return this.transport.request('GET', `/v1/usage/history/${runId}`, { options });
  }

  /** Daily run counts, outcomes, and credits over this credential's runs. */
  async metrics(
    params: HistoryMetricsParams = {},
    options?: RequestOptions,
  ): Promise<HistoryMetricsResponse> {
    const query = {
      from: params.from === undefined ? undefined : toIso(params.from, 'from'),
      to: params.to === undefined ? undefined : toIso(params.to, 'to'),
    };
    return this.transport.request('GET', '/v1/usage/metrics', { query, options });
  }
}

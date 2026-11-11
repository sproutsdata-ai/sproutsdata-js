/** Research runs: a question worked through for minutes, with cited criteria. */

import { WaitTimeoutError } from '../core/errors.js';
import type { ServerSentEvent } from '../core/sse.js';
import type { RequestOptions } from '../core/transport.js';
import type * as W from '../generated/wire.js';
import { nextPoll, pageQuery, runBody, SETTLED } from '../requests/runs.js';
import type { PageOptions, PageParams, RunCreateParams, WaitOptions } from '../types/index.js';
import { Resource } from './resource.js';

const DEFAULT_POLL_MS = 3_000;
const DEFAULT_MAX_WAIT_MS = 900_000;

/** Start a run, follow it, read its answer. */
export class Runs extends Resource {
  /**
   * Start a run. Answers at once with its id; the work goes on server-side. The run is billed
   * when it settles (`credits_charged` on the result); a run cancelled before it finishes is
   * not. An Idempotency-Key is required: the SDK generates one unless `options.idempotencyKey`
   * gives it (1 to 255 characters), and resends it on its own retries.
   *
   * @throws {PermissionDeniedError} The key lacks the `dsp.agents.*` scopes (a key made with
   *   the default scopes has none).
   */
  async create(params: RunCreateParams, options?: RequestOptions): Promise<W.RunHandle> {
    return this.json('runsCreate', { body: runBody(params) }, options);
  }

  /**
   * One page of the workspace's runs, newest first. Free.
   *
   * @throws {FeatureNotAvailableError} The server cannot list runs yet (501).
   */
  async list(params: PageParams = {}, options?: RequestOptions): Promise<W.RunList> {
    return this.json('runsList', { query: pageQuery('runs.list', params) }, options);
  }

  /** Every run in the workspace, page after page, newest first. Free. */
  iterList(params: Omit<PageParams, 'cursor'> & PageOptions = {}, options?: RequestOptions): AsyncGenerator<W.RunListItem, void, undefined> {
    const { maxResults, ...query } = params;
    return this.rows('runsList', { query: pageQuery('runs.list', query) }, (page) => page.results, options, maxResults);
  }

  /** A run as it stands: `status` (`pending`, `running`, `completed`, `failed`, `cancelled`), `summary`, `effort_ran` and cost. Free. */
  async retrieve(runId: string, options?: RequestOptions): Promise<W.RunResult> {
    return this.json('runsRetrieve', { path: { run_id: runId } }, options);
  }

  /** Stop a run. A run that had already finished stays finished (and charged). */
  async cancel(runId: string, options?: RequestOptions): Promise<W.RunResult> {
    return this.json('runsCancel', { path: { run_id: runId } }, options);
  }

  /**
   * Poll `retrieve` until the run settles (`completed`, `failed` or `cancelled`), passing
   * `options` to each poll. A failed or cancelled run is returned, not thrown.
   *
   * @throws {WaitTimeoutError} The run had not settled in time. It goes on server-side;
   *   `error.last` is the last `RunResult` seen.
   */
  async wait(runId: string, wait: WaitOptions = {}, options?: RequestOptions): Promise<W.RunResult> {
    const started = this.clock.now();
    const maxWaitMs = wait.maxWaitMs === undefined ? DEFAULT_MAX_WAIT_MS : wait.maxWaitMs;
    let delay = wait.pollIntervalMs ?? DEFAULT_POLL_MS;
    for (;;) {
      const run = await this.retrieve(runId, options);
      if (SETTLED.has(run.status)) return run;
      const waited = this.clock.now() - started;
      if (maxWaitMs !== null && waited + delay > maxWaitMs) {
        throw new WaitTimeoutError(`Run ${runId} was still ${run.status} after ${String(Math.round(waited / 1000))}s. It goes on server-side: call runs.retrieve or runs.wait again.`, run);
      }
      await this.clock.sleep(delay, options?.signal);
      delay = nextPoll(delay);
    }
  }

  /**
   * A run's events as they happen, until the stream ends. The stream carries no closing frame,
   * so read the outcome with `retrieve` (or `wait`) afterwards. A stream that breaks throws
   * `APIConnectionError` with `lastEventId`: pass it back as `options.lastEventId` to resume
   * after the last event read. A person run's `rows.preliminary` events carry no preview.
   */
  events(runId: string, options?: RequestOptions): AsyncGenerator<ServerSentEvent, void, undefined> {
    return this.stream('runsEvents', { path: { run_id: runId } }, options);
  }

  /** One page of a settled run's rows, with its `columns` filled in on each. Free. */
  async results(runId: string, params: PageParams = {}, options?: RequestOptions): Promise<W.RunResultsEnvelope> {
    return this.json('runsResults', { path: { run_id: runId }, query: pageQuery('runs.results', params) }, options);
  }

  /** Every row of a settled run, page after page. Free. */
  iterResults(runId: string, params: Omit<PageParams, 'cursor'> & PageOptions = {}, options?: RequestOptions): AsyncGenerator<Readonly<Record<string, unknown>>, void, undefined> {
    const { maxResults, ...query } = params;
    const first = { path: { run_id: runId }, query: pageQuery('runs.results', query) };
    return this.rows('runsResults', first, (page) => page.results, options, maxResults);
  }
}

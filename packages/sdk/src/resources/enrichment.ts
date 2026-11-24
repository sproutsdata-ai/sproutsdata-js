/**
 * Enrichment: values for records you already hold. People (`contacts`) are enriched for `EMAIL`
 * and `PHONE`, companies (`accounts`) for `DOMAIN`, `PHONE` and `LINKEDIN_URL`. Each field has
 * its price (by default 1 credit, a phone number 9). The most a request can cost (every field of
 * every row, at its price) is held first; only values newly found are charged. A value already known, a miss and a row on the Do-Not-Contact list cost nothing.
 * Needs a key with `dsp.enrichment.write` to start, cancel and look up, and
 * `dsp.enrichment.read` (or write) to read; a key's default scopes have neither.
 */

import type { RequestOptions } from '../core/transport.js';
import { waitFor } from '../core/wait.js';
import { DEFAULTS } from '../generated/defaults.js';
import type * as W from '../generated/wire.js';
import { jobBody, lookupBody, MAX_JOBS_PAGE, MAX_RESULTS_PAGE, pageQuery, SETTLED } from '../requests/enrichment.js';
import type { EnrichmentListParams, EnrichmentResultsParams, PageOptions, WaitOptions } from '../types/index.js';
import { Resource } from './resource.js';

const PACE = DEFAULTS.enrichmentWait;

/** A job, started and read until it ends, and a lookup answered in the call. */
export class Enrichment extends Resource {
  /**
   * Start a job and get its handle at once; the work goes on server-side. `fields` (1 to 3,
   * each once) is required: nothing is looked up, or charged, that you did not ask for. Each
   * item carries what you know (a `linkedin_url`, a name with `company_domain` or
   * `company_name`, `email_hint`) and your own `external_id`, echoed back; its own `fields` is a
   * subset of `fields`. `re_enrich` looks up values already known (each costs again);
   * `verify_mode` is for contacts only. An Idempotency-Key is required: the SDK generates one
   * unless `options.idempotencyKey` gives it, and resends it on its own retries.
   *
   * @throws {ClientValidationError} A request the server would refuse, in its words.
   * @throws {InsufficientCreditsError} The workspace cannot hold what the job may cost.
   * @throws {ConflictError} The key already started a job with another body.
   * @throws {PermissionDeniedError} The key lacks `dsp.enrichment.write`.
   */
  async create(params: W.EnrichmentJobRequest, options?: RequestOptions): Promise<W.EnrichmentJobHandle> {
    return this.json('enrichmentCreate', { body: jobBody(params) }, options);
  }

  /** One page of the workspace's jobs, newest first, as each was last read. Free. A lookup that became a job is not listed. */
  async list(params: EnrichmentListParams = {}, options?: RequestOptions): Promise<W.EnrichmentJobList> {
    return this.json('enrichmentList', { query: pageQuery('enrichment.list', params, MAX_JOBS_PAGE) }, options);
  }

  /** Every job in the workspace, page after page, newest first. Free. */
  iterList(params: Omit<EnrichmentListParams, 'cursor'> & PageOptions = {}, options?: RequestOptions): AsyncGenerator<W.EnrichmentJobSummary, void, undefined> {
    const { maxResults, ...query } = params;
    return this.rows('enrichmentList', { query: pageQuery('enrichment.list', query, MAX_JOBS_PAGE) }, (page) => page.results, options, maxResults);
  }

  /**
   * A job as it stands: `status` (`queued`, `running`, `cancelling`, `completed`, `failed`,
   * `cancelled`), `counts`, `credits_used`, and `credits_charged` and `values_found`, set once
   * it has ended. Free; reading a job that has ended settles its credits.
   */
  async retrieve(jobId: string, options?: RequestOptions): Promise<W.EnrichmentJob> {
    return this.json('enrichmentRetrieve', { path: { job_id: jobId } }, options);
  }

  /** Stop a job. Values already found are charged; a job that had ended stays as it was. */
  async cancel(jobId: string, options?: RequestOptions): Promise<W.EnrichmentJob> {
    return this.json('enrichmentCancel', { path: { job_id: jobId } }, options);
  }

  /**
   * Poll `retrieve` until the job ends (`completed`, `failed` or `cancelled`), passing `options`
   * to each poll: 2 s before the second poll, each wait half again longer up to 30 s, for up to
   * 30 minutes. A failed or cancelled job is returned, not thrown: it is charged for the values
   * it found before it stopped.
   *
   * @throws {WaitTimeoutError} The job had not ended in time. It goes on server-side;
   *   `error.last` is the last `EnrichmentJob` seen.
   */
  async wait(jobId: string, wait: WaitOptions = {}, options?: RequestOptions): Promise<W.EnrichmentJob> {
    return waitFor(this.clock, {
      read: () => this.retrieve(jobId, options),
      settled: (job) => SETTLED.has(job.status),
      stillGoing: (job, seconds) => `Enrichment job ${jobId} was still ${job.status} after ${String(seconds)}s. It goes on server-side: call enrichment.retrieve or enrichment.wait again.`,
      pollIntervalMs: wait.pollIntervalMs ?? PACE.pollInitialMs,
      maxWaitMs: wait.maxWaitMs === undefined ? PACE.deadlineMs : wait.maxWaitMs,
      pollMultiplier: PACE.pollMultiplier,
      pollMaxMs: PACE.pollMaxMs,
      signal: options?.signal,
    });
  }

  /**
   * One page of a job's rows so far, in order (up to 500 a page). Free. Each row has its
   * `input`, an `outcome`, the `fields` found (each with a `status`, a `value` and whether it
   * was `verified`), and the `credits` it used. Rows are kept for 7 days after a job ends.
   *
   * @throws {ResultsExpiredError} The job's rows are no longer kept.
   */
  async results(jobId: string, params: EnrichmentResultsParams = {}, options?: RequestOptions): Promise<W.EnrichmentJobResults> {
    return this.json('enrichmentResults', { path: { job_id: jobId }, query: pageQuery('enrichment.results', params, MAX_RESULTS_PAGE) }, options);
  }

  /** Every row of a job, page after page. Free. */
  iterResults(jobId: string, params: Omit<EnrichmentResultsParams, 'cursor'> & PageOptions = {}, options?: RequestOptions): AsyncGenerator<W.EnrichmentRow, void, undefined> {
    const { maxResults, ...query } = params;
    const first = { path: { job_id: jobId }, query: pageQuery('enrichment.results', query, MAX_RESULTS_PAGE) };
    return this.rows('enrichmentResults', first, (page) => page.results, options, maxResults);
  }

  /**
   * Enrich up to 20 items in the call (a workspace may take fewer). The most it can cost is held
   * first, and only values newly found are charged. A lookup that does not finish in the call
   * answers `complete: false`: it became the job `job_id`, which settles when it ends; `wait`
   * for it, then read its `results`. `wait_seconds` bounds how long it may take, 0.1 to 20
   * (the server's default is 15). The SDK sends an Idempotency-Key, so a repeat answers the
   * first again and is charged once.
   *
   * @throws {ClientValidationError} A request the server would refuse, in its words.
   * @throws {InsufficientCreditsError} The workspace cannot hold what the lookup may cost.
   * @throws {InvalidRequestError} More items than this workspace's lookups take
   *   (`request.too_large`): start a job instead.
   */
  async lookup(params: W.EnrichmentLookupRequest, options?: RequestOptions): Promise<W.EnrichmentLookupResult> {
    return this.json('enrichmentLookup', { body: lookupBody(params) }, options);
  }
}

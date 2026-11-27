/**
 * Export jobs, and exporting search rows. Following a job and downloading its file are free; an
 * export charges the lookup price for each record it shows whole that the workspace has not
 * unlocked in the last 90 days, as a saved list does.
 */

import { ExportFailedError } from '../core/errors.js';
import type { RequestOptions } from '../core/transport.js';
import { waitFor } from '../core/wait.js';
import { DEFAULTS } from '../generated/defaults.js';
import type * as W from '../generated/wire.js';
import { searchExportBody } from '../requests/lists.js';
import type { ExportResult, SearchExportParams, WaitOptions } from '../types/index.js';
import { Resource } from './resource.js';

const PACE = DEFAULTS.exportWait;

/** Export jobs: how one stands, waiting for it, and its file. */
export class Exports extends Resource {
  /** An export job as it stands: `status` (`queued`, `running`, `done`, `failed`), `rows`. */
  async retrieve(jobId: string, options?: RequestOptions): Promise<W.ExportJobView> {
    return this.json('exportsRetrieve', { path: { job_id: jobId } }, options);
  }

  /**
   * A finished job's file, as CSV text (the byte-order mark removed).
   *
   * @throws {NotFoundError} No such job, or its file has expired (`export.not_found`).
   */
  async download(jobId: string, options?: RequestOptions): Promise<string> {
    return this.csv('exportsDownload', { path: { job_id: jobId } }, options);
  }

  /**
   * Poll `retrieve` until the job is `done`, passing `options` to each poll, then return it.
   *
   * @throws {ExportFailedError} The job failed; `error.job.error` says why.
   * @throws {WaitTimeoutError} The job had not finished in time; `error.last` is its last state.
   */
  async wait(jobId: string, wait: WaitOptions = {}, options?: RequestOptions): Promise<W.ExportJobView> {
    return waitFor(this.clock, {
      read: () => this.retrieve(jobId, options),
      settled: (job) => {
        if (job.status === 'failed') throw new ExportFailedError(`Export ${jobId} failed: ${job.error ?? 'no reason given'}`, job);
        return job.status === 'done';
      },
      stillGoing: (job, seconds) => `Export ${jobId} was still ${job.status} after ${String(seconds)}s. It goes on server-side: call exports.wait again.`,
      pollIntervalMs: wait.pollIntervalMs ?? PACE.pollInitialMs,
      maxWaitMs: wait.maxWaitMs === undefined ? PACE.deadlineMs : wait.maxWaitMs,
      pollMultiplier: PACE.pollMultiplier,
      pollMaxMs: PACE.pollMaxMs,
      signal: options?.signal,
    });
  }
}

/** Exporting search rows as CSV. */
export class SearchExport extends Resource {
  /**
   * Export search rows (up to 50,000), each `{ entity_category, entity_id }`, with the
   * `request_id` of the search they came from: `{ kind: 'file', csv }` at once, or
   * `{ kind: 'job', job }` for a larger export. Charged once per record shown whole and not yet
   * unlocked; a file says what it cost (`creditsCharged`). It reads no `Idempotency-Key`, so it is
   * thrown, not repeated, when its work may have run.
   *
   * @throws {InsufficientCreditsError} Too few credits for the records it would show whole.
   * @throws {InvalidRequestError} Too many rows for one export (`export.too_large`).
   */
  async searchExport(params: SearchExportParams, options?: RequestOptions): Promise<ExportResult> {
    return this.fileOrJob('searchExport', { body: searchExportBody(params) }, options);
  }
}

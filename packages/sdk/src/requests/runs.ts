/** Run bodies and queries, and the rules of waiting for a run. */

import type * as W from '../generated/wire.js';
import type { PageParams } from '../types/index.js';
import { checkLimit } from './build.js';
import { checkShape } from './shape.js';

/** `limit` on the run list and on a run's results (be agents/api.py). */
export const MAX_PAGE_SIZE = 100;

/** The states a run does not leave. */
export const SETTLED: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

const MAX_POLL_MS = 15_000;

/** The body of a new run, checked locally. */
export function runBody(params: W.RunRequest): W.RunRequest {
  checkShape('runs.create', params, 'RunRequest');
  return params;
}

/** The query of a page of runs or of a run's results. */
export function pageQuery(what: string, params: PageParams): PageParams {
  checkLimit(what, 'limit', params.limit, MAX_PAGE_SIZE);
  return params;
}

/** The wait before the next poll: half again longer each time, to at most 15 s. */
export function nextPoll(delayMs: number): number {
  return Math.min(delayMs * 1.5, Math.max(MAX_POLL_MS, delayMs));
}

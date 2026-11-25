/** Run bodies and queries, and the rules of waiting for a run. */

import type * as W from '../generated/wire.js';
import type { PageParams, RunCreateParams } from '../types/index.js';
import { checkLimit } from './build.js';
import { currentEffort } from './effort.js';
import { checkShape } from './shape.js';

/** `limit` on the run list and on a run's results, as the API caps it. */
export const MAX_PAGE_SIZE = 100;

/** The states a run does not leave. */
export const SETTLED: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

/** The body of a new run, checked locally; an earlier effort name is sent as its new one. */
export function runBody(params: RunCreateParams): W.RunRequest {
  const { effort, ...rest } = params;
  const body: W.RunRequest = effort === undefined ? rest : { ...rest, effort: currentEffort(effort) };
  checkShape('runs.create', body, 'RunRequest');
  return body;
}

/** The query of a page of runs or of a run's results. */
export function pageQuery(what: string, params: PageParams): PageParams {
  checkLimit(what, 'limit', params.limit, MAX_PAGE_SIZE);
  return params;
}

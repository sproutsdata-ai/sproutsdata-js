/**
 * The bodies of `POST /v1/feedback` and `PUT /v1/feedback/votes`, checked as the server checks
 * them: each rule is the API's own for the request schema it names. The tag and reason vocabulary is the
 * server's (`feedback.tags()` lists it), so an unknown tag is left to the server to name.
 */

import type * as W from '../generated/wire.js';
import { checkLimit, checkText, refuse } from './build.js';
import { checkShape } from './shape.js';

/** Tags that need a comment saying what went wrong. */
const NEEDS_COMMENT = new Set(['other']);
const MAX_PAGE_SIZE = 100;

/** A report on a result or a result set; one with no `subject_ref` is a help report. */
export function reportBody(params: W.ReportRequest): W.ReportRequest {
  checkShape('feedback.create', params, 'ReportRequest');
  if ((params.tags ?? []).some((tag) => NEEDS_COMMENT.has(tag)) && (params.comment ?? '').trim() === '') {
    refuse('feedback.create', '`other` needs a comment saying what went wrong');
  }
  return params;
}

/** A like or dislike on a result set, or a flag on one result (API: `VoteRequest`). */
export function voteBody(params: W.VoteRequest): W.VoteRequest {
  const what = 'feedback.votes.cast';
  checkShape(what, params, 'VoteRequest');
  if (params.level === 'result' && (params.vote !== 'flag' || !params.entity_id)) refuse(what, 'a single result takes only a `flag`, naming its `entity_id`');
  if (params.level === 'result_set' && params.vote === 'flag') refuse(what, 'a result set takes `like` or `dislike`');
  if (typeof params.reason_code === 'string' && params.vote === 'like') refuse(what, 'a `like` takes no reason');
  if (params.text && !params.reason_code) refuse(what, '`text` comes after a reason');
  return params;
}

/** The query of a page of reports. */
export function reportsQuery<T extends { readonly limit?: number }>(params: T): T {
  checkLimit('feedback.list', 'limit', params.limit, MAX_PAGE_SIZE);
  return params;
}

/** The query of an answer's votes. */
export function votesQuery(requestId: string): { readonly request_id: string } {
  checkText('feedback.votes.list', 'request_id', requestId, 64);
  return { request_id: requestId };
}

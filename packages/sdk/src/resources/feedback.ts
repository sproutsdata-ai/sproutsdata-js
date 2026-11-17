/** Feedback: reports on answers, and votes on a result set or one result. Free. */

import type { RequestOptions } from '../core/transport.js';
import type { Transport } from '../core/transport.js';
import type * as W from '../generated/wire.js';
import { reportBody, reportsQuery, voteBody, votesQuery } from '../requests/feedback.js';
import type { PageOptions, PageParams, ReportParams, VoteParams } from '../types/index.js';
import { Resource } from './resource.js';

/** Votes on an answer: one per voter, per result set or result. */
export class Votes extends Resource {
  /**
   * Vote on an answer, or change your vote (`changed` says whether it did). `request_id` is the
   * answer's `meta.request_id`; a `result_set` takes `like` or `dislike`, a `result` only a
   * `flag` with its `entity_id`. A reason comes from `feedback.tags()`; a `like` takes none.
   */
  async cast(params: VoteParams, options?: RequestOptions): Promise<W.VoteCastResponse> {
    return this.json('feedbackVote', { body: voteBody(params) }, options);
  }

  /** Your votes on an answer, by its `meta.request_id`. */
  async list(params: { readonly request_id: string }, options?: RequestOptions): Promise<W.VoteListResponse> {
    return this.json('feedbackVotesList', { query: votesQuery(params.request_id) }, options);
  }
}

/** Reports on answers. */
export class Feedback extends Resource {
  /** Votes on a result set or one result. */
  readonly votes: Votes;

  constructor(transport: Transport) {
    super(transport);
    this.votes = new Votes(transport);
  }

  /**
   * Report on an answer: a row (`target.kind: 'result'`) or the whole answer. With no
   * `subject_ref` the report is a help request about the API in general. The SDK sends an
   * Idempotency-Key (yours, in `options.idempotencyKey`, or one it makes), so a retry files it
   * once. The server records answers a moment after sending them, so a report on an answer from
   * a second ago may throw `NotFoundError` (`feedback.subject_not_found`): report again shortly.
   */
  async create(params: ReportParams, options?: RequestOptions): Promise<W.ReportView> {
    return this.json('feedbackCreate', { body: reportBody(params) }, options);
  }

  /** One page of the workspace's reports, newest first. */
  async list(params: PageParams = {}, options?: RequestOptions): Promise<W.ReportsPage> {
    return this.json('feedbackList', { query: reportsQuery(params) }, options);
  }

  /** Every report, page after page. */
  iterList(params: Omit<PageParams, 'cursor'> & PageOptions = {}, options?: RequestOptions): AsyncGenerator<W.ReportView, void, undefined> {
    const { maxResults, ...query } = params;
    return this.rows('feedbackList', { query: reportsQuery(query) }, (page) => page.results, options, maxResults);
  }

  /** The reasons a report or a vote can give, each for its `level`. Needs a key with `dsp.search.read` or `dsp.usage.read`. */
  async tags(options?: RequestOptions): Promise<W.TagsResponse> {
    return this.json('feedbackTags', {}, options);
  }
}

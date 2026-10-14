/**
 * The `/v1/feedback` surface: report a bad (or good) result or result set
 * against a request you made, list your own reports, and read the tag
 * vocabulary.
 *
 * A report points at a metered call by its `meta.request_id` (`kind:
 * 'request'` — any search, look-alike, entity or relationship run) or at an
 * agent run by its `run_id` (`kind: 'agent_run'`). Tags are a closed,
 * levelled, versioned set served live by `GET /v1/feedback/tags` — including
 * which tags need a `comment` (`requires_comment`). The SDK checks only the
 * report's structure (a subject and a target, `entity_id` exactly when the
 * target is one result) and leaves vocabularies and limits to the server,
 * whose 422 names the field. `create` and `list` require an API key; `tags`
 * is unauthenticated. None of them is billed, but `create` is never
 * retried once it may have reached the server: a repeat would file the
 * report twice.
 *
 * `context: 'help'` files a problem report about the product rather than one
 * answer, with no subject. `feedback.votes` takes lighter signals: a like or
 * dislike on a whole answer, or a flag on one record.
 */

import type { RequestOptions, Transport } from './http';
import { APIResource } from './resource';
import type { EntityCategory } from './types';
import { compact, ensure } from './validate';

/**
 * What a report points at, named by the id it carries: `request` for
 * anything in usage history (its `meta.request_id`), `agent_run` for an
 * agent run (its `run_id`).
 */
export type FeedbackSubjectKind = 'request' | 'agent_run';

export interface FeedbackSubjectRef {
  kind: FeedbackSubjectKind;
  /** `meta.request_id` for `request`; `run_id` for `agent_run`. */
  id: string;
}

/** One row (`result`) or the whole page (`result_set`). */
export type FeedbackTargetKind = 'result' | 'result_set';

export interface FeedbackTarget {
  kind: FeedbackTargetKind;
  /** Required when `kind` is `result`; must be omitted for `result_set`. At most 128 characters. */
  entity_id?: string;
  /** At most 32 characters. */
  entity_type?: string;
}

export type FeedbackSentiment = 'bad' | 'good';

/**
 * The tag vocabulary at version 2. Open (`string`) because the set is
 * versioned and served live; the server refuses an unknown tag or one filed
 * at the wrong level, naming the accepted set.
 */
export type FeedbackTag =
  // One result
  | 'irrelevant'
  | 'wrong_entity'
  | 'stale'
  | 'data_quality'
  | 'duplicate'
  // The whole set
  | 'bad_ranking'
  | 'missing'
  | 'no_results'
  | 'too_few'
  | 'too_many'
  // Either level — requires a comment
  | 'other'
  | (string & {});

/** What should have happened. Omitting it entirely means "I don't know". */
export interface FeedbackExpected {
  /** At most 200 entries. */
  should_include?: string[];
  /** At most 200 entries. */
  should_exclude?: string[];
  note?: string;
}

/** Body for `POST /v1/feedback`. */
export interface FeedbackCreateParams {
  /** The request or run reported. Required unless `context` is `'help'`. */
  subject_ref?: FeedbackSubjectRef;
  /**
   * `'help'` for a problem report about the product rather than one answer —
   * what a Help menu sends. `subject_ref` may then be omitted; `target.kind`
   * must be `'result_set'`, and the report needs a `comment` or `tags`.
   */
  context?: 'help';
  target: FeedbackTarget;
  /** Defaults to `bad` on the server. */
  sentiment?: FeedbackSentiment;
  /** At most 10. Each must apply to `target.kind` (see `TagDescriptor.applies_to`). */
  tags?: FeedbackTag[];
  /** Free text, unbounded. Required when a chosen tag needs one (`other`). */
  comment?: string;
  expected?: FeedbackExpected;
}

/** Response of `POST /v1/feedback` (201). */
export interface FeedbackCreated {
  feedback_id: string;
  created_at: string;
  /**
   * Whether the reported entity could be confirmed in that result set. False
   * does not mean the report was wrong — only that the stored snapshot could
   * not confirm it (size-omitted, or past its 30-day expiry).
   */
  target_verified: boolean;
  tag_vocab_version: number;
}

export type FeedbackStatus = 'new' | 'triaged' | 'confirmed' | 'dismissed';

/** Query for `GET /v1/feedback`. Offset-paginated — the one list on `/v1` that is. */
export interface FeedbackListParams {
  /** Only reports against this subject id (a `request_id` or `run_id`). */
  subject_id?: string;
  status?: FeedbackStatus;
  /** Only reports carrying this tag. */
  tag?: FeedbackTag;
  subject_kind?: FeedbackSubjectKind;
  /** Page size. Defaults to 50 on the server. */
  limit?: number;
  /** Rows to skip. Defaults to 0. */
  offset?: number;
}

/**
 * The run a report points at, resolved at read time under the caller's own
 * visibility. Null on a `FeedbackView` when the run has aged out.
 */
export interface FeedbackSubject {
  /** What was asked, in the caller's own words. Null on an id-only lookup. */
  query: string | null;
  action_type: string;
  occurred_at: string;
  status: string;
  /** Rows served on page one. */
  result_count: number | null;
  /** How many the platform said there were. Null means not counted, never "none found". */
  result_total: number | null;
  result_total_is_estimate: boolean | null;
  /** The numeric history id (`client.history.retrieve`). */
  run_id: number | null;
}

/** One report, as `GET /v1/feedback` returns it. */
export interface FeedbackView {
  feedback_id: string;
  subject_kind: string;
  subject_id: string;
  target_kind: string;
  target_entity_id: string | null;
  sentiment: string;
  tags: string[];
  tag_vocab_version: number;
  comment: string | null;
  expected: Record<string, unknown> | null;
  target_verified: boolean;
  status: string;
  created_at: string;
  subject: FeedbackSubject | null;
}

/** Response of `GET /v1/feedback`. Not an `Envelope`: offset-paginated, no `meta`. */
export interface FeedbackListResponse {
  results: FeedbackView[];
  /** How many reports this credential has filed in this tenant — the whole list, not the page. */
  total: number;
  limit: number;
  offset: number;
}

/** One tag as a form should render it. */
export interface TagDescriptor {
  tag: string;
  /** `result`, `result_set`, or `any`. */
  applies_to: string;
  /** What the checkbox says. */
  label: string;
  /** The clarifier under it. */
  description: string;
  /** The tag is meaningless without prose; the form should insist before the API refuses. */
  requires_comment: boolean;
}

/** Response of `GET /v1/feedback/tags`. */
export interface TagVocabularyResponse {
  version: number;
  tags: TagDescriptor[];
}

/** A vote on a whole answer (`result_set`) or on one record (`result`). */
export type VoteLevel = 'result_set' | 'result';

/** `like` / `dislike` on a whole answer; `flag` on one record. */
export type VoteValue = 'like' | 'dislike' | 'flag' | (string & {});

/** Body for `PUT /v1/feedback/votes`. */
export interface VoteCastParams {
  /** The answer voted on: its `meta.request_id`, or an agent run's `run_id`. */
  request_id: string;
  vote: VoteValue;
  /** The category of the results (a whole answer) or of the flagged record. */
  entity_category: EntityCategory;
  /** The flagged record's id. Required for `level: 'result'`, refused for `'result_set'`. */
  entity_id?: string;
  /** Follows `entity_id` when omitted: given means `result`, absent means `result_set`. */
  level?: VoteLevel;
  /**
   * Why, optionally — checked by the server. On a whole answer:
   * `not_relevant`, `missing_expected`, `too_few`, `wrong_or_outdated`,
   * `other`. On a record: `wrong_entity`, `outdated`, `duplicate`,
   * `missing_info`, `other`. Never with `like`.
   */
  reason_code?: string;
  /** Free text, at most 2,000 characters. Only together with `reason_code`. */
  text?: string;
}

/** One vote, as the key that cast it sees it. */
export interface VoteView {
  vote_id: string;
  request_id: string;
  level: VoteLevel | (string & {});
  entity_category: string;
  entity_id: string | null;
  vote: VoteValue;
  reason_code: string | null;
  text: string | null;
  created_at: string;
}

/** Response of `PUT /v1/feedback/votes`. */
export interface VoteCastResponse {
  /** The vote now in force. */
  vote: VoteView;
  /** False when the same vote was already active: nothing was stored. */
  changed: boolean;
}

/** Response of `GET /v1/feedback/votes`: this key's active votes on one answer. */
export interface VoteListResponse {
  request_id: string;
  votes: VoteView[];
}

/**
 * `client.feedback.votes`. Each key holds one active vote per answer, and per
 * record: casting the same vote again changes nothing (`changed: false`) and a
 * different one replaces it, so a vote is safe to retry. Free; requires
 * `dsp.search.read` or `dsp.usage.read`.
 */
export class FeedbackVotes extends APIResource {
  /**
   * Vote on an answer. The SDK checks the pairing that decides what the vote
   * is about — a flag needs its record, a set vote names none — and that
   * `text` follows a `reason_code`; which votes and reasons exist is the
   * server's to say.
   */
  async cast(params: VoteCastParams, options?: RequestOptions): Promise<VoteCastResponse> {
    ensure(params !== null && typeof params === 'object', 'cast(params) requires a params object');
    ensure(
      typeof params.request_id === 'string' && params.request_id.trim().length > 0,
      "`request_id` must be the answer's `meta.request_id`, or an agent run's `run_id`",
    );
    // An empty or null id is no id: the same answer whichever way it is spelt.
    const entityId = params.entity_id || undefined;
    const level: VoteLevel = params.level ?? (entityId !== undefined ? 'result' : 'result_set');
    if (level === 'result') {
      ensure(
        typeof entityId === 'string',
        "`level: 'result'` flags one record and needs `entity_id`. For the whole answer, use 'result_set'",
      );
    } else if (level === 'result_set') {
      ensure(
        entityId === undefined,
        "`level: 'result_set'` votes on the whole answer; remove `entity_id`, or use 'result'",
      );
    }
    ensure(
      params.text === undefined || params.reason_code !== undefined,
      '`text` follows a reason: send `reason_code` with it',
    );
    return this.transport.request('PUT', '/v1/feedback/votes', {
      body: compact({ ...params, entity_id: entityId, level }),
      routeClass: 'safe',
      options,
    });
  }

  /** This key's active votes on one answer, by its `meta.request_id` or a run's `run_id`. */
  async list(requestId: string, options?: RequestOptions): Promise<VoteListResponse> {
    ensure(
      typeof requestId === 'string' && requestId.trim().length > 0,
      "`requestId` must be the answer's `meta.request_id`, or an agent run's `run_id`",
    );
    return this.transport.request('GET', '/v1/feedback/votes', {
      query: { request_id: requestId },
      options,
    });
  }
}

export class Feedback extends APIResource {
  /** Likes, dislikes and flags: `cast` and `list`. */
  readonly votes: FeedbackVotes;

  constructor(transport: Transport) {
    super(transport);
    this.votes = new FeedbackVotes(transport);
  }

  /**
   * File a report against one of your own requests or agent runs — or, with
   * `context: 'help'`, about the product itself. Returns 201 with the report's id. An unknown or foreign subject is a 404 with
   * code `feedback.subject_not_found` ({@link NotFoundError}). Free; requires
   * an API key.
   */
  async create(params: FeedbackCreateParams, options?: RequestOptions): Promise<FeedbackCreated> {
    ensure(
      params !== null && typeof params === 'object',
      'create(params) requires a params object',
    );
    const help = params.context !== undefined;
    if (help) {
      ensure(
        params.context === 'help',
        "`context` must be 'help' — a problem report not tied to one answer — or omitted",
      );
    }
    const subject = params.subject_ref;
    if (!help || subject !== undefined) {
      ensure(
        subject !== null && typeof subject === 'object' && typeof subject.kind === 'string',
        help
          ? '`subject_ref` is optional on a help report, but when given must be `{ kind, id }`'
          : "`subject_ref` must be `{ kind, id }` — the request or run being reported. For a problem with the product rather than one answer, send `context: 'help'` instead",
      );
      ensure(
        typeof subject.id === 'string' && subject.id.length > 0,
        '`subject_ref.id` must be a non-empty string (a meta.request_id or a run_id)',
      );
    }
    const target = params.target;
    ensure(
      target !== null && typeof target === 'object' && typeof target.kind === 'string',
      "`target` must be `{ kind }` — 'result' (one row) or 'result_set' (the page)",
    );
    if (target.kind === 'result') {
      ensure(
        typeof target.entity_id === 'string' && target.entity_id.length > 0,
        "`target.entity_id` is required when `target.kind` is 'result'",
      );
    } else if (target.kind === 'result_set') {
      ensure(
        target.entity_id === undefined,
        "`target.entity_id` must be omitted when `target.kind` is 'result_set'",
      );
    }
    if (params.tags !== undefined) {
      ensure(Array.isArray(params.tags), '`tags` must be an array of strings');
      params.tags.forEach((tag: unknown, i) => {
        ensure(typeof tag === 'string' && tag.length > 0, `\`tags[${i}]\` must be a non-empty string`);
      });
    }
    if (help) {
      ensure(
        target.kind === 'result_set',
        "A help report is about the product, not one record: `target.kind` must be 'result_set'",
      );
      ensure(
        (typeof params.comment === 'string' && params.comment.trim().length > 0) ||
          (params.tags !== undefined && params.tags.length > 0),
        'A help report needs a `comment` or `tags` saying what went wrong',
      );
    }
    // Tag vocabulary, tag/level matching, which tags need a comment, and
    // every count stay on the server, whose 422 lists what it accepts.
    return this.transport.request('POST', '/v1/feedback', {
      body: compact({ ...params }),
      routeClass: 'once',
      options,
    });
  }

  /**
   * Your own reports, newest first. Offset-paginated: there is no cursor and
   * no `listPages`; loop while `offset + results.length < total`. Free;
   * requires an API key.
   */
  async list(params: FeedbackListParams = {}, options?: RequestOptions): Promise<FeedbackListResponse> {
    const query = {
      subject_id: params.subject_id,
      status: params.status,
      tag: params.tag,
      subject_kind: params.subject_kind,
      limit: params.limit === undefined ? undefined : String(params.limit),
      offset: params.offset === undefined ? undefined : String(params.offset),
    };
    return this.transport.request('GET', '/v1/feedback', { query, options });
  }

  /**
   * The current tag vocabulary — labels, descriptions, which level each tag
   * applies to, and which need a comment. Render forms from this rather than
   * from a hardcoded list. Free and unauthenticated (the key is still sent).
   */
  async tags(options?: RequestOptions): Promise<TagVocabularyResponse> {
    return this.transport.request('GET', '/v1/feedback/tags', { options });
  }
}

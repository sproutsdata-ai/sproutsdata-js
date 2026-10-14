/**
 * The `/v1/agents/runs` surface (`client.runs`): asynchronous agentic search
 * runs.
 *
 * Starting a run reserves credits and settles on completion (cost is null
 * until then — never 0, which would read as free). `create` requires
 * `dsp.agents.write`; everything else takes `dsp.agents.read` or
 * `dsp.agents.write`. Reading a finished run's status is also what settles
 * its billing — so use {@link Runs.events} for progress UX and
 * {@link Runs.wait} (or `retrieve`) for outcomes with a real
 * `credits_charged`.
 */

import {
  HEADER_IDEMPOTENCY_KEY,
  MIN_POLL_INTERVAL_MS,
  RUN_POLL_INITIAL_MS,
  RUN_POLL_MAX_MS,
  RUN_POLL_MULTIPLIER,
  RUN_WAIT_DEADLINE_MS,
  STREAM_IDLE_TIMEOUT_MS,
} from './constants';
import { RunWaitTimeoutError } from './errors';
import type { RequestOptions } from './http';
import { envelopeShape, paginate, type PageOptions } from './paginate';
import { APIResource } from './resource';
import { newIdempotencyKey } from './runtime';
import { sleep } from './sleep';
import { parseSseStream } from './sse';
import type { Coverage, Degradation, Envelope, ResponseMeta } from './types';
import { compact, ensure, pathSegment } from './validate';

export type AgentRunCategory = 'company' | 'person';
export type AgentEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'auto';

/** A run's lifecycle. The last four are terminal. */
export type AgentRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'expired';

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'cancelled',
  'failed',
  'expired',
]);

/** Body for `POST /v1/agents/runs`. */
export interface AgentRunParams {
  /** The question. */
  query: string;
  /** Defaults to `company` on the server. */
  category?: AgentRunCategory;
  /** Defaults to `medium` on the server; `auto` picks from the deadline. */
  effort?: AgentEffort;
  /**
   * Extra requirements a row must satisfy, as prose (at most 10). The engine
   * decides which are expressible as filters — and therefore *proven* rather
   * than judged.
   */
  criteria?: string[];
  /**
   * Columns to fill, named (at most 20). A column no corpus can support
   * comes back null with a reason rather than invented.
   */
  enrichments?: string[];
  /**
   * Entity ids you already hold, left out of the answer (at most 1000).
   * Coverage is still measured against the whole addressable set.
   */
  exclusion?: string[];
}

/** Options for `runs.create`. */
export interface CreateRunOptions extends RequestOptions {
  /**
   * Unique per intent. Starting a run reserves credits and can take
   * minutes, so a repeat must be recognisable: replaying the same key
   * returns the original run's handle (HTTP 200 instead of 202 — invisible
   * here) rather than starting a second run.
   *
   * Optional. Without one the SDK generates `sdk-<32 hex>` and sends it on
   * every automatic retry of the call, which is what lets a timed-out create
   * be retried safely. Pass your own when a retry may come from somewhere
   * else — another process, or a job re-queued after a crash — so that one
   * is recognised too.
   */
  idempotencyKey?: string;
}

/** Options for `runs.wait`. */
export interface WaitRunOptions {
  /** Stop waiting (with `APIUserAbortError`) as soon as this aborts. */
  signal?: AbortSignal;
  /**
   * Deadline for the whole wait, in milliseconds. Default 900 000 (15
   * minutes); passing it throws `RunWaitTimeoutError` carrying the last
   * polled run.
   */
  timeoutMs?: number;
  /**
   * The first poll interval, in milliseconds (default 3 000, at least 250).
   * Each later interval is 1.5× the one before, up to 15 000.
   */
  pollIntervalMs?: number;
}

/** What `runs.create` returns — enough to poll, stream, or cancel. */
export interface AgentRunHandle {
  run_id: string;
  status: AgentRunStatus;
  meta: ResponseMeta;
}

/** A run's status and, once terminal, its outcome. */
export interface AgentRunResult {
  run_id: string;
  status: AgentRunStatus;
  stop_reason: string | null;
  /** Measured recall for the run — the same shape as `Envelope.coverage`. */
  coverage: Coverage | null;
  /**
   * Ways this run is less than it should be. `billing_bypassed` means the
   * work was done and nothing was charged.
   */
  degradation: Degradation[];
  /**
   * Cited statements about the market or technology behind the question — a
   * separate channel from the rows. Server-owned shape.
   */
  insights: Array<Record<string, unknown>>;
  /** The documents the insights rest on. Present even when `insights` is empty. */
  insight_sources: Array<Record<string, unknown>>;
  /** Two or three sentences on what came back; empty when the run could not say. */
  summary: string;
  /** What was left out, and why — named rather than implied by a smaller count. */
  exclusions: string[];
  /**
   * What this run cost, once settled. Null while running. `0` only when the
   * run was not charged — a failed or cancelled run, or one whose credit hold
   * lapsed before anyone read the finished run.
   */
  credits_charged: number | null;
  /** The effort tier requested: `minimal` to `xhigh`, or `auto`. */
  effort?: AgentEffort | (string & {}) | null;
  /**
   * The tier the run actually ran at, and was charged at, once settled — for
   * an `auto` run, the tier it chose. Null until then.
   */
  effort_ran?: AgentEffort | (string & {}) | null;
  error: string | null;
  meta: ResponseMeta;
}

export interface AgentRunListItem {
  run_id: string;
  status: AgentRunStatus;
  query: string | null;
  created_at: string;
  finished_at: string | null;
}

/**
 * The `runs.list` response — tenant-wide, newest first. Not an `Envelope`:
 * there is no cursor, only `limit`.
 */
export interface AgentRunList {
  results: AgentRunListItem[];
  meta: ResponseMeta;
}

/** One row of a finished run. `id` is typed; the rest is the run's own columns. */
export interface AgentRunRow {
  id: string;
  [field: string]: unknown;
}

export type AgentRunResultsEnvelope = Envelope<AgentRunRow>;

/**
 * The event vocabulary as of this SDK release. Server-owned and allowed to
 * grow, which is why {@link AgentRunEvent.type} stays an open string union.
 */
export type AgentRunEventType =
  | 'run.started'
  | 'step.started'
  | 'tool.called'
  | 'tool.result'
  | 'agent.started'
  | 'grounded'
  | 'coverage'
  | 'plan'
  | 'search.trace'
  | 'rows.preliminary'
  | 'source.added'
  | 'source.truncated'
  | 'budget'
  | 'provider.retry'
  | 'answer'
  | 'run.done'
  | 'error';

/** Event types after which the server closes the stream. */
export const TERMINAL_RUN_EVENTS: ReadonlySet<string> = new Set(['run.done', 'error']);

/** One event from a run's SSE stream. */
export interface AgentRunEvent {
  /**
   * The run's durable per-event sequence (the SSE id). Feed the last one you
   * saw back as `lastEventId` to resume a dropped stream without replaying.
   * Null when the frame carried no id.
   */
  seq: number | null;
  /** Open union: an event type this SDK release does not know is still delivered. */
  type: AgentRunEventType | (string & {});
  /** The event's JSON payload; `{}` when the data line was not valid JSON. */
  data: Record<string, unknown>;
  /** The untouched data line(s), for forward compatibility. */
  raw: string;
}

export class Runs extends APIResource {
  /**
   * Start a run. Requires `dsp.agents.write`; reserves credits (settled when
   * the run finishes and its status is read). Sent with an `Idempotency-Key`
   * — yours, or one generated for this call — so every retry of it is
   * recognised by the server rather than starting a second run.
   */
  async create(params: AgentRunParams, options?: CreateRunOptions): Promise<AgentRunHandle> {
    ensure(
      params !== null && typeof params === 'object',
      'runs.create(params) requires a params object',
    );
    ensure(
      typeof params.query === 'string' && params.query.length > 0,
      '`query` must be a non-empty string',
    );
    const { idempotencyKey: given, ...requestOptions } = options ?? {};
    if (given !== undefined) {
      ensure(
        typeof given === 'string' && given.trim().length > 0,
        '`idempotencyKey` must be a non-empty string when given (omit it to have one generated)',
      );
    }
    const idempotencyKey = given?.trim() ?? newIdempotencyKey();

    return this.transport.request('POST', '/v1/agents/runs', {
      body: compact({ ...params }),
      headers: { [HEADER_IDEMPOTENCY_KEY]: idempotencyKey },
      routeClass: 'keyed',
      options: requestOptions,
    });
  }

  /**
   * A run's status — and, once terminal, its outcome. Reading a finished run
   * is what settles its billing, so `credits_charged` is real here.
   */
  async retrieve(runId: string, options?: RequestOptions): Promise<AgentRunResult> {
    ensureRunId(runId);
    return this.transport.request('GET', `/v1/agents/runs/${pathSegment(runId)}`, {
      options,
    });
  }

  /**
   * This tenant's runs (all credentials), newest first. No cursor — `limit`
   * (default 25 on the server) is the only knob, which is why there is no
   * `listPages`.
   */
  async list(
    params: { limit?: number } = {},
    options?: RequestOptions,
  ): Promise<AgentRunList> {
    const query = { limit: params.limit === undefined ? undefined : String(params.limit) };
    return this.transport.request('GET', '/v1/agents/runs', { query, options });
  }

  /** Cancel a run and release its credit hold. Idempotent. */
  async cancel(runId: string, options?: RequestOptions): Promise<AgentRunResult> {
    ensureRunId(runId);
    return this.transport.request('POST', `/v1/agents/runs/${pathSegment(runId)}/cancel`, {
      routeClass: 'safe',
      options,
    });
  }

  /**
   * A finished run's rows — the same envelope every list endpoint returns,
   * with a real signed cursor. Free: the run was charged when it settled.
   */
  async results(
    runId: string,
    params: { cursor?: string; limit?: number } = {},
    options?: RequestOptions,
  ): Promise<AgentRunResultsEnvelope> {
    ensureRunId(runId);
    const query = {
      cursor: params.cursor,
      limit: params.limit === undefined ? undefined : String(params.limit),
    };
    return this.transport.request('GET', `/v1/agents/runs/${pathSegment(runId)}/results`, {
      query,
      options,
    });
  }

  /** Iterate a run's result pages, as `searchPages` does. Free. */
  resultsPages(
    runId: string,
    params: { cursor?: string; limit?: number } = {},
    options?: PageOptions,
  ): AsyncGenerator<AgentRunResultsEnvelope, void, undefined> {
    return paginate(
      (page, opts) => this.results(runId, page, opts),
      params,
      options,
      envelopeShape(),
    );
  }

  /**
   * A run's live event stream (SSE), for progress UX. Ends when the server
   * closes the stream, which it does after a terminal event
   * ({@link TERMINAL_RUN_EVENTS}) — the generator does not cut the stream
   * itself, so late frames are never swallowed.
   *
   * There is no mid-stream auto-reconnect: the stream is resumable by design.
   * On a drop, call again with `lastEventId` set to the last `seq` you saw —
   * it is sent as `Last-Event-ID` and the server replays only what followed.
   *
   * For outcomes (and a settled `credits_charged`), follow up with
   * {@link Runs.retrieve} or {@link Runs.wait}: events report
   * progress, reading the run settles it.
   */
  async *events(
    runId: string,
    params: { lastEventId?: string } = {},
    options?: RequestOptions,
  ): AsyncGenerator<AgentRunEvent, void, undefined> {
    ensureRunId(runId);
    const stream = await this.transport.requestStream(
      `/v1/agents/runs/${pathSegment(runId)}/events`,
      {
        headers:
          params.lastEventId === undefined ? undefined : { 'Last-Event-ID': params.lastEventId },
        options,
      },
    );
    try {
      if (stream.response.body === null) return;
      const messages = parseSseStream(stream.response.body, {
        signal: options?.signal,
        idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
      });
      for await (const message of messages) {
        const seq = message.id !== null && /^\d+$/.test(message.id) ? Number(message.id) : null;
        let data: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(message.data);
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            data = parsed as Record<string, unknown>;
          }
        } catch {
          // Not JSON — `raw` still carries it.
        }
        yield { seq, type: message.event, data, raw: message.data };
      }
    } finally {
      // However the stream ended — done, broken off by the consumer, timed
      // out — the caller's signal lets go of it.
      stream.release();
    }
  }

  /**
   * Poll until the run reaches a terminal status, then return its settled
   * result — `failed` and `expired` included: a terminal run is an answer,
   * not an error. The primary way to wait for an outcome: each poll is a
   * `retrieve`, and reading the run is what settles billing, so the result
   * carries a real `credits_charged`.
   *
   * Polls from 3 s, growing 1.5× per poll up to 15 s. Past the deadline
   * (default 15 minutes) it throws {@link RunWaitTimeoutError} carrying the
   * last polled run; the run itself carries on.
   */
  async wait(runId: string, opts: WaitRunOptions = {}): Promise<AgentRunResult> {
    ensureRunId(runId);
    const timeoutMs = opts.timeoutMs ?? RUN_WAIT_DEADLINE_MS;
    ensure(Number.isFinite(timeoutMs) && timeoutMs > 0, '`timeoutMs` must be a positive number');
    const deadline = Date.now() + timeoutMs;
    let interval = Math.max(opts.pollIntervalMs ?? RUN_POLL_INITIAL_MS, MIN_POLL_INTERVAL_MS);

    for (;;) {
      const run = await this.retrieve(runId, { signal: opts.signal });
      if (TERMINAL_RUN_STATUSES.has(run.status)) return run;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new RunWaitTimeoutError(run, timeoutMs);
      await sleep(Math.min(interval, remaining), opts.signal);
      interval = Math.min(interval * RUN_POLL_MULTIPLIER, RUN_POLL_MAX_MS);
    }
  }
}

function ensureRunId(runId: string): void {
  ensure(typeof runId === 'string' && runId.length > 0, '`runId` must be a non-empty string');
}

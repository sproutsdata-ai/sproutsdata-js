/**
 * Paging safely: the frozen request behind a page, and the request for the next one.
 *
 * A cursor is signed against the request that produced it: every field must be resent
 * unchanged (`limit` excepted, unless the operation binds it too), or the server answers
 * `422 pagination.cursor_invalid`. So a page holds a deep copy of its request, taken at the
 * moment of the call, and nothing the caller does to their own objects can change it.
 */

import type { Paging } from '../generated/operations.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGINATION_DEPTH } from './constants.js';
import { isRecord, PaginationDepthExceededError } from './errors.js';

/** The parts of a request a page is fetched with. */
export interface PageInput {
  readonly body?: Readonly<Record<string, unknown>> | undefined;
  readonly query?: Readonly<Record<string, unknown>> | undefined;
}

/** One page's frozen request, and the rules for the page after it. */
export class Pager {
  readonly paging: Paging;
  /** Rows before this page, across the whole walk. */
  readonly offset: number;
  readonly #body: Readonly<Record<string, unknown>> | undefined;
  readonly #query: Readonly<Record<string, unknown>> | undefined;

  constructor(paging: Paging, sent: PageInput, offset = 0) {
    this.paging = paging;
    this.offset = offset;
    this.#body = sent.body === undefined ? undefined : structuredClone(sent.body);
    this.#query = sent.query === undefined ? undefined : structuredClone(sent.query);
  }

  /** A copy of the request this page was fetched with (changing it changes nothing). */
  get sent(): PageInput {
    return { body: this.#body === undefined ? undefined : structuredClone(this.#body), query: this.#query === undefined ? undefined : structuredClone(this.#query) };
  }

  /** The `limit` this page was fetched with, else the server's default. */
  get pageSize(): number {
    const limit = (this.paging.cursorIn === 'query' ? this.#query : this.#body)?.['limit'];
    return typeof limit === 'number' ? limit : DEFAULT_PAGE_SIZE;
  }

  /** Whether the page after this one (which had `rows` rows) would start at or past the depth cap. */
  atDepthCap(rows: number): boolean {
    return this.offset + rows >= MAX_PAGINATION_DEPTH;
  }

  /**
   * The request for the page after this one. `limit` changes the page size where the
   * cursor allows it; where it binds the size (`bindsLimit`), the first page's is kept.
   */
  nextInput(cursor: string, rows: number, limit?: number): PageInput {
    if (this.atDepthCap(rows)) {
      throw new PaginationDepthExceededError({
        status: 422,
        headers: {},
        retryAfter: undefined,
        body: {
          code: 'pagination.depth_exceeded',
          title: 'Pagination too deep',
          detail: `Refused locally: the API pages no further than ${MAX_PAGINATION_DEPTH.toLocaleString('en-US')} results. Narrow the request instead.`,
        },
      });
    }
    const changes: Record<string, unknown> = { cursor };
    if (limit !== undefined && this.paging.bindsLimit !== true) changes['limit'] = limit;
    return this.#with(changes, this.paging.cursorIn ?? 'body');
  }

  /** The request for page `page + 1` of a page-numbered operation. */
  nextPageNumber(page: number): PageInput {
    return this.#with({ page: page + 1 }, 'query');
  }

  #with(changes: Readonly<Record<string, unknown>>, into: 'body' | 'query'): PageInput {
    const { body, query } = this.sent;
    return into === 'query' ? { body, query: { ...query, ...changes } } : { body: { ...body, ...changes }, query };
  }
}

/** The `limit` for the next page: no more rows than are still wanted (`undefined`: keep the size). */
export function nextLimit(pageSize: number, seen: number, maxResults: number | undefined): number | undefined {
  if (maxResults === undefined) return undefined;
  const remaining = maxResults - seen;
  return remaining > 0 ? Math.min(pageSize, remaining) : undefined;
}

/** The first page's `limit` for a walk that wants at most `maxResults` rows. */
export function firstLimit(limit: number | undefined, maxResults: number | undefined): number | undefined {
  if (maxResults === undefined || maxResults <= 0) return limit;
  return Math.min(limit ?? DEFAULT_PAGE_SIZE, maxResults);
}

/** Whether the server stopped paging before the results ran out. */
export function truncated(envelope: unknown): boolean {
  if (!isRecord(envelope) || envelope['has_more'] !== false || !Array.isArray(envelope['degradation'])) return false;
  return (envelope['degradation'] as unknown[]).some((d) => isRecord(d) && d['reason'] === 'pagination_truncated');
}

/** Whether the answer reports anything that made it less than it should be. */
export function degraded(envelope: unknown): boolean {
  return isRecord(envelope) && Array.isArray(envelope['degradation']) && envelope['degradation'].length > 0;
}

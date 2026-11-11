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
  readonly body?: object | undefined;
  readonly query?: object | undefined;
}

/** The request a page was fetched with, as sent. */
export interface SentPage {
  readonly body?: Readonly<Record<string, unknown>> | undefined;
  readonly query?: Readonly<Record<string, unknown>> | undefined;
}

/** A page's request part, copied: the caller's object is theirs to change. */
function frozen(part: object | undefined): Readonly<Record<string, unknown>> | undefined {
  if (part === undefined) return undefined;
  const copy: Record<string, unknown> = { ...part };
  return structuredClone(copy);
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
    this.#body = frozen(sent.body);
    this.#query = frozen(sent.query);
  }

  /** A copy of the request this page was fetched with (changing it changes nothing). */
  get sent(): SentPage {
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
  nextInput(cursor: string, rows: number, limit?: number): SentPage {
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
  nextPageNumber(page: number): SentPage {
    return this.#with({ page: page + 1 }, 'query');
  }

  #with(changes: Readonly<Record<string, unknown>>, into: 'body' | 'query'): SentPage {
    const { body, query } = this.sent;
    return into === 'query' ? { body, query: { ...query, ...changes } } : { body: { ...body, ...changes }, query };
  }
}

/**
 * The first page of a walk that wants at most `maxResults` rows. A cursor walk asks page 1
 * for no more rows than are wanted; a page-numbered walk has a fixed page size.
 */
export function start(paging: Paging, sent: PageInput, maxResults: number | undefined): Pager {
  if (paging.style === 'page_number' || maxResults === undefined) return new Pager(paging, sent);
  const inBody = paging.cursorIn !== 'query';
  const into = frozen(inBody ? sent.body : sent.query);
  const limit = firstLimit(typeof into?.['limit'] === 'number' ? into['limit'] : undefined, maxResults);
  if (limit === undefined) return new Pager(paging, sent);
  const changed = { ...into, limit };
  return new Pager(paging, inBody ? { body: changed, query: sent.query } : { body: sent.body, query: changed });
}

/**
 * The page after `page` (fetched with `pager`), or `undefined` when the walk is over. A
 * cursor walk goes on while the answer holds a `next_cursor`, whatever the page's size (a
 * short page is normal: Do-Not-Contact rules remove rows after the page is cut); a
 * page-numbered walk goes on while `has_more` says so.
 */
export function follow(pager: Pager, page: unknown, maxResults: number | undefined): Pager | undefined {
  if (!isRecord(page)) return undefined;
  const items = page[pager.paging.items];
  const rows = Array.isArray(items) ? items.length : 0;
  const seen = pager.offset + rows;
  if (maxResults !== undefined && seen >= maxResults) return undefined;
  if (pager.paging.style === 'page_number') {
    const number = page['page'];
    return page['has_more'] === true && typeof number === 'number' ? new Pager(pager.paging, pager.nextPageNumber(number), seen) : undefined;
  }
  const cursor = page['next_cursor'];
  if (typeof cursor !== 'string' || cursor === '') return undefined;
  return new Pager(pager.paging, pager.nextInput(cursor, rows, nextLimit(pager.pageSize, seen, maxResults)), seen);
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

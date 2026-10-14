/**
 * The one page iterator behind every `*Pages` method (contract 02 §6).
 *
 * - The params are deep-copied once, before the first request, and that copy
 *   is re-sent on every page: the server signs each cursor against the
 *   request, so a caller editing their own object mid-iteration cannot break
 *   page two.
 * - Only `cursor` and `limit` change between pages. The cursor's fingerprint
 *   excludes `limit`, so `options.limit` may resize pages after the first.
 * - `options.maxResults` stops the iteration once that many rows have been
 *   yielded, without fetching a page nobody reads.
 * - At the server's 10,000-row depth cap the iteration stops, with one
 *   process warning, instead of asking for a page the server would refuse.
 * - A page whose `degradation` holds `pagination_truncated` means the server
 *   stopped paging before the results ran out; the iteration warns once.
 * - The per-call options carry to every page, except the caller's request id
 *   (`requestId`, or a raw `X-Request-Id` header): it goes with the first page
 *   only, because every request needs its own.
 */

import { DEFAULT_PAGE_SIZE, HEADER_REQUEST_ID, MAX_PAGINATION_DEPTH } from './constants';
import { hasPaginationTruncated } from './envelope';
import type { RequestOptions } from './http';
import { warnOnce } from './runtime';
import { ensure } from './validate';

/** Options for the `*Pages` iterators: the per-call options, plus paging controls. */
export interface PageOptions extends RequestOptions {
  /**
   * Page size from the second page on; the first page uses `params.limit`.
   * The one field besides `cursor` that may change between pages.
   */
  limit?: number;
  /**
   * Stop after this many rows. The page that reaches the count is cut to
   * fit, and no further page is fetched.
   */
  maxResults?: number;
}

/** How the iterator reads one page type. */
export interface PageShape<Page> {
  rows(page: Page): readonly unknown[];
  /** `page` with its rows replaced — used to cut the last page to `maxResults`. */
  withRows(page: Page, rows: unknown[]): Page;
  nextCursor(page: Page): string | undefined;
  degradation(page: Page): unknown;
}

/** The fields of the standard envelope the iterator reads. */
interface PagedEnvelope {
  results: unknown[];
  next_cursor: string | null;
  degradation: unknown;
}

/** The shape of every standard envelope (`results` plus `next_cursor`). */
export function envelopeShape<Page extends PagedEnvelope>(): PageShape<Page> {
  return {
    rows: (page) => page.results,
    withRows: (page, rows) => ({ ...page, results: rows }),
    nextCursor: (page) => page.next_cursor ?? undefined,
    degradation: (page) => page.degradation,
  };
}

/**
 * The options for every page after the first: the caller's, without their
 * request id. One id names one request; resending it would make every page
 * look like the first in the caller's logs and the server's.
 */
export function laterPageOptions(options: RequestOptions): RequestOptions {
  const { requestId: _requestId, headers, ...rest } = options;
  if (headers === undefined) return rest;
  const kept = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() !== HEADER_REQUEST_ID.toLowerCase(),
  );
  return { ...rest, headers: Object.fromEntries(kept) };
}

/**
 * Yield pages from `fetchPage` — one of the client's single-page methods —
 * following the cursor until the results run out, `maxResults` is reached,
 * or the depth cap is.
 *
 * With `maxResults`, no page asks for more rows than are still wanted. Search is
 * billed per result delivered, so a full-size last page would pay for rows that
 * are then sliced away.
 */
export async function* paginate<P extends { cursor?: string; limit?: number }, Page>(
  fetchPage: (params: P, options: RequestOptions) => Promise<Page>,
  params: P,
  pageOptions: PageOptions | undefined,
  shape: PageShape<Page>,
): AsyncGenerator<Page, void, undefined> {
  const { limit, maxResults, ...options } = pageOptions ?? {};
  if (maxResults !== undefined) {
    ensure(
      Number.isInteger(maxResults) && maxResults >= 1,
      `\`maxResults\` must be a positive integer (got ${maxResults})`,
    );
  }
  const frozen = structuredClone(params);
  const later = laterPageOptions(options);
  let cursor = frozen.cursor;
  let seen = 0;

  for (let first = true; ; first = false) {
    const remaining = maxResults === undefined ? Infinity : maxResults - seen;
    const pageSize = (first ? frozen.limit : (limit ?? frozen.limit)) ?? DEFAULT_PAGE_SIZE;
    // With `maxResults`, every page states its size, trimmed to what is still
    // wanted, rather than leaning on the server's default: rows are billed per
    // result delivered, and a page larger than the rows still wanted pays for
    // rows this loop throws away. Without it, the caller's own sizes stand.
    const pageLimit =
      maxResults !== undefined ? Math.min(pageSize, remaining) : first ? undefined : limit;
    const request: P = pageLimit === undefined ? { ...frozen, cursor } : { ...frozen, cursor, limit: pageLimit };
    let page: Page = await fetchPage(request, first ? options : later);
    const rows = shape.rows(page);
    if (rows.length > remaining) page = shape.withRows(page, rows.slice(0, remaining));
    seen += Math.min(rows.length, remaining);

    if (hasPaginationTruncated(shape.degradation(page))) {
      warnOnce(
        'SPROUTSDATA_TRUNCATED',
        'The server stopped paging before the results ran out (degradation ' +
          '`pagination_truncated`), so the last page is not the end of the matches. ' +
          'Narrow the search to reach the rest.',
      );
    }
    yield page;

    cursor = shape.nextCursor(page);
    if (cursor === undefined || seen >= (maxResults ?? Infinity)) return;
    if (seen >= MAX_PAGINATION_DEPTH) {
      warnOnce(
        'SPROUTSDATA_DEPTH_CAP',
        `Stopped paging at ${MAX_PAGINATION_DEPTH.toLocaleString('en-US')} results, the ` +
          "server's pagination depth cap; more matches exist. Narrow the search to reach them.",
      );
      return;
    }
  }
}

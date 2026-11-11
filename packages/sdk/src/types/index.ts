/**
 * The public type names: every type the spec defines (generated, `generated/wire.ts`), and the
 * few the SDK adds, the parameters of its methods. Request shapes come from the spec alone;
 * a parameter type only picks, renames or makes optional what the spec says.
 */

import type * as W from '../generated/wire.js';

export type * from '../generated/wire.js';
export type { RateLimitInfo } from './rate-limit.js';

/** A company or person search. `category` defaults to `company`. */
export type EntitySearchParams = Omit<W.EntitySearchRequest, 'category'> & { readonly category?: 'company' | 'person' };

/** A search with the category left to the question: `query` and paging only, `auto` mode. */
export type AutoSearchParams = W.AutoSearchRequest & { readonly category: 'auto' };

/** A document category's search: its own `filters` and `sort`, typed per category. */
export type DocumentSearchParams =
  | W.PatentSearchRequest
  | W.AcademicReportSearchRequest
  | W.NewsSearchRequest
  | W.MarketReportSearchRequest
  | W.TrendSearchRequest
  | W.FundingSearchRequest
  | W.JobOpeningSearchRequest;

/** What `search` takes: the body of `POST /v1/search`, with `category` defaulting to `company`. */
export type SearchParams = EntitySearchParams | AutoSearchParams | DocumentSearchParams;

/** How far a walk over pages goes. */
export interface PageOptions {
  /** Stop after this many rows (the last page asks only for the rows still wanted). */
  readonly maxResults?: number;
}

/** What `iterSearch` takes: `search`'s parameters with no cursor (the walk follows it), and how far to go. */
export type IterSearchParams = DistributiveOmit<SearchParams, 'cursor'> & PageOptions;

/** A look-alike company: a domain as a bare string, or an anchor. */
export type AnchorParam = string | W.Anchor;

/** What `similar` takes: the body of `POST /v1/similar`, with bare-string anchors allowed. */
export type SimilarParams = Omit<W.SimilarRequest, 'anchors'> & { readonly anchors: readonly AnchorParam[] };

/** What `iterSimilar` takes. */
export type IterSimilarParams = Omit<SimilarParams, 'cursor'> & PageOptions;

/** One page of a filter's values. */
export interface FilterValuesParams {
  /** Only values containing this, ignoring case (1 to 200 characters). */
  readonly search?: string;
  /** The page, from 1. */
  readonly page?: number;
  /** One parent's children, for the two-level filters (`industry`). */
  readonly parent?: string;
  /** One level of a two-level filter. */
  readonly level?: W.FilterLevelInput;
}

/** One page of a document filter's values. */
export type DocumentFilterValuesParams = Pick<FilterValuesParams, 'search' | 'page'>;

/** Which coverage to report. */
export interface CoverageParams {
  readonly category?: W.ResultCategoryInput;
  readonly segment?: W.CoverageSegmentNameInput;
}

/** Fields to keep in each record, applied by the SDK (company and person lookups take none). */
export interface ProjectionParams {
  /** Only these fields of each record, and its `id`. */
  readonly fields?: readonly string[];
}

/** A company lookup. `by` defaults to `auto`; `null` sends none (prism ids). */
export type CompanyLookupParams = Omit<W.CompanyLookup, 'by'> & ProjectionParams & { readonly by?: W.CompanyBy | null };

/** A person lookup. `by` defaults to `auto`; `null` sends none (prism ids). */
export type PersonLookupParams = Omit<W.PersonLookup, 'by'> & ProjectionParams & { readonly by?: W.PersonBy | null };

/** What `runs.create` takes: the body of `POST /v1/agents/runs`. */
export type RunCreateParams = W.RunRequest;

/** A page of a cursor-paged list. */
export interface PageParams {
  /** Rows per page, 1 to 100. */
  readonly limit?: number;
  /** `next_cursor` of the previous page. */
  readonly cursor?: string;
}

/** How a `wait` polls, and gives up. */
export interface WaitOptions {
  /** Milliseconds before the second poll; each later wait is half again longer, to 15 s. */
  readonly pollIntervalMs?: number;
  /** Give up after this long (default 900,000 ms); `null` waits for as long as it takes. */
  readonly maxWaitMs?: number | null;
}

/** How to fetch a search row again with `client.entities`: pass `ids: [value]`, and `by` when set. */
export interface LookupRef {
  readonly category: W.ResultCategory;
  /** `undefined`: the category's lookup takes ids only (patents, trends, academic reports). */
  readonly by: 'domain' | 'li_url' | 'id' | undefined;
  readonly value: string;
}

/** `Omit` over each member of a union. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

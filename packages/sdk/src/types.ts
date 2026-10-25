/**
 * Request and response types for the Sprouts Data v1 API.
 *
 * These mirror `dsp-backend`'s public contract (`app/schemas/*`); the entity
 * records are generated from the vendored OpenAPI document (`records.ts`).
 * The enums are closed sets on the server: adding a member there is a
 * deliberate, announced change, so string-literal unions here are safe to
 * switch on.
 */

import type { DiscoverFilters, FilterName } from './filters';

/**
 * How hard the server works on the query.
 *
 * - `fast` — match my words. Lexical, no LLM in the path.
 * - `auto` — understand my intent. The parser extracts filters.
 * - `deep` — reason about it. Exhaustive, coverage-measured, and always a
 *   single page: `deep` never paginates (`next_cursor` is null and `coverage`
 *   says what the page represents) and rejects `cursor`.
 */
export type SearchMode = 'fast' | 'auto' | 'deep';

/**
 * What to search, and what a returned row is.
 *
 * `company` and `person` are the GTM entity index; the rest are document
 * corpora. `job_opening` is a document too, but its rows carry the posting
 * company's domain, so it is the one document category that accepts
 * `include_domains` / `exclude_domains`.
 */
export type EntityCategory =
  | 'company'
  | 'person'
  | 'patent'
  | 'news_article'
  | 'trend'
  | 'market_report'
  | 'funding_round'
  | 'academic_report'
  | 'job_opening';

/** The seven document corpora — every {@link EntityCategory} except `company` and `person`. */
export type DocumentCategory = Exclude<EntityCategory, 'company' | 'person'>;

/** Which index answered. `live` keys and `test` keys never mix. */
export type SproutsDataEnvironment = 'live' | 'test';

export type SimilarAnchorBy = 'domain' | 'li_url' | 'name';
export type SimilarCombine = 'and' | 'or';
export type UsageGranularity = 'hour' | 'day' | 'month' | 'total';

export type SortDirection = 'asc' | 'desc';

/**
 * Every field a `company` or `person` search can be ordered by. Not every
 * value is legal on both axes — `revenue` is company-only, `tenure` is
 * person-only, `city` is both — and the server refuses the wrong pairing with
 * a 422 that points at `GET /v1/sorts/{category}`. Ask `client.sorts(category)`
 * for the live catalogue rather than building a picker from this union.
 */
export type DiscoverSortField =
  // Identity
  | 'account_name'
  | 'contact_name'
  | 'domain'
  // Company size and age
  | 'revenue'
  | 'employee_count'
  | 'founded_year'
  | 'linkedin_followers'
  // Company funding
  | 'total_funding'
  | 'last_funding_amount'
  | 'last_funding_date'
  | 'funding_stage'
  // Company classification
  | 'industry'
  | 'primary_industry'
  | 'sub_industry'
  // Geography — both axes
  | 'city'
  | 'state'
  | 'country'
  | 'region'
  // Company only: how many countries it employs people in
  | 'global_presence'
  // Person
  | 'job_title'
  | 'department'
  | 'division'
  | 'employment_type'
  | 'linkedin_connections'
  | 'tenure'
  // Person only: orders on the seniority ladder, not alphabetically
  | 'seniority';

/** One level of an ordering. */
export interface SortClause {
  /**
   * A {@link DiscoverSortField} for `company` / `person`; document categories
   * carry their own sort names (any string, 1–64 characters), which
   * `client.sorts(category)` lists.
   */
  field: DiscoverSortField | (string & {});
  /** Defaults to `desc` on the server. */
  direction?: SortDirection;
}

/** The `POST /v1/search` fields shared by every category. */
interface SearchParamsBase {
  /** Free-text query. */
  query?: string;
  /**
   * Defaults to `fast` on the server. `deep` returns one page with no cursor
   * and takes no `filters`, `sort` or domain restrictions (the SDK refuses
   * them: the server would ignore them on a billed call).
   */
  mode?: SearchMode;
  /** `company`, `person`, and `job_opening` only. */
  include_domains?: string[];
  /** `company`, `person`, and `job_opening` only. */
  exclude_domains?: string[];
  /**
   * How to order the results, strongest key first. Omit it for the engine's
   * own ordering (relevance when there is a query, a quality ranking when
   * there is not). The sortable fields differ per category, so it does not
   * combine with `category: 'auto'`. `client.sorts(category)` lists them.
   */
  sort?: SortClause[];
  /** Page size. Defaults to 10 on the server. */
  limit?: number;
  /**
   * Opaque signed cursor from a previous page's `next_cursor`. Every other
   * parameter (except `limit`) must be identical across pages, or the server
   * rejects the cursor rather than silently reshuffling results. Not
   * applicable under `mode: 'deep'`, which returns a single page.
   */
  cursor?: string;
}

/**
 * Keyword search over company text, as a tree: a keyword, or a one-key node
 * — `{ and: [...] }` (every branch), `{ or: [...] }` (at least one) or
 * `{ not: node }` — nested up to six deep, with at most 100 keywords of at
 * most 100 characters each. The server checks the tree and names the bad
 * node in its 422.
 *
 * ```ts
 * { and: ['payments', { or: ['stripe', 'adyen'] }, { not: 'crypto' }] }
 * ```
 */
export type KeywordQuery =
  | string
  | { and: KeywordQuery[] }
  | { or: KeywordQuery[] }
  | { not: KeywordQuery };

/**
 * A `company` or `person` search, or one the server classifies.
 */
export interface DiscoverSearchParams extends SearchParamsBase {
  /**
   * Defaults to `company`. `auto` asks the server to classify the query: the
   * SDK then sends no `category` at all, and the server decides what else
   * that request may carry (today: `query` only, with `mode: 'auto'`) and
   * names the field it refuses.
   */
  category?: 'company' | 'person' | 'auto';
  /**
   * The typed discover vocabulary. A misspelt filter name is a compile
   * error here and a 422 naming the field on the server. Domain restrictions
   * alongside a `company` filter are refused server-side — they express the
   * same idea twice.
   */
  filters?: DiscoverFilters;
  /**
   * Keyword search over company text — see {@link KeywordQuery}. `company`
   * only (the default category); never alongside `query`, never with
   * `mode: 'deep'`. Combines with `filters`, domain lists and `sort`, and is
   * billed as a `fast` search whatever the mode. Rolling out: a deployment
   * that does not have it yet answers 422 for the field.
   */
  keyword_query?: KeywordQuery;
}

/** A search over one of the document corpora. */
export interface DocumentSearchParams extends SearchParamsBase {
  category: DocumentCategory;
  /**
   * That vertical's own filters, free-form — `documentFilterValues` lists
   * each one's values, and the server names an unknown one.
   */
  filters?: Record<string, unknown>;
}

/**
 * Body for `POST /v1/search`. Provide `query`, `filters`, or both. `filters`
 * is typed by `category`: {@link DiscoverFilters} for `company` / `person`,
 * free-form for the document corpora.
 */
export type SearchParams = DiscoverSearchParams | DocumentSearchParams;

/** One anchor for look-alike search. */
export interface SimilarAnchor {
  /** The company's name, domain, or LinkedIn URL. */
  value: string;
  /** How to interpret `value`. Defaults to `domain` on the server. */
  by?: SimilarAnchorBy;
  /**
   * Relative influence of this anchor, from 0 (ignore) to 1 (full).
   * `combine: "and"` averages into one centroid; `combine: "or"` uses this as
   * a per-anchor boost.
   */
  weight?: number;
}

/** Body for `POST /v1/similar`. Look-alike search is company-only. */
export interface SimilarParams {
  /** The companies to find more like. At least one. */
  anchors: SimilarAnchor[];
  /**
   * `and` — look-alikes similar to all anchors together.
   * `or` — look-alikes similar to any one of them.
   * Defaults to `and` on the server.
   */
  combine?: SimilarCombine;
  /** `company`, the only category the API offers look-alikes for (and its default). */
  category?: 'company';
  /**
   * Narrow the look-alikes: anchors decide who is similar, filters decide
   * which of those come back. Typed-only here — no free-form dict, since
   * look-alike search is company/person vocabulary by construction.
   */
  filters?: DiscoverFilters;
  /** Page size. Defaults to 10 on the server. */
  limit?: number;
  /** Opaque signed cursor from a previous page's `next_cursor`. */
  cursor?: string;
}

/**
 * How to interpret `ids` on an entity lookup: as raw identifier values
 * instead of platform ids. `auto` classifies each entry independently (the
 * same detection `/v1/similar` applies to anchors); any other value forces
 * every entry to that one kind.
 */
export type EntitiesResolveBy = 'auto' | 'domain' | 'li_url' | 'name';

/** Body for `POST /v1/entities/companies`. */
export interface CompanyEntitiesParams {
  /**
   * Platform ids — or raw identifier values when `by` is set. Up to 1000
   * entries (50 with `by`). A search hit's `id` is not a platform id; pass
   * the hit to `lookupRef` for its domain (`by: 'domain'`) instead.
   */
  ids: string[];
  /** Restrict the returned fields. Omit for the full record. */
  fields?: string[];
  /** Omit for the default: `ids` are platform ids. */
  by?: EntitiesResolveBy;
}

/** Body for `POST /v1/entities/persons`. No `domain` — a person has none. */
export interface PersonEntitiesParams {
  /**
   * Platform ids — or raw identifier values when `by` is set. Up to 1000
   * entries (50 with `by`). A search hit's `id` is not a platform id; pass
   * the hit to `lookupRef` for its LinkedIn URL (`by: 'li_url'`) instead.
   */
  ids: string[];
  /** Restrict the returned fields. Omit for the full record. */
  fields?: string[];
  /** Omit for the default: `ids` are platform ids. */
  by?: Exclude<EntitiesResolveBy, 'domain'>;
}

/**
 * Body for `POST /v1/entities/{patents,trends,academic-reports}` — the three
 * document categories whose external identifier (a patent number, a trend
 * name, a DOI) already *is* the id. No `by`.
 */
export interface DocumentEntitiesParams {
  /** Platform ids. 1–100 entries — document records are large. */
  ids: string[];
  /** Restrict the returned fields. Omit for the full record. */
  fields?: string[];
}

/** How to interpret `ids` on the four named-document lookups. */
export type NamedDocumentLookupBy = 'id' | 'name';

/**
 * Body for `POST /v1/entities/{news,market-reports,fundings,job-openings}` —
 * the four document categories with an external name/title distinct from
 * their id (a headline, a report title, a job role, the company a funding
 * round belongs to).
 */
export interface NamedDocumentEntitiesParams {
  /**
   * Platform ids (`by: "id"`, 1–100 entries) or free-text names
   * (`by: "name"`, 1–50 entries — a name is not a unique key, so each entry
   * can resolve to several documents).
   */
  ids: string[];
  /** Restrict the returned fields. Omit for the full record. */
  fields?: string[];
  /**
   * The SDK defaults to `"id"` and always sends the field explicitly. (The
   * server's own default is `"name"`; the SDK pins `"id"` so that ids taken
   * from search results keep working unchanged.)
   */
  by?: NamedDocumentLookupBy;
}

/**
 * One `/v1/entities/*` input and what it resolved to. A miss still appears
 * (`found: false`, `matches: []`) rather than being dropped, so you see exactly
 * which ids matched. Only records found are billed.
 */
export interface EntityHit<TMatch> {
  id: string;
  category: EntityCategory;
  found: boolean;
  /**
   * Always a list, never a bare object. `found: true` guarantees at least one
   * entry. Id-keyed lookups (companies, persons, patents, trends,
   * academic-reports, and any `by: "id"` lookup) have exactly one; only
   * news / market-reports / fundings / job-openings under `by: "name"` can
   * have more — best-match first, except job-openings (most-recent-first).
   */
  matches: TMatch[];
}

/**
 * The `/v1/entities/*` response: the standard envelope over one
 * {@link EntityHit} per requested id. Lookups are not paginated — `has_more`
 * is always false and `next_cursor` is always null.
 */
export type EntitiesEnvelope<TMatch> = Envelope<EntityHit<TMatch>>;

/** Query for `GET /v1/keys/usage`. */
export interface UsageParams {
  /** Bucket size. Defaults to `day` on the server. */
  granularity?: UsageGranularity;
  /** Period start (inclusive). Defaults to 30 days before `to`. */
  from?: Date | string;
  /** Period end. Defaults to now. */
  to?: Date | string;
}

/** Present on every 2xx response. */
export interface ResponseMeta {
  /** Echo of the server-assigned request id — quote it in support requests. */
  request_id: string;
  /** Echoed so a test-key result can never be mistaken for a live one. */
  environment: SproutsDataEnvironment;
  /** ISO 8601 timestamp the response was produced. */
  as_of: string;
  /**
   * Which credential produced this response. Through this SDK it is always
   * `api_key`; `session` marks dashboard-playground traffic.
   */
  credential: 'api_key' | 'session';
  /**
   * What this request cost, in credits to at most three decimals. `0` when it
   * cost nothing: rows this search already paid for (a cursor sent again, or
   * the same `Idempotency-Key` the same day), a search that found nothing, or a
   * test key. Absent or `null` on a free endpoint.
   */
  credits_charged?: number | null;
}

/** Where a response's content came from. Response-level in v1, not per-fact. */
export interface Attribution {
  source_corpus: string;
  domain: string | null;
  as_of: string | null;
  /** Reserved for per-fact citation. Always null in v1. */
  url: string | null;
  /** Reserved for per-fact citation. Always null in v1. */
  quote: string | null;
}

/**
 * What the server could not do for this request. An empty list means nothing
 * degraded — never "unknown". Check this before trusting recall-sensitive
 * results.
 */
export interface Degradation {
  /**
   * Server-owned vocabulary (open here so new reasons never break a switch).
   * The twelve reasons today: `vector_coverage_incomplete`,
   * `lexical_scoring_unavailable`, `corpus_unavailable`, `corpus_timeout`,
   * `field_not_indexed`, `mode_downgraded`, `billing_bypassed`,
   * `pagination_truncated`, `axis_not_applicable` (part of a relationship
   * question named something the affiliation graph does not carry),
   * `anchor_list_capped` (more anchors than the question shape holds),
   * `planner_step_incomplete`, and `upstream_advisory`.
   */
  reason: string;
  detail: string;
  impact: 'recall' | 'precision' | 'freshness' | 'fields';
  source_corpus: string | null;
}

/**
 * How much of the addressable set this answer represents.
 *
 * Null on the envelope means coverage was not measured for this request
 * (`fast` and `auto` do not enumerate) — never that coverage was zero.
 * Populated for `deep` searches and agent runs.
 */
export interface Coverage {
  /** Records matching the resolved query — counted, not sampled. */
  universe: number;
  /** False when the count hit a cap. */
  universe_is_exact: boolean;
  /** How many of them this answer carries. */
  enumerated: number;
  /**
   * `enumerated / universe`. Null when the universe was not exact. Measures
   * coverage of the *resolved query*, not of the user's intent — a wrong
   * predicate can be exhaustively enumerated.
   */
  enumeration_recall: number | null;
  /** Every matching record was returned and the count agrees. */
  universe_exhausted: boolean;
  /** Which limit stopped the enumeration short, when one did. */
  truncated_by: string | null;
  /**
   * Requirements the search could not express, in the caller's own words.
   * Non-empty means part of the question was not answered — and
   * `universe_exhausted` is withheld.
   */
  constraints_unmet: string[];
  /**
   * Whether the query was checked against the executed filter for dropped
   * requirements — an empty `constraints_unmet` only means something if
   * something looked.
   */
  audited: boolean;
  /**
   * Per criterion: evaluated, passed, success_rate, and whether it was
   * proven by the query or judged by a model. Server-owned shape.
   */
  criteria: Array<Record<string, unknown>>;
  /**
   * Narrowings done by ranking rather than by predicate (top-k concept
   * expansions). Non-empty withholds `universe_exhausted` on purpose.
   */
  similarity: Array<Record<string, unknown>>;
  /**
   * One entry per other dataset this answer joined against (`corpus`,
   * `join_key`, `observable`, `of_constrained`, `ratio`, `is_lower_bound`).
   */
  linkage: Array<Record<string, unknown>>;
  /**
   * The joins combined as a product, not a minimum. Null when no join was
   * performed or when any leg's coverage is unknown.
   */
  linkage_coverage: number | null;
  /** True when `linkage_coverage` is a floor rather than a measurement. */
  linkage_coverage_is_lower_bound: boolean;
}

/** What the server decided the request meant. Re-run it exactly with this. */
export interface ResolvedSearch {
  parser_version: string;
  mode: SearchMode;
  category: EntityCategory;
  query: string | null;
  filters: Record<string, unknown>;
  filters_source: 'caller' | 'parser' | 'caller+parser' | 'none';
  semantic_query: string | null;
  /**
   * The `keyword_query` tree the server ran, normalised (keywords trimmed,
   * inner spaces collapsed). Never repeated under `filters`. Absent when the
   * search had none.
   */
  keyword_query?: KeywordQuery | null;
  /**
   * The ordering that was applied, echoed so a picker can render its state
   * from the response. Empty means the engine chose the order itself — the
   * common case.
   */
  sort: Array<{ field: string; direction: string }>;
  conflicts: Array<Record<string, unknown>>;
  overrides: Array<Record<string, unknown>>;
}

/**
 * A better way to have asked this question. Advisory only: `results` came
 * from the search that was asked for, whatever this says.
 *
 * - `kind: 'search'` — a plain search still answers this, in a different
 *   `category` (named here; drop it straight into the next request).
 * - `kind: 'agentic'` — no single search answers this; it needs several steps
 *   or several corpora. `category` is null. Act on it with `client.agents`.
 *
 * Null when there is nothing worth suggesting, on every page after the first,
 * and whenever the request carried filters but no `query`.
 */
export interface SearchSuggestion {
  kind: 'search' | 'agentic';
  /** Set iff `kind` is `search`. */
  category: EntityCategory | null;
  /** One ready-to-show sentence. */
  message: string;
}

/**
 * One column of an answer table that carries values beyond the entity's own
 * fields. The value for each sits on every row in `results`, keyed by `name`.
 */
export interface EnvelopeColumn {
  name: string;
  description: string | null;
  /** Where the values come from. A plain string from a server that predates {@link ColumnSource}. */
  source: ColumnSource | string | null;
}

/** Where an answer-table column's values come from. */
export interface ColumnSource {
  /**
   * `index_field` — a field already on the row — or `corpus_join` — a field of
   * another corpus joined by the entity (a job posting's link, a patent's title).
   */
  kind: 'index_field' | 'corpus_join' | (string & {});
  /** For `corpus_join`: which corpus (`job_openings`, `news`, `patents`, …). */
  corpus?: string | null;
  /** The field read: a dotted path on the row, or a field of `corpus`. */
  field?: string | null;
}

/**
 * One search/similar result. `id`, `category`, and `score` are always present;
 * the remaining fields are the record's own data and vary by category.
 */
export interface SearchHit {
  id: string;
  category: EntityCategory;
  score: number | null;
  [field: string]: unknown;
}

/** The paginated v1 response envelope. */
export interface Envelope<TResult> {
  results: TResult[];
  total: number;
  /** When true, `total` is an estimate, not an exact count. */
  total_is_estimate: boolean;
  has_more: boolean;
  /**
   * Opaque and signed. Invariant: `has_more === (next_cursor !== null)`.
   * There is no page or offset parameter.
   */
  next_cursor: string | null;
  resolved_search: ResolvedSearch | null;
  /**
   * A better way to have asked — a different `category`, or an agent run.
   * Null when there is nothing worth suggesting, which is the common case.
   */
  suggestion: SearchSuggestion | null;
  /**
   * Measured recall, populated for `deep` searches and agent runs. Null means
   * coverage was not measured for this request — never that it was zero.
   */
  coverage: Coverage | null;
  attribution: Attribution[];
  degradation: Degradation[];
  /**
   * The answer table's extra columns, in order, when a run carries values
   * beyond the entity's own fields. Null means a plain entity table.
   */
  columns: EnvelopeColumn[] | null;
  /**
   * Set by the SDK: true when `degradation` holds `pagination_truncated` —
   * the server stopped paging before the results ran out, so `has_more:
   * false` does not mean complete. (`relationships.institutions` sets its
   * own `truncated`, meaning more institutions qualified than `limit`.)
   */
  truncated: boolean;
  /**
   * `meta.request_id` is the response's `X-Request-Id` header when there is
   * one, else the body's copy — the two agree whenever both are present.
   */
  meta: ResponseMeta;
}

export type SearchEnvelope = Envelope<SearchHit>;

/** One usage bucket. `action_type` is null for `granularity: "total"` rollups. */
export interface UsageBucket {
  period_start: string;
  action_type: string | null;
  requests: number;
  credits: number;
}

/** Response of `GET /v1/keys/usage` — spend for the calling key only. */
export interface UsageResponse {
  key_id: string;
  period_from: string;
  period_to: string;
  granularity: string;
  total_requests: number;
  /** What the key was charged, in credits to at most three decimals. */
  total_credits: number;
  buckets: UsageBucket[];
  meta: ResponseMeta;
}

/**
 * Where allocated credits came from. Each source has its own expiry:
 * `purchased` credits (a top-up's extra credits included) never expire;
 * `signup`, `referral` and `promo` credits expire after they are granted;
 * `other` is credits allocated by Sprouts.
 */
export type CreditSource = 'purchased' | 'signup' | 'referral' | 'promo' | 'other';

/** The unspent credits from one source. */
export interface CreditSourceBalance {
  source: CreditSource;
  remaining: number;
  /** The soonest expiry among this source's credits; null when none expires. */
  expires_at: string | null;
  never_expires: boolean;
}

/** Credits allocated to this platform. */
export interface AllocatedCredits {
  granted: number;
  remaining: number;
  reserved: number;
  /** The soonest expiry among the allocated credits. */
  expires_at: string | null;
  /**
   * `remaining` broken down by source, adding up to it; `reserved` is not split
   * by source. Absent or null from a backend that does not report it.
   */
  sources?: CreditSourceBalance[] | null;
}

/**
 * The tenant-wide pool. Reported so it can be seen, but **not spendable on this
 * platform** — the platform is hard-capped at its own allocation, so gate on
 * `spendable`, never on `allocated.remaining + shared.remaining`.
 */
export interface SharedCredits {
  remaining: number;
}

/**
 * Response of `GET /v1/credits` — the tenant's balance on this platform.
 *
 * Credit amounts are decimals with at most three places (a Basic search's
 * first ten results cost `0.5`). To add credit figures exactly, add them in
 * thousandths: `Math.round(credits * 1000)`.
 */
export interface CreditsResponse {
  platform: string;
  /**
   * `tenant_wide_fallback` means grants cannot yet be attributed to a
   * platform, so only `spendable` is answerable — `allocated` and `shared`
   * are null rather than filled with totals that are not this platform's to
   * report.
   */
  scope: 'platform' | 'tenant_wide_fallback';
  allocated: AllocatedCredits | null;
  shared: SharedCredits | null;
  /** What this tenant can spend on this platform right now. */
  spendable: number;
  as_of: string;
  meta: ResponseMeta;
}

/** Query for `GET /v1/coverage`. */
export interface CoverageParams {
  /** Restrict to one segment by name. */
  segment?: string;
  /** Restrict to one category. */
  category?: EntityCategory;
}

/** One corpus segment's counts and freshness. */
export interface CoverageSegment {
  name: string;
  category: EntityCategory;
  total: number;
  with_embeddings: number | null;
  with_domain: number | null;
  freshest: string | null;
  stalest: string | null;
}

/**
 * Response of `GET /v1/coverage` — what the index holds. Distinct from
 * {@link Coverage}, which is per-answer measured recall on the envelope.
 */
export interface CoverageResponse {
  segments: CoverageSegment[];
  /** What the platform knows it does not have. */
  not_in_index: string[];
  as_of: string | null;
  degradation: Degradation[];
  meta: ResponseMeta;
}

/** One rung of a two-level filter (`industry`, `sub_industry`, `department`). */
export type FilterValuesLevel = 'parents' | 'children';

/** Query for `GET /v1/search/filters/{name}`. */
export interface FilterValuesParams {
  /** Narrow the vocabulary, 1–200 characters. */
  search?: string;
  /** 1-based page. Page size is fixed at 20 by the server. */
  page?: number;
  /**
   * One parent's children, for the two-level filters (`industry`,
   * `sub_industry`, `department`) — how a tree picker fills a branch on
   * expand. Composes with `search` and `page`. Mutually exclusive with
   * `level`.
   */
  parent?: string;
  /**
   * `parents` or `children`. `parents` is a tree's first call, and
   * `department` needs it: its plain value list mixes both levels with
   * nothing marking which is which. Mutually exclusive with `parent`.
   */
  level?: FilterValuesLevel;
}

/** One vocabulary entry, for filters whose values are more than a name. */
export interface FilterValueItem {
  value: string;
  name: string | null;
  domain: string | null;
  id: string | null;
}

/** Response of `GET /v1/search/filters/{name}`. */
export interface FilterValuesResponse {
  filter: FilterName;
  /**
   * Empty for a filter with no fixed vocabulary — every range, and the
   * free-text and entity filters. That is an answer, not a failure: those
   * take values you supply.
   */
  values: string[];
  /** Matches for `search`, or the whole vocabulary without one. */
  total: number;
  page: number;
  /** Always 20 — fixed by the server, not a parameter. */
  page_size: number;
  has_more: boolean;
  /**
   * Aligned with `values`, for the filters that have more than a name.
   * Empty for the rest — read it when present, fall back to `values`.
   */
  items: FilterValueItem[];
  meta: ResponseMeta;
}

/** One sortable field, as `GET /v1/sorts/{category}` describes it. */
export interface SortFieldInfo {
  /** The value to send as `sort[].field`. */
  field: string;
  /** Display name. Matches the column's own label. */
  label: string;
  /** `number`, `date` or `text` — enough to choose a control. */
  kind: string;
  /** What the engine uses when the field is named without a direction. */
  default_direction: string;
  /** Always both, today. */
  directions: string[];
  /**
   * `company`, `person`, or both — populated for those two categories only.
   * Not advisory: a person-axis sort on a company search is refused.
   */
  applies_to: string[];
  /** What the field means, in words. Null where none is recorded. */
  definition: string | null;
  /**
   * What each direction means for this field, keyed by direction
   * (`{ asc: 'Shortest first', desc: 'Longest first' }`). Render these rather
   * than deriving words from `kind`.
   */
  direction_labels: Record<string, string>;
  /** `identity`, `location`, `professional`, `firmographic` or `funding`; null on a document category. */
  group: string | null;
}

/** Response of `GET /v1/sorts/{category}` — the live sort catalogue. Free. */
export interface SortCatalogResponse {
  category: EntityCategory;
  /**
   * Empty for a category that cannot be ordered explicitly. That is an
   * answer: the engine still orders the results, it just takes no
   * instruction.
   */
  sorts: SortFieldInfo[];
  directions: string[];
  total: number;
  meta: ResponseMeta;
}

/** Query for `GET /v1/search/filters/{category}/{name}` — no `parent` / `level`; document filters are flat. */
export type DocumentFilterValuesParams = Pick<FilterValuesParams, 'search' | 'page'>;

/** Response of `GET /v1/search/filters/{category}/{name}`. No `items`: document filters carry names only. */
export interface DocumentFilterValuesResponse {
  category: EntityCategory;
  /** The filter name, exactly as the search request spells it. */
  filter: string;
  /** Empty for a filter with no fixed vocabulary — an answer, not a failure. */
  values: string[];
  /** Matches for `search`, or the whole vocabulary without one. */
  total: number;
  page: number;
  /** Always 20 — fixed upstream, not a parameter. */
  page_size: number;
  has_more: boolean;
  meta: ResponseMeta;
}

/**
 * RFC 9457 Problem Details — the body of every non-2xx response
 * (`application/problem+json`).
 */
export interface Problem {
  /** Absolute URI for this error class (a real docs page). */
  type?: string;
  title?: string;
  status?: number;
  /** Machine-readable, closed set — see `ErrorCode`. */
  code?: string;
  detail?: string | null;
  instance?: string | null;
  /** The handle a support conversation starts from. */
  request_id?: string | null;
  /** Error-specific fields. */
  extra?: Record<string, unknown> | null;
}

export { ErrorCode } from './error-codes.gen';

/**
 * The discover filter vocabulary — `filters` for `company` and `person`
 * searches.
 *
 * Mirrors `dsp-backend`'s `app/schemas/filters.py` (itself a contract mirror
 * of prism's `DiscoverFilters`). Names match the wire exactly — a name that
 * reads oddly (`gov_nongov`) stays as it is rather than being prettied up into
 * something the server would reject.
 *
 * These are request-side shapes, so omissible fields are optional rather than
 * `T | null`. The server refuses unknown filter names and wrong shapes with a
 * 422 that names the offending field — the SDK does not re-validate contents.
 *
 * Which side a filter applies to is not encoded here: the server routes a
 * person-side filter through the parent/child join when the search targets
 * companies (and vice versa), so `seniority` is meaningful on a company
 * search. The one honest statement these types make is which filters exist.
 *
 * 2026-10: 54 enumerable names, `years_worked` the newest; `employment_status` was
 * removed server-side and is gone from these types. `prior_company`
 * was retired server-side in favour of `employment_history`; it stays
 * declared here, marked `@deprecated`, so existing code keeps compiling — but
 * the SDK refuses it before sending (`ClientValidationError`, naming
 * `employment_history`).
 */

/** Include / exclude over a term-like field. At least one value is required. */
export interface TermsFilter {
  /** At most 1000 entries. */
  include?: string[];
  /** At most 1000 entries. */
  exclude?: string[];
  /** True requires every `include` value (AND). Default false (OR). */
  match_all?: boolean;
  /**
   * The `include` values, one list per thing named: any value in a list
   * satisfies it, and `match_all` requires every list rather than every value.
   * A resolved `technology` filter comes back this way (a product under every
   * name the index stores it as), so sending it back keeps "both X and Y".
   */
  include_groups?: string[][];
}

/** Inclusive numeric range. Either bound may be omitted (half-open), not both. */
export interface RangeFilter {
  gte?: number;
  lte?: number;
}

/** Sugar for the common relative windows, as an alternative to gte/lte. */
export type DatePreset =
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'
  | 'last_6_months'
  | 'last_year'
  | 'last_3_years'
  | 'last_5_years';

/**
 * An inclusive date window, or a named relative preset — one or the other,
 * never both. Bounds accept ISO-8601 dates (`"2024-01-01"`) or Elasticsearch
 * date math (`"now-30d"`, `"now/M"`).
 */
export interface DateBound {
  gte?: string;
  lte?: string;
  preset?: DatePreset;
}

/**
 * Forced resolution mode for an {@link EntityRef}. Note `li`, not `li_url` —
 * the filter vocabulary and the entities API use different tokens for the
 * same idea, and this mirrors the wire.
 */
export type FilterResolveBy = 'name' | 'domain' | 'li' | 'id';

/** One reference to an entity that needs resolution before querying. */
export interface EntityRef {
  value: string;
  /** Force a resolution mode. When omitted the server classifies the token. */
  by?: FilterResolveBy;
}

/**
 * Include / exclude over entities resolved from names, domains or ids.
 * At least one entry is required.
 */
export interface EntityFilter {
  /** At most 1000 entries. */
  include?: EntityRef[];
  /** At most 1000 entries. */
  exclude?: EntityRef[];
}

/**
 * Free-text field match with an exact-match escape hatch. At least one value
 * is required.
 */
export interface TextFilter {
  /** At most 1000 entries. */
  include?: string[];
  /** At most 1000 entries. */
  exclude?: string[];
  /**
   * False (default) runs an analyzed phrase match. True targets the keyword
   * subfield instead — use it when you have a canonical string and want no
   * analysis.
   */
  exact?: boolean;
}

export type GeoLevel = 'country' | 'state' | 'city' | 'region';

/**
 * Whose location a place constrains. `subject` (default) is whatever record
 * type is being searched; `company`/`person` force that side regardless of the
 * search target, which is what lets a contact search constrain the parent
 * company's HQ.
 */
export type GeoScope = 'subject' | 'company' | 'person';

/** One place, pinned to a level and optionally to an entity side. */
export interface GeoPlace {
  value: string;
  /**
   * Required: there is no place-name → level resolver on the request path, so
   * `berlin` is only a city because you said so.
   */
  level: GeoLevel;
  scope?: GeoScope;
  /** Exclude this place instead of requiring it. */
  negate?: boolean;
}

/** Unified geography — one filter for country, state, city and region. */
export interface GeoFilter {
  /** 1–1000 places. */
  places: GeoPlace[];
}

/** One department's headcount bound; at least one of `min`/`max`. */
export interface DepartmentHeadcountBound {
  department: string;
  min?: number;
  max?: number;
}

/** Per-department headcount bounds. Every bound must be satisfied (AND). */
export interface DepartmentHeadcountFilter {
  /** 1–1000 bounds. */
  bounds: DepartmentHeadcountBound[];
}

/**
 * Country-footprint filter. With `min_countries` set, matches companies
 * present in at least that many countries, where "present" means a
 * per-country headcount of at least `gte` (default 1). At least one field is
 * required.
 */
export interface GlobalPresenceFilter {
  /**
   * Where the company has people: countries (names or ISO3 codes) or regions
   * (`EU`, `APAC`, `Nordics`, `DACH`, `LATAM`, …), any member country of which
   * satisfies a region.
   */
  countries?: string[];
  /** People in every place named, not any one. Default false. */
  match_all?: boolean;
  /** Per-country headcount floor. */
  gte?: number;
  lte?: number;
  min_countries?: number;
}

export type KeywordTargetField = 'name' | 'keywords' | 'description';

/**
 * Multi-field keyword match over company name / keywords / description.
 * `target_fields` is required with at least one field — with an empty list
 * the server-side builder would produce no clause at all, so the filter would
 * read as applied while matching everything.
 */
export interface CompanyKeywordsFilter {
  /** At most 1000 entries. */
  include?: string[];
  /** At most 1000 entries. */
  exclude?: string[];
  match_all?: boolean;
  /** Which company fields to search. At least one is required. */
  target_fields: KeywordTargetField[];
}

/**
 * One job in a person's employment history — a company, a title, when the
 * role started or ended, how long it lasted. Every field is optional, but at
 * least one must be set. A group is matched against a single history entry
 * server-side, so two groups mean two different jobs, not one job read twice.
 */
export interface EmploymentHistoryGroup {
  /** The employer, resolved from names, domains or ids. */
  company?: EntityFilter;
  /** Titles held in that role. */
  title?: TermsFilter;
  /** When the role began. */
  role_started?: DateBound;
  /** When it ended. */
  role_ended?: DateBound;
  /** Minimum tenure in that role, in years. */
  tenure_gte?: number;
  /** Maximum tenure in that role, in years. */
  tenure_lte?: number;
}

/**
 * Employment-history filter (filters v3). Replaces the retired
 * `prior_company`: `{ groups: [{ company: { include: [...] } }] }` is
 * "worked at any of these" — `include` is OR within one group, and several
 * groups are several distinct jobs.
 */
export interface EmploymentHistoryFilter {
  /** 1–1000 groups. */
  groups: EmploymentHistoryGroup[];
}

/**
 * Every filter accepted for `category: company` and `category: person`.
 * When provided, at least one filter must be set.
 */
export interface DiscoverFilters {
  // --- shared ---
  geo?: GeoFilter;

  // --- company: classification ---
  industry?: TermsFilter;
  sub_industry?: TermsFilter;
  /**
   * Whether the company sells to businesses, consumers, or both.
   * `filterValues('b2b_b2c')` lists the values.
   */
  b2b_b2c?: TermsFilter;
  product_service?: TermsFilter;
  naics?: TermsFilter;
  sic?: TermsFilter;
  profit_nonprofit?: TermsFilter;
  gov_nongov?: TermsFilter;
  industries_served?: TermsFilter;

  // --- company: size + age ---
  employee_count?: RangeFilter;
  revenue?: RangeFilter;
  founded_year?: RangeFilter;
  linkedin_followers?: RangeFilter;
  global_presence?: GlobalPresenceFilter;
  employee_by_department?: DepartmentHeadcountFilter;

  // --- company: identity + structure ---
  company?: EntityFilter;
  owned_by_organization?: EntityFilter;
  is_subsidiary?: TermsFilter;
  domain_presence?: TermsFilter;
  linkedin_presence?: TermsFilter;
  /** `public`, `private` or `delisted`, from a company's IPO record. */
  listing_status?: TermsFilter;
  /** The exchange a listed company trades on (`NASDAQ`, `NYSE`, ...). */
  stock_exchange?: TermsFilter;

  // --- company: signals ---
  technology?: TermsFilter;
  company_keyword?: TermsFilter;
  keywords?: CompanyKeywordsFilter;

  // --- company: funding ---
  funding_stage?: TermsFilter;
  investors?: EntityFilter;
  total_funding?: RangeFilter;
  last_funding_amount?: RangeFilter;
  last_funding_date?: DateBound;

  // --- company: hiring ---
  hiring_role?: TextFilter;
  hiring_type?: TermsFilter;
  hiring_location?: TermsFilter;
  hiring_recency?: DateBound;

  // --- person ---
  seniority?: TermsFilter;
  /** Founder, Co Founder, Owner, Partner, Board Member, Investor, Advisor — orthogonal to seniority. */
  governance_level?: TermsFilter;
  /** Full Time, Part Time, Freelancer, Contractor, Consultant (External). */
  employment_type?: TermsFilter;
  /** Whether the person is marked as having direct access to the C-suite. */
  has_direct_access_to_c_suite?: TermsFilter;
  department?: TermsFilter;
  title?: TextFilter;
  person?: TextFilter;
  skills?: TermsFilter;
  certifications?: TermsFilter;
  /**
   * Past jobs — employer, title, dates, tenure — one group per job.
   * Replaces `prior_company`.
   */
  employment_history?: EmploymentHistoryFilter;
  /**
   * @deprecated Retired server-side (filters v3, 2026-09); the SDK refuses it
   * before sending (`ClientValidationError`). Use `employment_history` with
   * one group:
   * `{ groups: [{ company: { include: [...] } }] }`.
   */
  prior_company?: EntityFilter;
  university?: TermsFilter;
  degree?: TermsFilter;
  tenure?: RangeFilter;
  /**
   * Whole years since the person's earliest job began, across all jobs.
   * Time in the current role is `tenure`.
   */
  years_worked?: RangeFilter;
  last_job_changed?: DateBound;
  linkedin_connections?: RangeFilter;
}

/**
 * Filter names whose values can be looked up with
 * `GET /v1/search/filters/{name}` — every {@link DiscoverFilters} field
 * except `geo`, plus the four per-level geo names. `geo` spans all four levels
 * and has no value list of its own; each geo answer belongs in
 * `geo.places[].value` with the matching `level`.
 */
export type FilterName =
  // --- geography (per level — `geo` itself is not enumerable) ---
  | 'country'
  | 'state'
  | 'city'
  | 'region'
  // --- company: classification ---
  | 'industry'
  | 'sub_industry'
  | 'b2b_b2c'
  | 'product_service'
  | 'naics'
  | 'sic'
  | 'profit_nonprofit'
  | 'gov_nongov'
  | 'industries_served'
  // --- company: size + age ---
  | 'employee_count'
  | 'revenue'
  | 'founded_year'
  | 'linkedin_followers'
  | 'global_presence'
  | 'employee_by_department'
  // --- company: identity + structure ---
  | 'company'
  | 'owned_by_organization'
  | 'is_subsidiary'
  | 'domain_presence'
  | 'linkedin_presence'
  | 'listing_status'
  | 'stock_exchange'
  // --- company: signals ---
  | 'technology'
  | 'company_keyword'
  | 'keywords'
  // --- company: funding ---
  | 'funding_stage'
  | 'investors'
  | 'total_funding'
  | 'last_funding_amount'
  | 'last_funding_date'
  // --- company: hiring ---
  | 'hiring_role'
  | 'hiring_type'
  | 'hiring_location'
  | 'hiring_recency'
  // --- person ---
  | 'seniority'
  | 'governance_level'
  | 'employment_type'
  | 'has_direct_access_to_c_suite'
  | 'department'
  | 'title'
  | 'person'
  | 'skills'
  | 'certifications'
  | 'employment_history'
  // Deprecated: retired server-side in favour of `employment_history`; kept
  // so existing code compiles. `filterValues` refuses it before sending.
  | 'prior_company'
  | 'university'
  | 'degree'
  | 'tenure'
  | 'years_worked'
  | 'last_job_changed'
  | 'linkedin_connections';

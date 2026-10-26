/**
 * The `/v1/org-chart*` surface: one company's people, counted by department
 * and seniority, with each department's sub-departments, and by location.
 *
 * **One Platform's org chart, mirrored.** Taxonomy values come back as
 * `{ code, label }` — send the `code` back, show the `label` — and each axis
 * ends with an explicit Unknown (`code: 'unknown'`). Each person is counted
 * once, at their most senior level, and in every department they hold.
 *
 * **A matrix, not a tree.** The corpus carries no reporting lines, so what
 * these routes count is people grouped by closed vocabularies — there is no
 * manager anywhere in the answer. None of the three responses is an
 * `Envelope`: a grid is one aggregation with nothing to page. All three are
 * billed (`dsp.org_chart`) and require `dsp.search.read`.
 */

import type { RequestOptions } from './http';
import { APIResource } from './resource';
import type { Attribution, Degradation, ResponseMeta } from './types';
import { compact, ensure } from './validate';

/** The code of the explicit Unknown row, column and place. Not a filter value. */
export const UNKNOWN_CODE = 'unknown';

/** Founders, owners, board members and advisors — orthogonal to seniority. Codes on the wire. */
export type OrgChartGovernanceLevel =
  | 'founder'
  | 'co_founder'
  | 'owner'
  | 'partner'
  | 'board_member'
  | 'investor'
  | 'advisor';

/** How someone is engaged, not how senior they are. Codes on the wire. */
export type OrgChartEmploymentType =
  | 'full_time'
  | 'part_time'
  | 'freelancer'
  | 'contractor'
  | 'consultant';

/** The per-cell badges `retrieve()` can compute. */
export type OrgChartMetric = 'new_joiners' | 'job_openings';

/** A place's level. `region` is a group of countries, e.g. `emea`, `dach`, `north america`. */
export type OrgChartPlaceLevel = 'country' | 'state' | 'city' | 'region';

/**
 * A place to keep or drop people by. A country is a name, alias or ISO code
 * (an unknown one is a 422); send a state or city as `locations()` lists it —
 * a node's `level` and `value` go straight back as a place.
 */
export interface OrgChartPlace {
  level: OrgChartPlaceLevel;
  value: string;
}

/**
 * Which company — by `domain` or `linkedin_url`, exactly one. Most companies
 * in the index carry no domain, which is what the LinkedIn form is for. A
 * pasted URL is reduced to its host server-side; a personal profile or a
 * `/school/` page is refused.
 */
export interface OrgChartIdentifier {
  /** The company's domain, e.g. `stripe.com`. */
  domain?: string;
  /**
   * The company's LinkedIn page, e.g. `linkedin.com/company/stripe` — a
   * company page, not a person's profile or a school's.
   */
  linkedin_url?: string;
}

/**
 * Which of the company's people to count. Every filter narrows the population
 * before counting, so it changes the counts rather than hiding rows. Filters
 * combine with AND; values inside one with OR. Vocabularies and limits are
 * the server's, whose 422 names the field.
 */
export interface OrgChartFilters {
  /** Places to keep (`include`) or drop (`exclude`), up to 10 each. */
  locations?: { include?: OrgChartPlace[]; exclude?: OrgChartPlace[] };
  governance_levels?: OrgChartGovernanceLevel[];
  employment_types?: OrgChartEmploymentType[];
  /**
   * `true` keeps only people with direct access to the C-Suite, `false` only
   * those without, and omitting it filters on neither.
   */
  c_suite_access?: boolean;
  /** Up to 20 titles. */
  job_titles?: string[];
  /** A search inside the company's people; the response's `matched` says what it matched. */
  text?: string;
  /** What `text` matches — `auto` by default. Needs `text`. */
  search_mode?: 'auto' | 'name' | 'linkedin' | 'job_title';
}

/** Body for `POST /v1/org-chart`. */
export interface OrgChartParams extends OrgChartIdentifier {
  filters?: OrgChartFilters;
  /** The cell badges to compute. Both by default; `[]` answers fastest. */
  metrics?: OrgChartMetric[];
  /** Also count profiles flagged as suspect. Off by default; `suspect_count` says how many were left out. */
  include_suspects?: boolean;
}

/** Body for `POST /v1/org-chart/departments`. */
export interface OrgChartDepartmentsParams extends OrgChartIdentifier {
  filters?: OrgChartFilters;
  include_suspects?: boolean;
}

/** Body for `POST /v1/org-chart/locations`. */
export interface OrgChartLocationsParams extends OrgChartIdentifier {
  filters?: OrgChartFilters;
}

/**
 * Which company answered: the identifier the request carried (`domain`
 * normalised). On `retrieve` and `departments` it is completed from the index
 * where it can be — `linkedin_url` for a company asked about by domain, and
 * `name`; `locations` names no company, so only what was sent is set.
 */
export interface OrgChartCompany {
  domain: string | null;
  linkedin_url: string | null;
  name: string | null;
}

/** A taxonomy value: `code` to send back, `label` to show. */
export interface OrgChartCode {
  code: string;
  label: string;
}

/**
 * How complete one part of the answer is: `ready`, `empty` (with `reason`,
 * e.g. `no_profiles`), `degraded` (e.g. `low_coverage`), `computing` or
 * `failed` (with `code`). Values not listed here may appear.
 */
export interface OrgChartStatus {
  state: string;
  reason: string | null;
  code: string | null;
  retryable: boolean;
  progress: { done: number | null; total: number | null } | null;
  updated_at: string | null;
  data_as_of: string | null;
  data_version: string | null;
}

/** What `filters.text` was matched as. */
export interface OrgChartMatched {
  field: string;
  value: string | null;
  label: string;
  level: string | null;
}

/** One row (department) or column (seniority). */
export interface OrgChartAxisEntry extends OrgChartCode {
  /** A row's total is the sum of its cells; a column's is its people. */
  total: number;
  /** The explicit Unknown row or column, always last. */
  unknown: boolean;
}

/** `null` when not asked for or not available — never a 0 for "unknown". */
export interface OrgChartBadges {
  new_joiners: number | null;
  job_openings: number | null;
}

/** One department × seniority count. Absent pairs are zero, not listed. */
export interface OrgChartCell {
  department: OrgChartCode;
  seniority: OrgChartCode;
  count: number;
  badges: OrgChartBadges;
}

/** One department's sub-department, with its own seniority counts. */
export interface OrgChartSubdepartment {
  department: OrgChartCode;
  subdepartment: OrgChartCode;
  total: number;
  cells: { seniority: OrgChartCode; count: number }[];
}

/** How well the company's record is covered by people profiles. */
export interface OrgChartCoverage {
  employee_count: number | null;
  profiles: number;
  /** Sparse, or another record of the same company holds far more profiles: the grid is `degraded`. */
  low: boolean;
  /** Other records of the same LinkedIn page, most profiles first. */
  candidates: { name: string | null; profiles: number; linkedin_url: string | null }[];
}

/** The grid. */
export interface OrgChartResponse {
  company: OrgChartCompany;
  state: OrgChartStatus;
  /** Rows, in taxonomy order, Unknown last. */
  departments: OrgChartAxisEntry[];
  /** Columns, C-Suite down to In Training, Unknown last. */
  seniorities: OrgChartAxisEntry[];
  cells: OrgChartCell[];
  subdepartments: OrgChartSubdepartment[];
  /**
   * People counted: each person once, at their most senior level — the sum of
   * the columns. A person who holds several departments is in each of those
   * rows, so the cells can add up to more.
   */
  total: number;
  /** Suspect profiles left out (0 with `include_suspects`). */
  suspect_count: number;
  employment_mismatch_count: number;
  /** One state per badge; `null` when that badge was not asked for. */
  metrics: { new_joiners: OrgChartStatus | null; job_openings: OrgChartStatus | null };
  new_joiners_total: number | null;
  job_openings_total: number | null;
  /** How joiners are dated: `company_stint` or `role_start`. */
  joiner_basis: string | null;
  residual_duplicates: number | null;
  coverage: OrgChartCoverage | null;
  matched: OrgChartMatched | null;
  data_version: string | null;
  taxonomy_version: string | null;
  attribution: Attribution[];
  degradation: Degradation[];
  meta: ResponseMeta;
}

/** The grid's rows and sub-department rows, without the cells and badges. `total` is the grid's. */
export interface OrgChartDepartmentsResponse {
  company: OrgChartCompany;
  state: OrgChartStatus;
  departments: OrgChartAxisEntry[];
  subdepartments: OrgChartSubdepartment[];
  total: number;
  suspect_count: number;
  matched: OrgChartMatched | null;
  data_version: string | null;
  taxonomy_version: string | null;
  attribution: Attribution[];
  degradation: Degradation[];
  meta: ResponseMeta;
}

/** One place, with the places under it. Unknown is `value: null`, last among its siblings. */
export interface OrgChartLocation {
  level: string;
  value: string | null;
  label: string;
  count: number;
  unknown: boolean;
  children: OrgChartLocation[];
}

/**
 * Where the company's people are, country → state → city, each by count. Each
 * level is complete — people with no known place at a level are an Unknown
 * node — so a parent's count is the sum of its children.
 */
export interface OrgChartLocationsResponse {
  company: OrgChartCompany;
  state: OrgChartStatus;
  items: OrgChartLocation[];
  /** People counted under the filters. */
  total: number;
  matched: OrgChartMatched | null;
  attribution: Attribution[];
  degradation: Degradation[];
  meta: ResponseMeta;
}

/**
 * Exactly one of `domain` / `linkedin_url`: the two could name different
 * companies. Which values name a company with an org chart is the server's
 * to say.
 */
function validateIdentifier(params: OrgChartIdentifier): void {
  const hasDomain = params.domain !== undefined;
  const hasLi = params.linkedin_url !== undefined;
  ensure(hasDomain || hasLi, 'Provide `domain` or `linkedin_url`');
  ensure(
    !(hasDomain && hasLi),
    'Provide `domain` or `linkedin_url`, not both: the two can name different companies',
  );
  const value = hasDomain ? params.domain : params.linkedin_url;
  ensure(
    typeof value === 'string' && value.length > 0,
    `\`${hasDomain ? 'domain' : 'linkedin_url'}\` must be a non-empty string`,
  );
}

function validateFilters(filters: OrgChartFilters | undefined): void {
  if (filters === undefined) return;
  ensure(filters !== null && typeof filters === 'object', '`filters` must be an object');
  const locations = filters.locations;
  if (locations === undefined) return;
  ensure(locations !== null && typeof locations === 'object', '`filters.locations` must be an object');
  for (const side of ['include', 'exclude'] as const) {
    const places = locations[side];
    if (places === undefined) continue;
    ensure(Array.isArray(places), `\`filters.locations.${side}\` must be an array of places`);
    places.forEach((place: unknown, i) => {
      const value = (place as Partial<OrgChartPlace> | null)?.value;
      ensure(
        typeof value === 'string' && value.trim().length > 0,
        `\`filters.locations.${side}[${i}]\` must be { level, value } with a non-blank value`,
      );
    });
  }
  // Vocabularies and list lengths are left to the server, whose 422 names
  // the field.
}

export class OrgChart extends APIResource {
  /**
   * The grid: department × seniority counts, both axes' totals and each
   * department's sub-departments. 1 credit flat, free when it counts nobody;
   * requires `dsp.search.read`. A deployment without the org chart upstream
   * answers 501 `not_implemented` (`FeatureNotAvailableError`).
   */
  async retrieve(params: OrgChartParams, options?: RequestOptions): Promise<OrgChartResponse> {
    ensure(
      params !== null && typeof params === 'object',
      'retrieve(params) requires a params object',
    );
    validateIdentifier(params);
    validateFilters(params.filters);
    return this.transport.request('POST', '/v1/org-chart', {
      body: compact({ ...params }),
      routeClass: 'billed',
      options,
    });
  }

  /**
   * The grid's rows and sub-department rows, without the cells and badges.
   * 1 credit flat; requires `dsp.search.read`. `retrieve()` already carries
   * `subdepartments`.
   */
  async departments(
    params: OrgChartDepartmentsParams,
    options?: RequestOptions,
  ): Promise<OrgChartDepartmentsResponse> {
    ensure(
      params !== null && typeof params === 'object',
      'departments(params) requires a params object',
    );
    validateIdentifier(params);
    validateFilters(params.filters);
    return this.transport.request('POST', '/v1/org-chart/departments', {
      body: compact({ ...params }),
      routeClass: 'billed',
      options,
    });
  }

  /**
   * Where the people are, country → state → city — and the place vocabulary
   * the filters accept. 1 credit flat; requires `dsp.search.read`.
   */
  async locations(
    params: OrgChartLocationsParams,
    options?: RequestOptions,
  ): Promise<OrgChartLocationsResponse> {
    ensure(
      params !== null && typeof params === 'object',
      'locations(params) requires a params object',
    );
    validateIdentifier(params);
    validateFilters(params.filters);
    return this.transport.request('POST', '/v1/org-chart/locations', {
      body: compact({ ...params }),
      routeClass: 'billed',
      options,
    });
  }
}

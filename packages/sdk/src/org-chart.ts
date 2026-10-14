/**
 * The `/v1/org-chart*` surface: one company's people, counted by department
 * and seniority, then by sub-department, then by location.
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

/** The label the server uses for people with no value at a location level. Accepted back as a filter. */
export const UNKNOWN_LOCATION = '__unknown__';

/** Founders, owners, board members and advisors — orthogonal to seniority. */
export type GovernanceLevel =
  | 'Founder'
  | 'Co Founder'
  | 'Owner'
  | 'Partner'
  | 'Board Member'
  | 'Investor'
  | 'Advisor';

/** How someone is engaged, not how senior they are. */
export type EmploymentType =
  | 'Full Time'
  | 'Part Time'
  | 'Freelancer'
  | 'Contractor'
  | 'Consultant (External)';

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
 * before grouping, so it changes the counts rather than hiding rows.
 */
export interface OrgChartPeopleFilters {
  /**
   * Case-insensitive; OR within a level, AND across levels. At most 50.
   * Send {@link UNKNOWN_LOCATION} to match people with no country recorded.
   */
  country?: string[];
  /** As `country`. At most 50. */
  state?: string[];
  /** As `country`. At most 50. */
  city?: string[];
  governance_level?: GovernanceLevel[];
  employment_type?: EmploymentType[];
  /**
   * Tri-state: `true` keeps only people marked as having direct access,
   * `false` only those marked as not, and omitting it filters on neither —
   * people with no value recorded match neither.
   */
  has_direct_access_to_c_suite?: boolean;
}

/** Body for `POST /v1/org-chart`. */
export interface OrgChartParams extends OrgChartIdentifier, OrgChartPeopleFilters {
  /**
   * Count the people the upstream could not classify onto an axis. Off by
   * default: an `Others` row is usually large and never drillable.
   */
  include_others?: boolean;
}

/** Body for `POST /v1/org-chart/departments`. */
export interface OrgChartDepartmentsParams extends OrgChartIdentifier, OrgChartPeopleFilters {}

/** Body for `POST /v1/org-chart/locations`. No people filters — this route *is* the location vocabulary. */
export interface OrgChartLocationsParams extends OrgChartIdentifier {
  /**
   * Case-insensitive substring over all three levels, for typeahead. It
   * filters people, not labels: a city match keeps that city's country and
   * state in the tree with counts reduced to the matching people.
   */
  search?: string;
}

/** Which company answered — exactly one key set, whichever the request carried. */
export interface OrgChartCompany {
  /** Echoed normalised; null on the LinkedIn path. */
  domain: string | null;
  linkedin_url: string | null;
}

/** One department × seniority count. Absent pairs are zero, not listed. */
export interface OrgChartCell {
  department: string;
  seniority: string;
  count: number;
}

/** The grid. */
export interface OrgChartResponse {
  company: OrgChartCompany;
  /**
   * Everyone at the company under the filters. `sum(cells.count)` is usually
   * lower: people the corpus could not place on either axis are counted here
   * and appear in no cell.
   */
  total: number;
  /** Row order: headcount descending, with `Others` / `General` last. */
  departments: string[];
  /** Column order: C-Suite, VP, Director / Head, Manager, IC, Entry, In Training, then `Others`. */
  seniorities: string[];
  cells: OrgChartCell[];
  /** Per-row totals — not the sum of that row's cells (someone with a department and no seniority counts here only). */
  department_totals: Record<string, number>;
  /** Per-column totals, with the same caveat. */
  seniority_totals: Record<string, number>;
  attribution: Attribution[];
  degradation: Degradation[];
  meta: ResponseMeta;
}

/** One sub-department, with its own seniority breakdown. */
export interface OrgChartSubDepartment {
  /** The sub-function's name, or `Uncategorized` for people with none recorded. */
  name: string;
  headcount: number;
  /** Keys are the upstream's raw labels — `Uncategorized` here where the grid says `Others`. */
  seniority_counts: Record<string, number>;
}

export interface OrgChartDepartment {
  name: string;
  headcount: number;
  sub_departments: OrgChartSubDepartment[];
}

/** The sub-department breakdown. No `total` — that lives on `POST /v1/org-chart`. */
export interface OrgChartDepartmentsResponse {
  company: OrgChartCompany;
  /**
   * Departments with people, headcount descending. A name absent from the
   * grid's `departments` can appear here: the grid relabels onto a closed
   * taxonomy and this route reports what is stored.
   */
  departments: OrgChartDepartment[];
  attribution: Attribution[];
  degradation: Degradation[];
  meta: ResponseMeta;
}

export interface OrgChartCity {
  city: string;
  count: number;
}

export interface OrgChartState {
  state: string;
  count: number;
  cities: OrgChartCity[];
}

export interface OrgChartCountry {
  country: string;
  count: number;
  states: OrgChartState[];
}

/**
 * Where the company's people are. A count at every level, because a country's
 * count is not the sum of its states: someone with a country and no state is
 * counted at the country and in no state below it.
 */
export interface OrgChartLocationsResponse {
  company: OrgChartCompany;
  /** Countries with people. {@link UNKNOWN_LOCATION} names the people with no value at a level. */
  locations: OrgChartCountry[];
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

function validatePeople(params: OrgChartPeopleFilters): void {
  for (const axis of ['country', 'state', 'city'] as const) {
    const values = params[axis];
    if (values === undefined) continue;
    ensure(Array.isArray(values), `\`${axis}\` must be an array of strings`);
    values.forEach((value: unknown, i) => {
      ensure(
        typeof value === 'string' && value.trim().length > 0,
        `\`${axis}[${i}]\` must be a non-blank string`,
      );
    });
  }
  // Vocabularies and list lengths are left to the server, whose 422 names
  // the field.
}

export class OrgChart extends APIResource {
  /**
   * The grid: department × seniority counts plus both axes' totals. 1 credit
   * flat; requires `dsp.search.read`. A deployment without the org
   * chart upstream answers 501 `not_implemented`
   * (`FeatureNotAvailableError`).
   */
  async retrieve(params: OrgChartParams, options?: RequestOptions): Promise<OrgChartResponse> {
    ensure(
      params !== null && typeof params === 'object',
      'retrieve(params) requires a params object',
    );
    validateIdentifier(params);
    validatePeople(params);
    return this.transport.request('POST', '/v1/org-chart', {
      body: compact({ ...params }),
      routeClass: 'billed',
      options,
    });
  }

  /**
   * One level down: each department's sub-departments with their own
   * seniority counts. 1 credit flat; requires `dsp.search.read`.
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
    validatePeople(params);
    return this.transport.request('POST', '/v1/org-chart/departments', {
      body: compact({ ...params }),
      routeClass: 'billed',
      options,
    });
  }

  /**
   * Where the people sit, country → state → city — and the vocabulary the
   * other two routes' location filters accept. 1 credit flat; requires
   * `dsp.search.read`.
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
    return this.transport.request('POST', '/v1/org-chart/locations', {
      body: compact({ ...params }),
      routeClass: 'billed',
      options,
    });
  }
}

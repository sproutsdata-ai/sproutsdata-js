/**
 * A company's org chart: its people counted by department, seniority and place. Billed per
 * call; the taxonomy is free. Name the company by exactly one of `domain`, `linkedin_url` (its
 * company page) or `company_ref`; a domain that names several companies throws
 * `OrgChartCompanyAmbiguousError`, whose `candidates` each carry a `company_ref` to call again
 * with. `filters` narrows the people first: `query`, `job_titles` (up to 20), `locations`,
 * `governance_levels`, `employment_types`, `has_direct_access_to_c_suite`, and `departments` /
 * `seniorities` as taxonomy codes. The fields the org chart took before (`country`, `search`,
 * ...) are refused, naming where each went.
 */

import type { RequestOptions } from '../core/transport.js';
import type * as W from '../generated/wire.js';
import { orgChartBody } from '../requests/org-chart.js';
import { Resource } from './resource.js';

/** A company's people, counted. */
export class OrgChart extends Resource {
  /** The grid: people by department and seniority, with `new_joiners` and `job_openings` (`metrics`). */
  async retrieve(params: W.OrgChartRequest, options?: RequestOptions): Promise<W.OrgChartResponse> {
    return this.json('orgChart', { body: orgChartBody('orgChart.retrieve', 'OrgChartRequest', params) }, options);
  }

  /** People by department and sub-department. */
  async departments(params: W.DepartmentsRequest, options?: RequestOptions): Promise<W.DepartmentsResponse> {
    return this.json('orgChartDepartments', { body: orgChartBody('orgChart.departments', 'DepartmentsRequest', params) }, options);
  }

  /** People by place: `countries`, each with its states and their cities. */
  async locations(params: W.LocationsRequest, options?: RequestOptions): Promise<W.LocationsResponse> {
    return this.json('orgChartLocations', { body: orgChartBody('orgChart.locations', 'LocationsRequest', params) }, options);
  }

  /** The department and seniority codes `filters` takes, with their labels. Free. */
  async taxonomy(options?: RequestOptions): Promise<W.TaxonomyResponse> {
    return this.json('orgChartTaxonomy', {}, options);
  }
}

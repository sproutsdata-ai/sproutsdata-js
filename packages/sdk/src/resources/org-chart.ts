/**
 * A company's org chart: its people counted by department, seniority and place, and the people
 * one count lists. The counts are billed per call, `people` per page that lists anyone (a page
 * that lists nobody is free); the taxonomy is free. Name the company by exactly one of
 * `domain`, `linkedin_url` (its company page) or `company_ref`. Every answer names the company
 * by its `company_ref`, which is also a company search row's `id`. A domain that names several
 * companies throws `OrgChartCompanyAmbiguousError`, whose `candidates` each carry a
 * `company_ref` to call again with. `filters` narrows the people first: `query`, `job_titles`
 * (up to 20), `locations`, `governance_levels`, `employment_types`,
 * `has_direct_access_to_c_suite`, and `departments` / `seniorities` as taxonomy codes. The
 * fields the org chart took before (`country`, `search`, ...) are refused, naming where each
 * went.
 */

import type { RequestOptions } from '../core/transport.js';
import type * as W from '../generated/wire.js';
import { orgChartBody, peopleBody } from '../requests/org-chart.js';
import type { PageOptions } from '../types/index.js';
import { Resource } from './resource.js';

/** A company's people, counted, and the people one count lists. */
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

  /**
   * One page of the people a cell counts, most senior first. `cell` names the count by code
   * (`taxonomy()`): a `department`, a `seniority` or both, and a `subdepartment` (a team) inside
   * its department; `unknown` names the people with no value on that axis. Send the chart's own
   * `filters` and `include_suspects`: they narrow the list as they narrowed the count, so `total`
   * is the cell's count. A person on the Do-Not-Contact list is counted but never listed, so
   * pages can hold fewer people than `total`. `limit` is 1 to 100 (default 10) and may change
   * between pages; the cursor is bound to the company, filters, cell and `include_suspects`.
   *
   * @throws {ClientValidationError} A cell that names neither a department nor a seniority, or a team without its department.
   * @throws {CursorInvalidError} A cursor sent with another company, filters, cell or `include_suspects`.
   */
  async people(params: W.OrgChartPeopleRequest, options?: RequestOptions): Promise<W.OrgChartPeopleResponse> {
    return this.json('orgChartPeople', { body: peopleBody('orgChart.people', params) }, options);
  }

  /** Every person a cell lists, page after page: `people`'s parameters plus `maxResults`. */
  iterPeople(params: Omit<W.OrgChartPeopleRequest, 'cursor'> & PageOptions, options?: RequestOptions): AsyncGenerator<W.OrgChartCellPerson, void, undefined> {
    const { maxResults, ...people } = params;
    return this.rows('orgChartPeople', { body: peopleBody('orgChart.iterPeople', people) }, (page) => page.results, options, maxResults);
  }

  /** The department and seniority codes `filters` takes, with their labels. Free. */
  async taxonomy(options?: RequestOptions): Promise<W.TaxonomyResponse> {
    return this.json('orgChartTaxonomy', {}, options);
  }
}

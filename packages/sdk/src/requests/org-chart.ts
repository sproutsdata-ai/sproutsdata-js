/**
 * The bodies of the `/v1/org-chart` routes, checked as the server checks them (be
 * `src/dsp/features/org_chart/requests.py`).
 */

import type * as W from '../generated/wire.js';
import { present, refuse } from './build.js';
import { checkShape } from './shape.js';

/** The fields the org chart took before prism's People & Hiring shape, and where each went. */
export const RETIRED: Readonly<Record<string, string>> = {
  country: 'filters.locations.include.countries',
  state: 'filters.locations.include.states',
  city: 'filters.locations.include.cities',
  governance_level: 'filters.governance_levels',
  employment_type: 'filters.employment_types',
  has_direct_access_to_c_suite: 'filters.has_direct_access_to_c_suite',
  include_others: 'include_suspects',
  search: 'filters.query',
};

const SCHEME = /^(?:https?:\/\/)?(?:www\.)?/i;
const HOST = /^[a-z0-9][a-z0-9\-.]*\.[a-z]{2,}$/;
const COMPANY_PAGE = /^linkedin\.com\/company\/([^/?#]+)/;

interface Company {
  readonly domain?: string | null;
  readonly linkedin_url?: string | null;
  readonly company_ref?: string | null;
  readonly metrics?: readonly string[];
}

/** An org chart body: one company, the nested filters, no retired field. */
export function orgChartBody<T extends Company>(what: string, type: string, params: T): T {
  const retired = Object.keys(params).filter((name) => name in RETIRED).sort();
  if (retired.length > 0) refuse(what, `retired field(s): ${retired.map((name) => `\`${name}\` is now \`${RETIRED[name] ?? ''}\``).join('; ')}`);
  checkShape(what, params, type);
  const named = [params.domain, params.linkedin_url, params.company_ref].filter((value) => value !== undefined && value !== null);
  if (named.length === 0) refuse(what, 'provide `domain`, `linkedin_url` or `company_ref`'); // be :121
  if (named.length > 1) refuse(what, 'provide one of `domain`, `linkedin_url` or `company_ref`');
  checkCompany(what, params);
  const metrics = params.metrics ?? [];
  if (new Set(metrics).size !== metrics.length) refuse(what, '`metrics` lists each badge once'); // be :138
  return params;
}

/**
 * A people body: the chart's own company and filters, and one cell by code. Refuses what
 * `orgChartBody` refuses, a cell that names neither a department nor a seniority, and a
 * sub-department without its department (be org_chart/requests.py `PeopleCell._a_cell`).
 */
export function peopleBody(what: string, params: W.OrgChartPeopleRequest): W.OrgChartPeopleRequest {
  const body = orgChartBody(what, 'OrgChartPeopleRequest', params);
  const { department, seniority, subdepartment } = body.cell;
  if (!present(department) && !present(seniority)) refuse(what, 'cell: a cell names a `department`, a `seniority` or both');
  if (present(subdepartment) && !present(department)) refuse(what, "cell: a cell's `subdepartment` needs its `department`");
  return body;
}

function checkCompany(what: string, params: Company): void {
  if (typeof params.domain === 'string' && !HOST.test(bare(params.domain).split('/')[0] ?? '')) {
    refuse(what, "domain: must be a company domain such as `stripe.com`; find one with search({ category: 'company' }), or send `linkedin_url`"); // be :79
  }
  if (typeof params.linkedin_url === 'string' && !COMPANY_PAGE.test(bare(params.linkedin_url))) {
    refuse(what, 'linkedin_url: must be a company page such as `linkedin.com/company/stripe`; a personal profile or a school page is not a company'); // be :89
  }
}

function bare(value: string): string {
  return value.trim().toLowerCase().replace(SCHEME, '');
}

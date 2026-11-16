/** The org chart (O1-O7): one company, nested filters, retired fields, the ambiguous company. */

import { describe, expect, it } from 'vitest';

import { OrgChartCompanyAmbiguousError } from '../../src/core/errors.js';
import { RETIRED } from '../../src/requests/org-chart.js';
import { OrgChart } from '../../src/resources/org-chart.js';
import type { OrgChartFilters, OrgChartRequest } from '../../src/types/index.js';
import { assertValidRequest, recorded } from '../support/answers.js';
import { rig } from '../support/rig.js';

const FILTERS: OrgChartFilters = {
  query: { text: 'platform', field: 'title' },
  job_titles: ['Staff Engineer'],
  locations: { include: { countries: ['germany'], cities: ['berlin'] }, exclude: { states: ['bavaria'] } },
  governance_levels: ['Co Founder'],
  employment_types: ['Full Time'],
  has_direct_access_to_c_suite: true,
  departments: ['engineering'],
  seniorities: ['senior'],
};

describe('org chart', () => {
  it.each([
    [{}, 'provide `domain`, `linkedin_url` or `company_ref`'],
    [{ domain: 'a.de', company_ref: 'd1_x' }, 'provide one of'],
    [{ domain: 'not a domain' }, 'must be a company domain'],
    [{ linkedin_url: 'https://linkedin.com/in/someone' }, 'must be a company page'],
  ])('O1: exactly one company (%#)', async (params, reason) => {
    await expect(new OrgChart(rig([]).transport).retrieve(params)).rejects.toThrow(reason);
  });

  it('O2: nested filters are sent as the server reads them', async () => {
    const r = rig([recorded('org_chart', 'grid')]);
    const chart = new OrgChart(r.transport);
    await chart.retrieve({ domain: 'example-1.de', filters: FILTERS });
    expect((r.body() as { filters: unknown }).filters).toEqual(FILTERS);
    assertValidRequest('org_chart', r.body());
    await expect(chart.retrieve({ domain: 'a.de', filters: { job_titles: Array.from({ length: 21 }, () => 't') } })).rejects.toThrow('job_titles: must be at most 20 entries');
  });

  it('O3: include_suspects on every call, metrics on the grid', async () => {
    const r = rig([recorded('org_chart', 'grid'), recorded('org_chart_departments', 'departments'), recorded('org_chart_locations', 'locations')]);
    const chart = new OrgChart(r.transport);
    await chart.retrieve({ linkedin_url: 'linkedin.com/company/stripe', metrics: ['new_joiners'], include_suspects: true });
    await chart.departments({ domain: 'stripe.com', include_suspects: true });
    await chart.locations({ company_ref: 'd1_x', include_suspects: false });
    expect([r.body(0), r.body(1), r.body(2)]).toEqual([
      { linkedin_url: 'linkedin.com/company/stripe', metrics: ['new_joiners'], include_suspects: true },
      { domain: 'stripe.com', include_suspects: true },
      { company_ref: 'd1_x', include_suspects: false },
    ]);
    await expect(chart.retrieve({ domain: 'a.de', metrics: ['new_joiners', 'new_joiners'] })).rejects.toThrow('lists each badge once');
  });

  it.each(Object.entries(RETIRED))('O4: the retired field %s is refused, naming %s', async (field, replacement) => {
    const r = rig([]);
    const params: OrgChartRequest = { domain: 'a.de', ...{ [field]: 'x' } };
    await expect(new OrgChart(r.transport).retrieve(params)).rejects.toThrow(`\`${field}\` is now \`${replacement}\``);
    expect(r.sent).toHaveLength(0);
  });

  it('O5: all three answers read from the generated types', async () => {
    const r = rig([recorded('org_chart', 'grid'), recorded('org_chart_departments', 'departments'), recorded('org_chart_locations', 'locations')]);
    const chart = new OrgChart(r.transport);
    const grid = await chart.retrieve({ domain: 'example-1.de' });
    const departments = await chart.departments({ domain: 'example-1.de' });
    const places = await chart.locations({ domain: 'example-1.de' });
    expect(grid.cells[0]?.department).toEqual({ code: 'engineering', label: 'Engineering' });
    expect(grid.suspect_count).toBeGreaterThanOrEqual(0);
    expect(grid.company.name).toBeTruthy();
    expect(departments.department_totals.length).toBeGreaterThan(0);
    expect(places.countries[0]?.children).toBeDefined();
  });

  it('O6: the taxonomy is read leniently', async () => {
    const r = rig([recorded('org_chart_taxonomy', 'codes')]);
    const taxonomy = await new OrgChart(r.transport).taxonomy();
    expect(taxonomy.departments.length).toBeGreaterThan(0);
  });

  it('O7: an ambiguous company lists candidates to retry with', async () => {
    const r = rig([recorded('org_chart', 'ambiguous'), recorded('org_chart', 'grid')]);
    const chart = new OrgChart(r.transport);
    const error = await chart.retrieve({ domain: 'twin.example' }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(OrgChartCompanyAmbiguousError);
    const [candidate] = (error as OrgChartCompanyAmbiguousError).candidates;
    expect(candidate?.domain).toBe('twin.example');
    expect([candidate?.company_ref, candidate?.name, candidate?.linkedin_url].every((value) => typeof value === 'string')).toBe(true);
    await chart.retrieve({ company_ref: candidate?.company_ref ?? '' });
    expect(r.body(1)).toEqual({ company_ref: candidate?.company_ref });
  });
});

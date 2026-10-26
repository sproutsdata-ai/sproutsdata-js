import { describe, expect, it } from 'vitest';

import { SproutsData, ErrorCode, FeatureNotAvailableError, UNKNOWN_CODE } from '../src/index';
import type { OrgChartResponse } from '../src/index';
import { TEST_KEY, envelope, fetchQueue, jsonResponse, problemResponse } from './helpers';

function makeClient(fetchImpl: typeof globalThis.fetch) {
  return new SproutsData({
    apiKey: TEST_KEY,
    baseUrl: 'https://dsp.example.test/backend',
    fetch: fetchImpl,
    maxRetries: 0,
  });
}

const provenance = { attribution: [], degradation: [], meta: envelope().meta };
const ready = {
  state: 'ready',
  reason: null,
  code: null,
  retryable: false,
  progress: null,
  updated_at: null,
  data_as_of: null,
  data_version: 'gtm_v9',
};
const eng = { code: 'engineering_software', label: 'Engineering / Software' };
const ic = { code: 'ic', label: 'IC' };
const vp = { code: 'vp', label: 'VP' };

/** One Platform's grid, as the server returns it: codes and labels, Unknown last. */
const grid: OrgChartResponse = {
  company: { domain: 'stripe.com', linkedin_url: 'linkedin.com/company/stripe', name: 'Stripe' },
  state: ready,
  departments: [
    { ...eng, total: 90, unknown: false },
    { code: UNKNOWN_CODE, label: 'Unknown', total: 10, unknown: true },
  ],
  seniorities: [
    { ...vp, total: 7, unknown: false },
    { ...ic, total: 93, unknown: false },
  ],
  cells: [{ department: eng, seniority: ic, count: 80, badges: { new_joiners: 4, job_openings: null } }],
  subdepartments: [
    {
      department: eng,
      subdepartment: { code: 'data_engineering', label: 'Data Engineering' },
      total: 20,
      cells: [{ seniority: ic, count: 20 }],
    },
  ],
  total: 100,
  suspect_count: 3,
  employment_mismatch_count: 0,
  metrics: { new_joiners: ready, job_openings: null },
  new_joiners_total: 4,
  job_openings_total: null,
  joiner_basis: 'company_stint',
  residual_duplicates: 0,
  coverage: null,
  matched: null,
  data_version: 'gtm_v9',
  taxonomy_version: 'v3',
  ...provenance,
};

describe('orgChart.retrieve', () => {
  it('POSTs the identifier, filters and options to /v1/org-chart and reads the grid', async () => {
    const fetchMock = fetchQueue(jsonResponse(grid));
    const client = makeClient(fetchMock);
    const chart = await client.orgChart.retrieve({
      domain: 'https://www.stripe.com/about',
      filters: {
        locations: { include: [{ level: 'country', value: 'Netherlands' }] },
        employment_types: ['full_time'],
        c_suite_access: false,
      },
      metrics: [],
      include_suspects: true,
    });
    expect(chart.total).toBe(100);
    expect(chart.cells[0]!.department.code).toBe('engineering_software');
    expect(chart.cells[0]!.badges.new_joiners).toBe(4);
    expect(chart.departments.at(-1)!.unknown).toBe(true);
    expect(chart.subdepartments[0]!.subdepartment.label).toBe('Data Engineering');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/org-chart');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({
      domain: 'https://www.stripe.com/about',
      filters: {
        locations: { include: [{ level: 'country', value: 'Netherlands' }] },
        employment_types: ['full_time'],
        c_suite_access: false,
      },
      metrics: [],
      include_suspects: true,
    });
  });

  it('refuses a missing, doubled or empty identifier and blank place values', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(client.orgChart.retrieve({})).rejects.toThrow(/`domain` or `linkedin_url`/);
    await expect(
      client.orgChart.retrieve({ domain: 'stripe.com', linkedin_url: 'linkedin.com/company/stripe' }),
    ).rejects.toThrow(/not both/);
    await expect(client.orgChart.retrieve({ linkedin_url: '' })).rejects.toThrow(/non-empty/);
    await expect(
      client.orgChart.retrieve({
        domain: 'stripe.com',
        filters: { locations: { exclude: [{ level: 'city', value: '  ' }] } },
      }),
    ).rejects.toThrow(/non-blank/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the kind of LinkedIn page, vocabularies and list lengths to the server', async () => {
    const fetchMock = fetchQueue(jsonResponse({}));
    const client = makeClient(fetchMock);
    const include = Array.from({ length: 11 }, (_, i) => ({ level: 'city' as const, value: `city ${i}` }));
    await client.orgChart.retrieve({
      linkedin_url: 'linkedin.com/school/stanford',
      filters: { locations: { include } },
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).filters.locations.include).toHaveLength(11);
  });

  it('maps a 501 to FeatureNotAvailableError with code not_implemented', async () => {
    const fetchMock = fetchQueue(
      problemResponse(501, { code: 'not_implemented', title: 'Org charts are not wired here' }),
    );
    const client = makeClient(fetchMock);
    const failure = await client.orgChart
      .retrieve({ linkedin_url: 'linkedin.com/company/stripe' })
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(FeatureNotAvailableError);
    expect((failure as FeatureNotAvailableError).status).toBe(501);
    expect((failure as FeatureNotAvailableError).code).toBe(ErrorCode.NOT_IMPLEMENTED);
  });
});

describe('orgChart.departments', () => {
  it('POSTs to /v1/org-chart/departments and reads the rows and sub-department rows', async () => {
    const { company, state, departments, subdepartments, total, suspect_count } = grid;
    const body = {
      company,
      state,
      departments,
      subdepartments,
      total,
      suspect_count,
      matched: null,
      data_version: 'gtm_v9',
      taxonomy_version: 'v3',
      ...provenance,
    };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const view = await client.orgChart.departments({
      linkedin_url: 'linkedin.com/company/stripe',
      filters: { governance_levels: ['founder'] },
      include_suspects: false,
    });
    expect(view.subdepartments[0]!.cells[0]!.count).toBe(20);
    expect(view.total).toBe(100);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/org-chart/departments');
    expect(JSON.parse(init!.body as string)).toEqual({
      linkedin_url: 'linkedin.com/company/stripe',
      filters: { governance_levels: ['founder'] },
      include_suspects: false,
    });
  });
});

describe('orgChart.locations', () => {
  it('POSTs to /v1/org-chart/locations with filters and reads the location tree', async () => {
    const node = (level: string, value: string | null, label: string, count: number, ...children: unknown[]) => ({
      level,
      value,
      label,
      count,
      unknown: value === null,
      children,
    });
    const body = {
      company: { domain: 'stripe.com', linkedin_url: null, name: null },
      state: ready,
      items: [
        node('country', 'netherlands', 'Netherlands', 40, node('state', 'north holland', 'North Holland', 40)),
        node('country', null, 'Unknown', 3),
      ],
      total: 43,
      matched: null,
      ...provenance,
    };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const where = await client.orgChart.locations({
      domain: 'stripe.com',
      filters: { c_suite_access: true },
    });
    expect(where.items[0]!.children[0]!.value).toBe('north holland');
    expect(where.items[1]!.value).toBeNull();
    expect(where.total).toBe(43);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/org-chart/locations');
    expect(JSON.parse(init!.body as string)).toEqual({
      domain: 'stripe.com',
      filters: { c_suite_access: true },
    });
  });
});

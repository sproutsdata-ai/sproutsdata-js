import { describe, expect, it } from 'vitest';

import {
  SproutsData,
  ErrorCode,
  FeatureNotAvailableError,
  UNKNOWN_LOCATION,
} from '../src/index';
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

describe('orgChart.retrieve', () => {
  it('POSTs the identifier and filters to /v1/org-chart and reads the grid', async () => {
    const body = {
      company: { domain: 'stripe.com', linkedin_url: null },
      total: 120,
      departments: ['Engineering', 'Sales'],
      seniorities: ['C-Suite', 'VP', 'IC'],
      cells: [
        { department: 'Engineering', seniority: 'IC', count: 80 },
        { department: 'Sales', seniority: 'VP', count: 2 },
      ],
      department_totals: { Engineering: 90, Sales: 20 },
      seniority_totals: { 'C-Suite': 3, VP: 7, IC: 100 },
      ...provenance,
    };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const chart = await client.orgChart.retrieve({
      domain: 'https://www.stripe.com/about',
      country: ['Netherlands', UNKNOWN_LOCATION],
      employment_type: ['Full Time'],
      has_direct_access_to_c_suite: true,
      include_others: true,
    });
    expect(chart.total).toBe(120);
    expect(chart.cells[0]!.count).toBe(80);
    expect(chart.department_totals['Engineering']).toBe(90);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/org-chart');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({
      domain: 'https://www.stripe.com/about',
      country: ['Netherlands', '__unknown__'],
      employment_type: ['Full Time'],
      has_direct_access_to_c_suite: true,
      include_others: true,
    });
  });

  it('refuses a missing, doubled or empty identifier and blank location values', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(client.orgChart.retrieve({})).rejects.toThrow(/`domain` or `linkedin_url`/);
    await expect(
      client.orgChart.retrieve({ domain: 'stripe.com', linkedin_url: 'linkedin.com/company/stripe' }),
    ).rejects.toThrow(/not both/);
    await expect(client.orgChart.retrieve({ linkedin_url: '' })).rejects.toThrow(/non-empty/);
    await expect(
      client.orgChart.retrieve({ domain: 'stripe.com', state: ['California', '  '] }),
    ).rejects.toThrow(/non-blank/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the kind of LinkedIn page and list lengths to the server', async () => {
    const fetchMock = fetchQueue(jsonResponse({}));
    const client = makeClient(fetchMock);
    const city = Array.from({ length: 51 }, (_, i) => `city ${i}`);
    await client.orgChart.retrieve({ linkedin_url: 'linkedin.com/school/stanford', city });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).city).toHaveLength(51);
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
  it('POSTs to /v1/org-chart/departments and reads the sub-department tree', async () => {
    const body = {
      company: { domain: null, linkedin_url: 'linkedin.com/company/stripe' },
      departments: [
        {
          name: 'Engineering',
          headcount: 90,
          sub_departments: [
            { name: 'Data', headcount: 20, seniority_counts: { IC: 18, Manager: 2 } },
            { name: 'Uncategorized', headcount: 5, seniority_counts: { IC: 5 } },
          ],
        },
      ],
      ...provenance,
    };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const tree = await client.orgChart.departments({
      linkedin_url: 'linkedin.com/company/stripe',
      governance_level: ['Founder'],
    });
    expect(tree.departments[0]!.sub_departments[0]!.seniority_counts['IC']).toBe(18);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/org-chart/departments');
    expect(JSON.parse(init!.body as string)).toEqual({
      linkedin_url: 'linkedin.com/company/stripe',
      governance_level: ['Founder'],
    });
  });
});

describe('orgChart.locations', () => {
  it('POSTs to /v1/org-chart/locations with search and reads the location tree', async () => {
    const body = {
      company: { domain: 'stripe.com', linkedin_url: null },
      locations: [
        {
          country: 'Netherlands',
          count: 40,
          states: [
            {
              state: 'North Holland',
              count: 38,
              cities: [{ city: 'Amsterdam', count: 36 }],
            },
          ],
        },
        { country: '__unknown__', count: 3, states: [] },
      ],
      ...provenance,
    };
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const where = await client.orgChart.locations({ domain: 'stripe.com', search: 'amst' });
    expect(where.locations[0]!.states[0]!.cities[0]!.city).toBe('Amsterdam');
    expect(where.locations[1]!.country).toBe(UNKNOWN_LOCATION);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/org-chart/locations');
    expect(JSON.parse(init!.body as string)).toEqual({ domain: 'stripe.com', search: 'amst' });
  });

  it('leaves the search length to the server', async () => {
    const fetchMock = fetchQueue(jsonResponse({}));
    const client = makeClient(fetchMock);
    await client.orgChart.locations({ domain: 'stripe.com', search: 'x'.repeat(101) });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).search).toHaveLength(101);
  });
});

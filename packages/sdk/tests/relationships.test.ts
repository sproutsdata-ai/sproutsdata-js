import { describe, expect, it } from 'vitest';

import { SproutsData, ClientValidationError } from '../src/index';
import { TEST_KEY, envelope, fetchQueue, jsonResponse } from './helpers';

function makeClient(fetchImpl: typeof globalThis.fetch) {
  return new SproutsData({
    apiKey: TEST_KEY,
    baseUrl: 'https://dsp.example.test/backend',
    fetch: fetchImpl,
    maxRetries: 0,
  });
}

function relationshipEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    ...envelope(),
    results: [],
    total: 0,
    institutions: [],
    connection_basis: 'overlapping',
    ...overrides,
  };
}

describe('relationships.find', () => {
  it('POSTs the structured body to /v1/relationships', async () => {
    const hit = {
      id: 'p_1',
      category: 'person',
      full_name: 'Ada Lovelace',
      title: 'VP Engineering',
      linkedin_url: 'linkedin.com/in/ada',
      country: 'GB',
      avatar: null,
      department: 'Engineering',
      seniority: 'VP',
      number_of_contacts_overlapping_tenure_with: 12,
      match_reason_count: 2,
      match_type: ['Previously worked at Adyen', 'Attended Stanford University'],
      is_alum: true,
      currently_at_target: false,
      via: [],
      company_name: null,
      company_domain: null,
      profile_complete: true,
    };
    const body = relationshipEnvelope({
      results: [hit],
      total: 1,
      institutions: [
        {
          id: 'name:adyen',
          name: 'Adyen',
          kind: 'employment',
          match_confidence: 'url',
          people_first: 3,
          people_second: 9,
        },
      ],
    });
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);

    const page = await client.relationships.find({
      relation: 'between_companies',
      companies: [
        { value: 'stripe.com' },
        { value: 'adyen.com', people: { seniority: ['VP', 'Director'] } },
      ],
      limit: 25,
    });

    expect(page.institutions[0]!.name).toBe('Adyen');
    expect(page.connection_basis).toBe('overlapping');
    expect(page.results[0]!.number_of_contacts_overlapping_tenure_with).toBe(12);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/relationships');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({
      relation: 'between_companies',
      companies: [
        { value: 'stripe.com' },
        { value: 'adyen.com', people: { seniority: ['VP', 'Director'] } },
      ],
      limit: 25,
    });
  });

  it('accepts a query in words on its own', async () => {
    const fetchMock = fetchQueue(jsonResponse(relationshipEnvelope()));
    const client = makeClient(fetchMock);
    await client.relationships.find({ query: 'who at Adyen do we know from Stripe' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      query: 'who at Adyen do we know from Stripe',
    });
  });

  it('rejects query beside structured fields, and neither, before any request', async () => {
    const fetchMock = fetchQueue();
    const client = makeClient(fetchMock);
    await expect(
      client.relationships.find({ query: 'who?', companies: [{ value: 'stripe.com' }] }),
    ).rejects.toThrow(/not both/);
    await expect(client.relationships.find({})).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects empty company or institution values, leaving counts and limits to the server', async () => {
    const fetchMock = fetchQueue(jsonResponse({}));
    const client = makeClient(fetchMock);
    await expect(
      client.relationships.find({ relation: 'between_companies', companies: [{ value: '' }] }),
    ).rejects.toThrow(ClientValidationError);
    await expect(
      client.relationships.find({ query: 'who?', institutions: [{ value: '' }] }),
    ).rejects.toThrow(/institutions\[0\]\.value/);
    expect(fetchMock).not.toHaveBeenCalled();
    await client.relationships.find({
      relation: 'between_companies',
      companies: [{ value: 'a.com' }, { value: 'b.com' }, { value: 'c.com' }],
      limit: 101,
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).companies).toHaveLength(3);
  });
  it('findPages follows next_cursor and stops at null', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(relationshipEnvelope({ has_more: true, next_cursor: 'cur_2' })),
      jsonResponse(relationshipEnvelope()),
    );
    const client = makeClient(fetchMock);
    let count = 0;
    for await (const _ of client.relationships.findPages({ query: 'who?' })) count++;
    expect(count).toBe(2);
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).cursor).toBe('cur_2');
  });

  it('keeps null and 0 contact counts distinct', async () => {
    const rows = [
      { id: 'p_1', category: 'person', number_of_contacts_overlapping_tenure_with: 0 },
      { id: 'p_2', category: 'person', number_of_contacts_overlapping_tenure_with: null },
    ];
    const fetchMock = fetchQueue(jsonResponse(relationshipEnvelope({ results: rows, total: 2 })));
    const client = makeClient(fetchMock);
    const page = await client.relationships.find({ query: 'who?' });
    expect(page.results[0]!.number_of_contacts_overlapping_tenure_with).toBe(0);
    expect(page.results[1]!.number_of_contacts_overlapping_tenure_with).toBeNull();
  });
});

describe('relationships.reach', () => {
  function reachEnvelope(overrides: Record<string, unknown> = {}) {
    return {
      ...envelope(),
      results: [],
      total: 0,
      institutions: [],
      connection_basis: 'overlapping',
      ...overrides,
    };
  }

  it('POSTs to /v1/relationships/reach and reads the institutions behind the answer', async () => {
    const institutions = [
      {
        id: 'edu:stanford',
        name: 'Stanford University',
        kind: 'education',
        match_confidence: 'edu',
        people_at_target: 14,
      },
    ];
    const fetchMock = fetchQueue(jsonResponse(reachEnvelope({ institutions })));
    const client = makeClient(fetchMock);
    const page = await client.relationships.reach({
      person: { li_url: 'https://www.linkedin.com/in/ada-lovelace/' },
      target_company: { value: 'microsoft.com', by: 'domain' },
      people: { seniority: ['VP'] },
    });
    expect(page.institutions[0]!.people_at_target).toBe(14);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/relationships/reach');
    expect(JSON.parse(init!.body as string)).toEqual({
      person: { li_url: 'https://www.linkedin.com/in/ada-lovelace/' },
      target_company: { value: 'microsoft.com', by: 'domain' },
      people: { seniority: ['VP'] },
    });
  });

  it('requires the person and the target, and refuses a non-person LinkedIn URL before the billed call', async () => {
    const fetchMock = fetchQueue(jsonResponse({}));
    const client = makeClient(fetchMock);
    await expect(
      client.relationships.reach({ person: { li_url: '' }, target_company: { value: 'adyen.com' } }),
    ).rejects.toThrow(/person\.li_url/);
    await expect(
      client.relationships.reach({
        person: { li_url: 'linkedin.com/in/ada' },
        target_company: { value: '' },
      }),
    ).rejects.toThrow(ClientValidationError);
    // A company page resolves to nobody, which would read as a real "no reach".
    await expect(
      client.relationships.reach({
        person: { li_url: 'linkedin.com/company/stripe' },
        target_company: { value: 'adyen.com' },
      }),
    ).rejects.toThrow(/linkedin\.com\/in\//);
    expect(fetchMock).not.toHaveBeenCalled();
    await client.relationships.reach({
      person: { li_url: 'https://www.LinkedIn.com/in/ada' },
      target_company: { value: 'adyen.com' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reachPages follows next_cursor', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(reachEnvelope({ has_more: true, next_cursor: 'cur_2' })),
      jsonResponse(reachEnvelope()),
    );
    const client = makeClient(fetchMock);
    let count = 0;
    for await (const _ of client.relationships.reachPages({
      person: { li_url: 'linkedin.com/in/ada' },
      target_company: { value: 'adyen.com' },
    })) {
      count++;
    }
    expect(count).toBe(2);
  });
});

describe('relationships.institutions', () => {
  function institutionsEnvelope(overrides: Record<string, unknown> = {}) {
    return {
      ...envelope(),
      results: [
        {
          id: 'edu:stanford',
          name: 'Stanford University',
          kind: 'education',
          match_confidence: 'edu',
          people_first: 4,
          people_second: 9,
        },
      ],
      total: 1,
      truncated: false,
      ...overrides,
    };
  }

  it('POSTs the body to /v1/relationships/institutions and reads truncated', async () => {
    const fetchMock = fetchQueue(jsonResponse(institutionsEnvelope({ truncated: true })));
    const client = makeClient(fetchMock);
    const page = await client.relationships.institutions({
      companies: [{ value: 'stripe.com' }, { value: 'adyen.com', by: 'domain' }],
      institution_type: 'education',
      min_people_per_side: 2,
      name_starts_with: 'stan',
      limit: 500,
    });
    expect(page.truncated).toBe(true);
    expect(page.results[0]!.people_second).toBe(9);
    expect(page.has_more).toBe(false);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/relationships/institutions');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({
      companies: [{ value: 'stripe.com' }, { value: 'adyen.com', by: 'domain' }],
      institution_type: 'education',
      min_people_per_side: 2,
      name_starts_with: 'stan',
      limit: 500,
    });
  });

  it('refuses empty company values, leaving the count and every knob to the server', async () => {
    const fetchMock = fetchQueue(jsonResponse({}));
    const client = makeClient(fetchMock);
    await expect(
      client.relationships.institutions({ companies: [{ value: 'a.com' }, { value: '' }] }),
    ).rejects.toThrow(ClientValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
    await client.relationships.institutions({
      companies: [{ value: 'a.com' }],
      min_people_per_side: 0,
      name_starts_with: 'x'.repeat(201),
      limit: 1001,
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).limit).toBe(1001);
  });
});

describe('relationships.ask', () => {
  function askEnvelope(route: string, slot: Record<string, unknown>) {
    return {
      route,
      reading: { span: 'who at Adyen do we know from Stripe', searches: 1, warnings: [] },
      relationships: null,
      reach: null,
      institutions: null,
      compare: null,
      fan_out: null,
      ...slot,
    };
  }

  it('POSTs the question to /v1/relationships/ask and reads the routed slot', async () => {
    const body = askEnvelope('relationships', {
      relationships: relationshipEnvelope({ total: 3 }),
    });
    const fetchMock = fetchQueue(jsonResponse(body));
    const client = makeClient(fetchMock);
    const answer = await client.relationships.ask({
      query: 'who at Adyen do we know from Stripe',
      limit: 10,
    });
    expect(answer.route).toBe('relationships');
    expect(answer.relationships!.total).toBe(3);
    expect(answer.reading.warnings).toEqual([]);
    expect(answer.compare).toBeNull();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/relationships/ask');
    expect(JSON.parse(init!.body as string)).toEqual({
      query: 'who at Adyen do we know from Stripe',
      limit: 10,
    });
  });

  it('refuses an empty question, leaving its length to the server', async () => {
    const fetchMock = fetchQueue(jsonResponse({}));
    const client = makeClient(fetchMock);
    await expect(client.relationships.ask({ query: '' })).rejects.toThrow(/non-empty/);
    expect(fetchMock).not.toHaveBeenCalled();
    await client.relationships.ask({ query: 'x'.repeat(2001), limit: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('askPages follows the relationships slot cursor', async () => {
    const fetchMock = fetchQueue(
      jsonResponse(
        askEnvelope('relationships', {
          relationships: relationshipEnvelope({ has_more: true, next_cursor: 'cur_2' }),
        }),
      ),
      jsonResponse(askEnvelope('relationships', { relationships: relationshipEnvelope() })),
    );
    const client = makeClient(fetchMock);
    let count = 0;
    for await (const _ of client.relationships.askPages({ query: 'who?' })) count++;
    expect(count).toBe(2);
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).cursor).toBe('cur_2');
  });

  it('askPages yields once and stops on a compare answer', async () => {
    const side = { ...relationshipEnvelope({ total: 5 }), span: 'via Stripe' };
    const compare = { sides: [side, side], stronger: null, comparable: false, connection_basis: 'overlapping' };
    const fetchMock = fetchQueue(jsonResponse(askEnvelope('compare', { compare })));
    const client = makeClient(fetchMock);
    const pages = [];
    for await (const page of client.relationships.askPages({ query: 'which way in is stronger?' })) {
      pages.push(page);
    }
    expect(pages).toHaveLength(1);
    expect(pages[0]!.compare!.sides).toHaveLength(2);
    expect(pages[0]!.compare!.stronger).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

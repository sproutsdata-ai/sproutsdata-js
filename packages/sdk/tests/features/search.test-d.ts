/** S8: document filters and sorts are typed per category, never `Record<string, unknown>`. */

import { describe, expectTypeOf, it } from 'vitest';

import type { FilterValues, SearchParams } from '../../src/types/index.js';

describe('search parameter types', () => {
  it('S8: a document category takes its own filters and sort, and not a company filter', () => {
    expectTypeOf<{ category: 'patent'; filters: { offices: { include: ['EP'] } }; sort: [{ field: 'publication_date' }] }>().toExtend<SearchParams>();
    // @ts-expect-error: `industry` is a company filter, not a patent one
    const patent: SearchParams = { category: 'patent', filters: { industry: { include: ['x'] } } };
    // @ts-expect-error: `revenue` does not order a job opening search
    const jobs: SearchParams = { category: 'job_opening', query: 'x', sort: [{ field: 'revenue' }] };
    // @ts-expect-error: `auto` takes no filters
    const auto: SearchParams = { category: 'auto', query: 'x', filters: {} };
    expectTypeOf([patent, jobs, auto]).toBeArray();
  });

  it('F1: filter value items are nullable', () => {
    expectTypeOf<null>().toExtend<FilterValues['items']>();
  });
});

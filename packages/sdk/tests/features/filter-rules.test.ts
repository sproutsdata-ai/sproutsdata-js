/** New vocabulary (S7), and every filter rule the server applies, applied first. */

import { describe, expect, it } from 'vitest';

import { checkKeywordTree } from '../../src/requests/filters.js';
import { searchBody } from '../../src/requests/search.js';
import { Search } from '../../src/resources/search.js';
import type { SearchParams } from '../../src/types/index.js';
import { assertValidRequest, recorded } from '../support/answers.js';
import { rig } from '../support/rig.js';

const COMPANY = { category: 'company', query: 'x' } as const;
const PATENT = { category: 'patent', query: 'x' } as const;

const REFUSED: readonly [string, object, object, string][] = [
  ['range', COMPANY, { revenue: {} }, 'filters.revenue: requires at least one of gte or lte'],
  ['order', COMPANY, { revenue: { gte: 9, lte: 1 } }, 'gte (9) must not exceed lte (1)'],
  ['preset', COMPANY, { last_funding_date: { preset: 'last_30_days', gte: '2024-01-01' } }, 'preset cannot be combined'],
  ['bound', COMPANY, { last_job_changed: {} }, 'requires a preset, or at least one of gte/lte'],
  ['terms', COMPANY, { industry: {} }, 'requires at least one value in include or exclude'],
  ['text', COMPANY, { title: {} }, 'filters.title: requires at least one value'],
  ['entity', COMPANY, { company: {} }, 'filters.company: requires at least one entry'],
  ['presence', COMPANY, { global_presence: {} }, 'requires at least one of countries, gte, lte'],
  ['countries', COMPANY, { global_presence: { countries: ['deu'], min_countries: 2 } }, 'min_countries counts countries anywhere'],
  ['headcount', COMPANY, { employee_by_department: { bounds: [{ department: 'e', min: 9, max: 1 }] } }, 'min (9) must not exceed max (1)'],
  ['headcount bound', COMPANY, { employee_by_department: { bounds: [{ department: 'e' }] } }, 'requires at least one of min or max'],
  ['group', COMPANY, { employment_history: { groups: [{}] } }, 'requires at least one attribute'],
  ['keywords', COMPANY, { keywords: { target_fields: ['name'] } }, 'or a keyword_tree'],
  ['tree', COMPANY, { keywords: { target_fields: ['name'], keyword_tree: { and: [] } } }, 'keywords.keyword_tree.and: takes a non-empty list'],
  ['keyword set', PATENT, { keywords: { positive: { sets: [{ keywords: [' '] }] } } }, 'keyword set requires at least one entry'],
  ['one set', { category: 'market_report' }, { keywords: { positive: { sets: [{ keywords: ['a'] }, { keywords: ['b'] }] } } }, 'exactly one positive keyword set'],
  ['period', PATENT, { publication_date: {} }, 'at least one of period or last_updated'],
  ['groups', PATENT, { keywords: {} }, 'at least one of positive or negative'],
  ['applicants', PATENT, { applicants: {} }, 'requires at least one entry in include or exclude'],
];

describe('filter rules', () => {
  it.each(REFUSED)('S7: %s is refused as the server refuses it', (_, base, filters, reason) => {
    expect(() => searchBody({ ...base, filters })).toThrow(reason);
  });

  it.each([
    [{ not: { not: { not: { not: { not: { not: 'deep' } } } } } }, 'nested deeper than 6'],
    ['x'.repeat(101), 'at most 100 characters'],
    [{ and: ['a'], or: ['b'] }, 'a node is a keyword or one of'],
    [{ xor: ['a'] }, 'a node is a keyword or one of'],
    [{ or: 'a' }, 'keyword_query.or: takes a non-empty list'],
    [{ or: Array.from({ length: 101 }, (_, i) => `k${String(i)}`) }, 'at most 100 keywords'],
  ])('S3: the keyword tree has the server shape and limits (%#)', (tree, reason) => {
    expect(() => {
      checkKeywordTree('search', tree);
    }).toThrow(reason);
  });

  it('S7: bounds that hold pass', () => {
    const filters = {
      revenue: { lte: 5 },
      last_funding_date: { preset: 'last_30_days' },
      global_presence: { min_countries: 3 },
      employee_by_department: { bounds: [{ department: 'e', min: 1, max: 9 }] },
      employment_history: { groups: [{ tenure_gte: 2 }] },
      keywords: { target_fields: ['name'], keyword_tree: { or: ['a', { not: 'b' }] } },
    };
    expect(searchBody({ ...COMPANY, filters } as SearchParams)).toMatchObject({ filters });
    checkKeywordTree('search', '  a  keyword ');
  });

  it('S7: new filters, keyword fields and sort fields are sent as the server reads them', async () => {
    const r = rig([recorded('search', 'company'), recorded('search', 'patent'), recorded('search', 'company'), recorded('search', 'company')]);
    const search = new Search(r.transport);
    await search.search({
      query: 'x',
      filters: {
        hiring_salary: { gte: 50_000 },
        hiring_employment_type: { include: ['full_time'] },
        keywords: { include: ['robots'], target_fields: ['name', 'description'], mode: 'rank_first', keyword_tree: { and: ['robots', { not: 'toys' }] } },
      },
      sort: [{ field: 'employee_range' }, { field: 'location', direction: 'asc' }],
    });
    await search.search({
      category: 'patent',
      filters: { keywords: { positive: { sets: [{ keywords: ['battery'], qualifiers: ['solid'] }] }, negative: { sets: [{ keywords: ['toy'], boost: 0.5 }] } } },
      sort: [{ field: 'publication_date' }],
    });
    await search.search({ query: 'x', sort: [{ field: 'other_industries' }] });
    await search.search({ category: 'person', query: 'x', sort: [{ field: 'title' }, { field: 'sub_department' }] });
    for (const index of [0, 1, 2, 3]) assertValidRequest('search', r.body(index));
    expect((r.body(1) as { filters: { keywords: { negative: { sets: { boost: number }[] } } } }).filters.keywords.negative.sets[0]?.boost).toBe(0.5);
  });
});

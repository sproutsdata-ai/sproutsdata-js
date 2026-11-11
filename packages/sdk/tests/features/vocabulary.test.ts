/** Filter values, sort fields and coverage: the free catalogues (F1-F3, T1, C1-C2). */

import { describe, expect, it } from 'vitest';

import { Coverage } from '../../src/resources/coverage.js';
import { totalFor } from '../../src/resources/helpers.js';
import { Vocabulary } from '../../src/resources/vocabulary.js';
import type { CoverageResponse } from '../../src/types/index.js';
import { recorded, recordedBody, respond } from '../support/answers.js';
import { collect, rig } from '../support/rig.js';

const INDUSTRY = recordedBody('filter_values', 'industry');

describe('filter values', () => {
  it('F1: items are null for every filter but company', async () => {
    const company = { ...INDUSTRY, filter: 'company', has_more: false, values: ['stripe.com'], items: [{ value: 'stripe.com', name: 'Stripe', domain: 'stripe.com' }] };
    const r = rig([recorded('filter_values', 'industry'), respond('filter_values', 200, company)]);
    const vocabulary = new Vocabulary(r.transport);
    const industry = await vocabulary.filterValues('industry');
    const companies = await vocabulary.filterValues('company', { search: 'stri' });
    expect(industry.items).toBeNull();
    expect(companies.items?.[0]).toEqual({ value: 'stripe.com', name: 'Stripe', domain: 'stripe.com' });
    expect(r.query(1)).toEqual({ search: 'stri' });
  });

  it('F2: values have no id, and two-level filters take parent and level', async () => {
    const r = rig([respond('filter_values', 200, { ...INDUSTRY, parent: 'Software', level: 'children' })]);
    const vocabulary = new Vocabulary(r.transport);
    const answer = await vocabulary.filterValues('industry', { parent: 'Software', level: 'children', page: 2 });
    expect([answer.parent, answer.level]).toEqual(['Software', 'children']);
    expect(r.query()).toEqual({ parent: 'Software', level: 'children', page: '2' });
    await expect(vocabulary.filterValues('industry', { page: 0 })).rejects.toThrow('page must be an integer between 1 and 10000');
    await expect(vocabulary.filterValues('industry', { search: 'x'.repeat(201) })).rejects.toThrow('search must be 1 to 200');
  });

  it('F3: document filters page by number until the last page', async () => {
    const first = recordedBody('document_filter_values', 'patent_offices');
    const last = { ...first, page: 2, has_more: false, values: ['EP'] };
    const r = rig([respond('document_filter_values', 200, first), respond('document_filter_values', 200, last), recorded('document_filter_values', 'patent_offices')]);
    const vocabulary = new Vocabulary(r.transport);
    const values = await collect(vocabulary.iterDocumentFilterValues('patent', 'offices'));
    const one = await vocabulary.documentFilterValues('patent', 'offices', { search: 'E', page: 1 });
    expect(values).toHaveLength(21);
    expect(values.at(-1)).toBe('EP');
    expect(r.sent[0]?.url.pathname).toMatch(/\/v1\/search\/filters\/patent\/offices$/);
    expect([r.query(0), r.query(1), r.query(2)]).toEqual([{}, { page: '2' }, { search: 'E', page: '1' }]);
    expect(one.filter).toBe('offices');
  });

  it('F3: company filter values walk and stop at maxResults', async () => {
    const r = rig([recorded('filter_values', 'industry')]);
    const values = await collect(new Vocabulary(r.transport).iterFilterValues('industry', { maxResults: 3 }));
    expect(values).toEqual(['Industry value 0', 'Industry value 1', 'Industry value 2']);
    expect(r.sent).toHaveLength(1);
  });
});

describe('sorts and coverage', () => {
  it('T1: sorts have a default direction and no axis', async () => {
    const r = rig([recorded('sorts', 'company')]);
    const answer = await new Vocabulary(r.transport).sorts('company');
    expect(['asc', 'desc']).toContain(answer.sorts[0]?.default_direction);
    expect(answer.sorts[0]).not.toHaveProperty('applies_to');
    expect(r.sent[0]?.url.pathname).toMatch(/\/v1\/sorts\/company$/);
  });

  it('C1: segments carry their source corpus and no freshness', async () => {
    const r = rig([recorded('coverage', 'all')]);
    const answer = await new Coverage(r.transport).coverage({ category: 'person' });
    expect(answer.as_of).toBeTruthy();
    expect(answer.segments.every((s) => s.source_corpus !== '' && !('freshest' in s))).toBe(true);
    expect(r.query()).toEqual({ category: 'person' });
  });

  it('C2: totalFor does not count people twice', () => {
    const coverage = recordedBody<CoverageResponse>('coverage', 'all');
    const people = coverage.segments.filter((s) => s.category === 'person' && s.name !== 'affiliations').reduce((sum, s) => sum + s.total, 0);
    expect(totalFor(coverage, 'person')).toBe(people);
    expect(coverage.segments.some((s) => s.name === 'affiliations')).toBe(true);
    expect(totalFor(coverage, 'galaxy')).toBe(0);
  });
});

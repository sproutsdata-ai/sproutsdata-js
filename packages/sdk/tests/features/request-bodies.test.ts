/**
 * A body the SDK builds for each operation fits the operation's request schema. The request
 * types are generated from the same schema; this guards what each builder maps and leaves out.
 */

import { describe, it } from 'vitest';

import { companyBody, documentBody, namedDocumentBody, personBody } from '../../src/requests/entities.js';
import { peopleBody } from '../../src/requests/org-chart.js';
import { runBody } from '../../src/requests/runs.js';
import { searchBody, similarBody } from '../../src/requests/search.js';
import type { SearchParams } from '../../src/types/index.js';
import { assertValidRequest } from '../support/answers.js';

const SEARCHES: readonly SearchParams[] = [
  { category: 'auto', query: 'robotics in Germany', mode: 'auto', limit: 5 },
  { category: 'company', query: 'x', mode: 'fast' },
  { category: 'company', keyword_query: { or: ['a', 'b'] }, sort: [{ field: 'revenue' }] },
  { category: 'person', filters: { seniority: { include: ['VP'] } }, exclude_domains: ['a.de'] },
  { category: 'patent', filters: { offices: { include: ['EP'] }, status: 'granted' } },
  { category: 'academic_report', query: 'x', sort: [{ field: 'citations' }] },
  { category: 'news_article', query: 'x' },
  { category: 'market_report', filters: { keywords: { positive: { sets: [{ keywords: ['ai'] }] } } } },
  { category: 'trend', query: 'x' },
  { category: 'trend', filters: { topic: { or: ['ai', 'ml'] }, growth: ['Strong'] } },
  { category: 'funding_round', filters: { investors: { include: [{ value: 'a16z.com' }], match_all: true } } },
  { category: 'funding_round', query: 'x', cursor: 'c' },
  { category: 'job_opening', include_domains: ['stripe.com'], filters: { salary: { gte: 1 } } },
];

describe('request bodies', () => {
  it.each(SEARCHES)('search builds a valid $category body', (params) => {
    assertValidRequest('search', searchBody(params));
  });

  it('every lookup builds a valid body', () => {
    assertValidRequest('entities_companies', companyBody('c', { ids: ['a.de'] }));
    assertValidRequest('entities_persons', personBody('p', { ids: ['https://linkedin.com/in/x'], by: 'li_url' }));
    for (const op of ['entities_patents', 'entities_trends', 'entities_academic_reports']) assertValidRequest(op, documentBody(op, { ids: ['d1_x'], fields: ['title'] }));
    for (const op of ['entities_news', 'entities_market_reports', 'entities_fundings', 'entities_job_openings']) assertValidRequest(op, namedDocumentBody(op, { ids: ['d1_x'], by: 'id' }));
  });

  it('a people body is valid', () => {
    assertValidRequest('org_chart_people', peopleBody('orgChart.people', { company_ref: 'd1_x', cell: { department: 'sales' }, limit: 5, cursor: 'c' }));
  });

  it('similar and runs build valid bodies', () => {
    assertValidRequest('similar', similarBody({ anchors: ['a.de', { value: 'B', by: 'name', weight: 0.5 }], combine: 'or', filters: { industry: { include: ['x'] } } }));
    assertValidRequest('runs_create', runBody({ query: 'x', category: 'person', effort: 'auto', criteria: ['c'], enrichments: ['e'], exclusion: ['a.de'] }));
  });
});

/**
 * The bodies of `POST /v1/search` and `POST /v1/similar`, checked as the server checks them.
 *
 * The category picks the body's type (the route's body is a union on `category`); the body is
 * checked against that type (`shape.ts`) and then against the server's cross-field rules, each
 * citing the dsp-backend validator it mirrors (`be` = dsp-backend `src/dsp/features/`).
 */

import type * as W from '../generated/wire.js';
import type { AnchorParam, DocumentSearchParams, SearchParams, SimilarParams } from '../types/index.js';
import { isObject, present, refuse } from './build.js';
import { checkKeywordTree } from './filters.js';
import { checkShape } from './shape.js';

const WHAT = 'search';

/** The body type of each category (`auto`: prism picks the category from the question). */
const TYPES: Readonly<Record<string, string>> = {
  auto: 'AutoSearchRequest',
  company: 'EntitySearchRequest',
  person: 'EntitySearchRequest',
  patent: 'PatentSearchRequest',
  academic_report: 'AcademicReportSearchRequest',
  news_article: 'NewsSearchRequest',
  market_report: 'MarketReportSearchRequest',
  trend: 'TrendSearchRequest',
  funding_round: 'FundingSearchRequest',
  job_opening: 'JobOpeningSearchRequest',
};
const AUTO_FIELDS = new Set(['category', 'query', 'mode', 'limit', 'cursor']);
const DOMAIN_CATEGORIES = new Set(['company', 'person', 'job_opening']);
// be search/schemas/sorts.py:69 (COMPANY_ONLY) and :90 (PERSON_ONLY), prism's split.
const COMPANY_ONLY_SORTS = new Set(['domain', 'revenue', 'employee_count', 'employee_range', 'founded_year', 'linkedin_followers', 'total_funding', 'last_funding_amount', 'last_funding_date', 'funding_stage', 'industry', 'primary_industry', 'sub_industry', 'other_industries', 'global_presence']);
const PERSON_ONLY_SORTS = new Set(['contact_name', 'job_title', 'title', 'department', 'division', 'sub_department', 'employment_type', 'linkedin_connections', 'tenure', 'seniority']);
// be search/schemas/documents/patents.py:32: a patent's `status` defaults to every patent.
const NOT_NARROWING: Readonly<Record<string, readonly string[]>> = { patent: ['status'] };
// be search/schemas/request.py:80 (NO_DEEP): `deep` gets its own reason, not a list of modes.
const NO_DEEP = '`deep` search is no longer offered: start an agent run (`runs.create`) to have an agent work a question out, or search with `mode` `fast` or `auto`';

/** The search body for `params` (`category` defaults to `company`), checked locally. */
export function searchBody(params: SearchParams): W.SearchBody {
  const body: W.SearchBody = params.category === undefined ? { ...params, category: 'company' } : params;
  const category = body.category ?? 'auto';
  const type = TYPES[category];
  if (type === undefined) refuse(WHAT, `category must be one of ${Object.keys(TYPES).join(', ')} (got ${JSON.stringify(category)})`);
  const mode: unknown = body.mode; // a caller without types may still send the retired mode
  if (mode === 'deep') refuse(WHAT, NO_DEEP);
  const given = new Set(Object.entries(body).flatMap(([name, value]) => (value === undefined ? [] : [name])));
  if (category === 'auto') checkAutoFields(given, body.mode);
  else checkDocumentFields(category, given);
  checkShape(WHAT, body, type);
  if (body.category === 'company' || body.category === 'person') checkEntitySearch(body);
  else if (isDocument(body)) checkDocumentSearch(body);
  return body;
}

/** The look-alike body for `params` (a bare-string anchor is a domain), checked locally. */
export function similarBody(params: SimilarParams): W.SimilarRequest {
  if (typeof params.anchors === 'string') refuse('similar', 'anchors must be a list of anchors');
  const category: unknown = params.category; // a caller without types may send any
  if (category !== undefined && category !== 'company') {
    refuse('similar', `category must be 'company': look-alikes are companies (got ${JSON.stringify(category)})`); // be search/schemas/similar.py:56
  }
  const body: W.SimilarRequest = { ...params, anchors: params.anchors.map(anchor) };
  checkShape('similar', body, 'SimilarRequest');
  return body;
}

function anchor(value: AnchorParam): W.Anchor {
  return typeof value === 'string' ? { value } : value;
}

function checkAutoFields(given: ReadonlySet<string>, mode: string | undefined): void {
  const extra = [...given].filter((name) => !AUTO_FIELDS.has(name)).sort();
  if (extra.length > 0) {
    refuse(WHAT, `category 'auto' takes only query, mode, limit and cursor (got ${extra.join(', ')}): prism picks the category from the question, and filters, sort and domains belong to one category; name it to send them`);
  }
  if (mode !== undefined && mode !== 'auto') {
    refuse(WHAT, 'a search with no category is read by prism, so it runs in `auto` mode only; send a `category` to search in `fast` mode'); // be search/schemas/auto.py:39
  }
}

function checkDocumentFields(category: string, given: ReadonlySet<string>): void {
  if (category === 'company' || category === 'person') return;
  if (given.has('keyword_query')) refuse(WHAT, `keyword_query searches company text: set category 'company' (got ${JSON.stringify(category)})`);
  const domains = ['exclude_domains', 'include_domains'].filter((name) => given.has(name));
  if (domains.length > 0 && !DOMAIN_CATEGORIES.has(category)) {
    refuse(WHAT, `${domains.join(' and ')} narrow company, person and job_opening searches only (got category ${JSON.stringify(category)})`);
  }
}

function isDocument(body: W.SearchBody): body is DocumentSearchParams {
  return body.category !== undefined && body.category !== 'auto' && body.category !== 'company' && body.category !== 'person';
}

/** The company and person rules (be search/schemas/request.py:222-266). */
function checkEntitySearch(body: W.EntitySearchRequest): void {
  checkIntent(body);
  if (present(body.keyword_query)) checkKeywords(body);
  checkSortFits(body);
  checkDomains(body.include_domains, body.exclude_domains, body.filters?.company);
}

/** One way of saying what to find (be search/schemas/request.py:160). */
function checkIntent(body: W.EntitySearchRequest): void {
  const query = present(body.query);
  const keywords = present(body.keyword_query);
  if (!query && !keywords && !present(body.filters)) refuse(WHAT, 'provide `query`, `keyword_query` or `filters`');
  if (query && keywords) refuse(WHAT, 'send `query` or `keyword_query`, not both');
}

function checkKeywords(body: W.EntitySearchRequest): void {
  if (body.category !== 'company') {
    refuse(WHAT, `\`keyword_query\` searches company text: set \`category: company\` (got ${body.category}); on a person search, use \`query\` or the \`keywords\` filter`);
  }
  checkKeywordTree(WHAT, body.keyword_query);
}

function checkSortFits(body: W.EntitySearchRequest): void {
  const sort = (body.sort ?? []).map((clause) => clause.field);
  checkDuplicates(sort);
  const other = body.category === 'company' ? PERSON_ONLY_SORTS : COMPANY_ONLY_SORTS;
  const misplaced = sort.filter((field) => other.has(field)).sort();
  if (misplaced.length > 0) refuse(WHAT, `sort: ${misplaced.join(', ')} cannot order a ${body.category} search`);
}

/** A document category's rules (be search/schemas/documents/base.py:35-39, 64-85). */
function checkDocumentSearch(body: DocumentSearchParams): void {
  if (body.category === 'job_opening') checkDomains(body.include_domains, body.exclude_domains, body.filters?.company);
  if (!present(body.query) && !narrowed(body)) refuse(WHAT, 'provide `query`, or `filters` that narrow the search');
  checkDuplicates((body.sort ?? []).map((clause) => clause.field));
}

/** Whether something besides words narrows a document search. */
function narrowed(body: DocumentSearchParams): boolean {
  const ignored = NOT_NARROWING[body.category] ?? [];
  const filters = Object.entries(body.filters ?? {}).some(([name, value]) => intent(value) && !ignored.includes(name));
  // be documents/job_openings.py:108: a domain list narrows a job search on its own.
  const domains = body.category === 'job_opening' && [...(body.include_domains ?? []), ...(body.exclude_domains ?? [])].length > 0;
  return filters || domains;
}

/**
 * Whether a filter's value is search intent (be documents/base.py `DocumentFilters.narrows`): an
 * empty list or object is none, as prism's `require_intent` reads it.
 */
function intent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return isObject(value) ? Object.values(value).some((entry) => entry !== undefined) : present(value);
}

function checkDuplicates(fields: readonly string[]): void {
  const duplicates = [...new Set(fields.filter((field, index) => fields.indexOf(field) !== index))].sort(); // be request.py:197
  if (duplicates.length > 0) refuse(WHAT, `sort: duplicate field(s) ${duplicates.join(', ')}`);
}

function checkDomains(include: readonly string[] | undefined, exclude: readonly string[] | undefined, company: unknown): void {
  // be search/schemas/request.py:224, documents/job_openings.py:113
  const domains = [...(include ?? []), ...(exclude ?? [])];
  if (domains.length > 0 && present(company)) {
    refuse(WHAT, '`include_domains`/`exclude_domains` and a `company` filter are two ways to say the same thing; send one');
  }
  if (domains.some((domain) => domain.trim() === '')) refuse(WHAT, 'a domain cannot be blank');
}

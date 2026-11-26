/**
 * The bodies of `POST /v1/search` and `POST /v1/similar`, checked as the server checks them.
 *
 * The category picks the body's type (the route's body is a union on `category`); the body is
 * checked against that type (`shape.ts`) and then against the server's cross-field rules: each
 * rule is the API's own for the request schema it names (as in `spec/openapi.json`).
 */

import type * as W from '../generated/wire.js';
import type { AnchorParam, DocumentSearchParams, SearchParams, SimilarParams } from '../types/index.js';
import { isObject, present, refuse } from './build.js';
import { checkKeywordTree } from './filters.js';
import { checkShape } from './shape.js';

const WHAT = 'search';

/** The body type of each category (`auto`: the API picks the category from the question). */
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
const AUTO_FIELDS = new Set(['category', 'query', 'mode', 'partial_matches', 'fields', 'limit', 'cursor']);
const DOMAIN_CATEGORIES = new Set(['company', 'person', 'job_opening']);
// The sort fields that order only one of the two entity categories (API: `SortClause`).
const COMPANY_ONLY_SORTS = new Set(['domain', 'revenue', 'employee_count', 'employee_range', 'founded_year', 'linkedin_followers', 'total_funding', 'last_funding_amount', 'last_funding_date', 'funding_stage', 'industry', 'primary_industry', 'sub_industry', 'other_industries', 'global_presence']);
const PERSON_ONLY_SORTS = new Set(['contact_name', 'job_title', 'title', 'department', 'division', 'sub_department', 'employment_type', 'linkedin_connections', 'tenure', 'seniority']);
// A patent's `status` defaults to every patent, so naming it alone narrows nothing.
const NOT_NARROWING: Readonly<Record<string, readonly string[]>> = { patent: ['status'] };
// Spaces alone name nothing to search, and the API refuses them (API: the `query` of every search
// body), with these words. An unchecked one would be charged for the whole index.
const BLANK_QUERY = '`query` cannot be blank; send words, or leave it out';
const BLANK_AUTO_QUERY = '`query` cannot be blank; send the question in words';
// The API trims a query as Python's `str.strip` does, so blank means Python's whitespace (U+001C to
// U+001F and U+0085 included, U+FEFF not), not `String.prototype.trim`'s.
const PYTHON_WHITESPACE: ReadonlySet<string> = new Set([
  ...'\t\n\v\f\r \u001c\u001d\u001e\u001f\u0085\u00a0\u1680\u2028\u2029\u202f\u205f\u3000'.split(''),
  ...Array.from({ length: 11 }, (_, i) => String.fromCharCode(0x2000 + i)),
]);

function isBlank(text: string): boolean {
  for (const char of text) if (!PYTHON_WHITESPACE.has(char)) return false;
  return true;
}
// `deep` gets its own reason, as the API gives it, not a list of the modes left.
const NO_DEEP = '`deep` search is no longer offered: start an agent run (`runs.create`) to have an agent work a question out, or search with `mode` `fast` or `auto`';

/** The search body for `params` (`category` defaults to `company`), checked locally. */
export function searchBody(params: SearchParams): W.SearchBody {
  const body: W.SearchBody = params.category === undefined ? { ...params, category: 'company' } : params;
  const [category, type] = categoryOf(body);
  const mode: unknown = body.mode; // a caller without types may still send the retired mode
  if (mode === 'deep') refuse(WHAT, NO_DEEP);
  const given = new Set(Object.entries(body).flatMap(([name, value]) => (value === undefined ? [] : [name])));
  if (category === 'auto') checkAutoFields(given, body.mode);
  else checkDocumentFields(category, given);
  checkShape(WHAT, body, type);
  if (typeof body.query === 'string' && isBlank(body.query)) refuse(WHAT, category === 'auto' ? BLANK_AUTO_QUERY : BLANK_QUERY);
  if (body.category === 'company' || body.category === 'person') checkEntitySearch(body);
  else if (isDocument(body)) checkDocumentSearch(body);
  return body;
}

/** The body's category and the request type it picks; refused if it names none (null included). */
function categoryOf(body: W.SearchBody): [string, string] {
  const category: unknown = body.category; // a caller without types may send null, which the API refuses
  const type = typeof category === 'string' ? TYPES[category] : undefined;
  if (type === undefined || typeof category !== 'string') {
    refuse(WHAT, `category must be one of ${Object.keys(TYPES).join(', ')} (got ${JSON.stringify(category)})`);
  }
  return [category, type];
}

/** The look-alike body for `params` (a bare-string anchor is a domain), checked locally. */
export function similarBody(params: SimilarParams): W.SimilarRequest {
  if (typeof params.anchors === 'string') refuse('similar', 'anchors must be a list of anchors');
  const category: unknown = params.category; // a caller without types may send any
  if (category !== undefined && category !== 'company') {
    refuse('similar', `category must be 'company': look-alikes are companies (got ${JSON.stringify(category)})`); // API: SimilarRequest.category
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
    refuse(WHAT, `category 'auto' takes only query, mode, partial_matches, fields, limit and cursor (got ${extra.join(', ')}): the API picks the category from the question, and filters, sort and domains belong to one category; name it to send them`);
  }
  if (mode !== undefined && mode !== 'auto') {
    refuse(WHAT, 'a search with no category is read by the API, so it runs in `auto` mode only; send a `category` to search in `fast` mode'); // API: AutoSearchRequest.mode
  }
}

function checkDocumentFields(category: string, given: ReadonlySet<string>): void {
  if (category === 'company' || category === 'person') return;
  if (given.has('keyword_query')) refuse(WHAT, `keyword_query searches company text: set category 'company' (got ${JSON.stringify(category)})`);
  if (given.has('partial_matches')) {
    // API: the document search bodies have no `partial_matches`.
    refuse(WHAT, `partial_matches is for company and person searches: a document matches its query or does not (got category ${JSON.stringify(category)})`);
  }
  const domains = ['exclude_domains', 'include_domains'].filter((name) => given.has(name));
  if (domains.length > 0 && !DOMAIN_CATEGORIES.has(category)) {
    refuse(WHAT, `${domains.join(' and ')} narrow company, person and job_opening searches only (got category ${JSON.stringify(category)})`);
  }
}

function isDocument(body: W.SearchBody): body is DocumentSearchParams {
  return body.category !== undefined && body.category !== 'auto' && body.category !== 'company' && body.category !== 'person';
}

/** The company and person rules (API: `EntitySearchRequest`). */
function checkEntitySearch(body: W.EntitySearchRequest): void {
  checkIntent(body);
  if (present(body.keyword_query)) checkKeywords(body);
  checkSortFits(body);
  checkDomains(body.include_domains, body.exclude_domains, body.filters?.company);
}

/** One way of saying what to find (API: `EntitySearchRequest`). */
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

/** A document category's rules (API: each `<Category>SearchRequest`). */
function checkDocumentSearch(body: DocumentSearchParams): void {
  if (body.category === 'job_opening') checkDomains(body.include_domains, body.exclude_domains, body.filters?.company);
  if (!present(body.query) && !narrowed(body)) refuse(WHAT, 'provide `query`, or `filters` that narrow the search');
  checkDuplicates((body.sort ?? []).map((clause) => clause.field));
}

/** Whether something besides words narrows a document search. */
function narrowed(body: DocumentSearchParams): boolean {
  const ignored = NOT_NARROWING[body.category] ?? [];
  const filters = Object.entries(body.filters ?? {}).some(([name, value]) => intent(value) && !ignored.includes(name));
  // A domain list narrows a job search on its own (API: `JobOpeningSearchRequest`).
  const domains = body.category === 'job_opening' && [...(body.include_domains ?? []), ...(body.exclude_domains ?? [])].length > 0;
  return filters || domains;
}

/**
 * Whether a filter's value is search intent, as the API decides it: an empty list or object is
 * none.
 */
function intent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return isObject(value) ? Object.values(value).some((entry) => entry !== undefined) : present(value);
}

function checkDuplicates(fields: readonly string[]): void {
  const duplicates = [...new Set(fields.filter((field, index) => fields.indexOf(field) !== index))].sort();
  if (duplicates.length > 0) refuse(WHAT, `sort: duplicate field(s) ${duplicates.join(', ')}`);
}

function checkDomains(include: readonly string[] | undefined, exclude: readonly string[] | undefined, company: unknown): void {
  // API: EntitySearchRequest and JobOpeningSearchRequest, which take domains.
  const domains = [...(include ?? []), ...(exclude ?? [])];
  if (domains.length > 0 && present(company)) {
    refuse(WHAT, '`include_domains`/`exclude_domains` and a `company` filter are two ways to say the same thing; send one');
  }
  if (domains.some((domain) => domain.trim() === '')) refuse(WHAT, 'a domain cannot be blank');
}

/**
 * The filter rules a schema cannot state: "at least one of", "not both", "low before high".
 *
 * Each mirrors one of dsp-backend's validators (`be` = dsp-backend `src/dsp/features/`), keyed
 * by the request type it applies to, as sproutsdata-py's `types/requests/filters.py` keys them.
 * `checkShape` applies the rule of every part of a body; the keyword tree has its own walk.
 */

import { isObject, refuse } from './build.js';

/** A rule: the reason a part is refused, or `undefined` when it passes. */
export type Rule = (part: Readonly<Record<string, unknown>>) => string | undefined;

const MAX_TREE_DEPTH = 6;
const MAX_TREE_KEYWORDS = 100;
const MAX_KEYWORD_CHARS = 100;
const OPERATORS = new Set(['and', 'or', 'not']);
const NODE_SHAPE = 'a keyword or one of {"and": [...]}, {"or": [...]}, {"not": ...}';

const set = (value: unknown): boolean => value !== undefined && value !== null;
const filled = (value: unknown): boolean => (Array.isArray(value) ? value.length > 0 : isObject(value) || set(value));

function either(names: readonly string[], reason: string): Rule {
  return (part) => (names.some((name) => filled(part[name])) ? undefined : reason);
}

function ordered(low: string, high: string): Rule {
  return (part) => {
    const lo = part[low];
    const hi = part[high];
    return typeof lo === 'number' && typeof hi === 'number' && lo > hi ? `${low} (${String(lo)}) must not exceed ${high} (${String(hi)})` : undefined;
  };
}

const range: Rule = (part) => (!set(part['gte']) && !set(part['lte']) ? 'requires at least one of gte or lte' : ordered('gte', 'lte')(part)); // be search/schemas/filter_values.py:73

const dateBound: Rule = (part) => {
  // be search/schemas/filter_values.py:108
  const explicit = set(part['gte']) || set(part['lte']);
  if (set(part['preset']) && explicit) return 'preset cannot be combined with gte/lte; use one or the other';
  return !set(part['preset']) && !explicit ? 'requires a preset, or at least one of gte/lte' : undefined;
};

const headcount: Rule = (part) => (!set(part['min']) && !set(part['max']) ? 'requires at least one of min or max' : ordered('min', 'max')(part)); // be filter_values.py:233

const presence: Rule = (part) => {
  // be filter_values.py:274
  const countries = filled(part['countries']);
  if (!countries && !['gte', 'lte', 'min_countries'].some((name) => set(part[name]))) return 'requires at least one of countries, gte, lte or min_countries';
  return countries && set(part['min_countries']) ? 'min_countries counts countries anywhere; it cannot be combined with countries' : undefined;
};

const group: Rule = (part) =>
  // be filter_values.py:351
  ['company', 'title', 'role_started', 'role_ended'].some((name) => filled(part[name])) || set(part['tenure_gte']) || set(part['tenure_lte'])
    ? undefined
    : 'requires at least one attribute';

const keywordSet: Rule = (part) => {
  // be search/schemas/document_values.py:61,69: blank entries are dropped before counting.
  const entries: readonly unknown[] = [part['keywords'], part['qualifiers']].flatMap((list): readonly unknown[] => (Array.isArray(list) ? list : []));
  return entries.some((entry) => typeof entry === 'string' && entry.trim() !== '') ? undefined : 'a keyword set requires at least one entry in keywords or qualifiers';
};

const singleSet: Rule = (part) => {
  // be document_values.py:129
  const positive = part['positive'];
  const count = isObject(positive) && Array.isArray(positive['sets']) ? positive['sets'].length : 0;
  return count === 1 ? undefined : `market reports take exactly one positive keyword set (got ${String(count)})`;
};

const anyField: Rule = (part) => (Object.values(part).some(set) ? undefined : 'filters, when provided, must contain at least one filter'); // be filters.py:120, documents/base.py:27

const companyKeywords: Rule = (part) => {
  // be filter_values.py:325
  if (filled(part['include']) || filled(part['exclude']) || set(part['keyword_tree'])) return undefined;
  return 'requires at least one value in include or exclude, or a keyword_tree';
};

const VALUES = 'requires at least one value in include or exclude';
const DOCUMENT_FILTERS = ['PatentFilters', 'AcademicReportFilters', 'NewsFilters', 'MarketReportFilters', 'TrendFilters', 'FundingFilters', 'JobOpeningFilters'];

/** The rule each request type is checked against, by its name. */
export const RULES: Readonly<Record<string, Rule>> = {
  TermsFilter: either(['include', 'exclude', 'include_groups'], VALUES), // be filter_values.py:53
  TextFilter: either(['include', 'exclude'], VALUES), // be filter_values.py:168
  EntityFilter: either(['include', 'exclude'], 'requires at least one entry in include or exclude'), // be filter_values.py:147
  MatchAllEntityFilter: either(['include', 'exclude'], 'requires at least one entry in include or exclude'), // be filter_values.py:154, an EntityFilter
  RangeFilter: range,
  DateBound: dateBound,
  DepartmentHeadcountBound: headcount,
  GlobalPresenceFilter: presence,
  CompanyKeywordsFilter: companyKeywords,
  EmploymentHistoryGroup: group,
  DateFilter: either(['period', 'last_updated'], 'requires at least one of period or last_updated'), // be document_values.py:33
  KeywordSet: keywordSet,
  NegativeKeywordSet: keywordSet,
  KeywordQuery: either(['positive', 'negative'], 'keywords requires at least one of positive or negative'), // be document_values.py:115
  SingleSetKeywordQuery: singleSet,
  DiscoverFilters: anyField,
  ...Object.fromEntries(DOCUMENT_FILTERS.map((name) => [name, anyField])),
};

/** The field of a request type that holds a keyword tree, by the type's name. */
export const KEYWORD_TREES: Readonly<Record<string, string>> = {
  CompanyKeywordsFilter: 'keyword_tree',
  ...Object.fromEntries(DOCUMENT_FILTERS.map((name) => [name, 'topic'])), // be search/schemas/keyword_query.py:70
};

/**
 * A keyword tree the server accepts (be search/schemas/keyword_query.py:35): a keyword or one
 * operator, at most 6 levels deep, with at most 100 keywords of at most 100 characters each.
 */
export function checkKeywordTree(what: string, tree: unknown, path = 'keyword_query'): void {
  let count = 0;
  const walk = (node: unknown, at: string, depth: number): void => {
    if (depth > MAX_TREE_DEPTH) refuse(what, `${at}: the tree is nested deeper than ${String(MAX_TREE_DEPTH)} levels`);
    if (typeof node === 'string') {
      checkKeyword(what, node, at);
      count += 1;
      return;
    }
    const [op, arg] = operator(what, node, at);
    if (op === 'not') {
      walk(arg, `${at}.not`, depth + 1);
      return;
    }
    if (!Array.isArray(arg) || arg.length === 0) refuse(what, `${at}.${op}: takes a non-empty list of nodes`);
    arg.forEach((child, index) => {
      walk(child, `${at}.${op}[${String(index)}]`, depth + 1);
    });
  };
  walk(tree, path, 1);
  if (count > MAX_TREE_KEYWORDS) refuse(what, `${path}: at most ${String(MAX_TREE_KEYWORDS)} keywords (got ${String(count)})`);
}

function operator(what: string, node: unknown, at: string): [string, unknown] {
  const entries = isObject(node) ? Object.entries(node) : [];
  const [first] = entries;
  if (first === undefined || entries.length !== 1 || !OPERATORS.has(first[0])) refuse(what, `${at}: a node is ${NODE_SHAPE}`);
  return first;
}

function checkKeyword(what: string, node: string, at: string): void {
  const keyword = node.split(/\s+/).filter(Boolean).join(' ');
  if (keyword === '') refuse(what, `${at}: a keyword cannot be blank`);
  if (keyword.length > MAX_KEYWORD_CHARS) refuse(what, `${at}: a keyword is at most ${String(MAX_KEYWORD_CHARS)} characters`);
}

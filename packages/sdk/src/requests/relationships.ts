/**
 * The bodies of `/v1/relationships`, `/reach`, `/institutions` and `/ask`, checked as the server
 * checks them: each rule is the API's own for the request schema it names (as in
 * `spec/openapi.json`).
 */

import type * as W from '../generated/wire.js';
import { present, refuse } from './build.js';
import { checkShape } from './shape.js';

/** Fields a sentence cannot use: the API reads the structure from the sentence itself. */
const STRUCTURE_ONLY = ['institutions', 'institutions_combine', 'institution_type', 'exclude_current'] as const;
const PERSON_URL = 'linkedin.com/in/';

/** People connected across companies and institutions: a sentence, or the structure (API: `RelationshipRequest`). */
export function relationshipBody(params: W.RelationshipRequest): W.RelationshipRequest {
  const what = 'relationships.find';
  checkShape(what, params, 'RelationshipRequest');
  const structured = (params.companies?.length ?? 0) > 0 || present(params.relation);
  if (!present(params.query) && !structured) refuse(what, 'provide `query` for a question in words, or `relation` plus `companies` for a structured one');
  if (present(params.query)) {
    const ignored = [...new Set([...STRUCTURE_ONLY.filter((name) => present(params[name])), ...(structured ? ['companies'] : [])])].sort();
    if (ignored.length > 0) refuse(what, `send \`query\` or the structured fields, not both: ${ignored.join(', ')} would be ignored beside a sentence`);
    return params;
  }
  checkTwoSides(what, params);
  return params;
}

function checkTwoSides(what: string, params: W.RelationshipRequest): void {
  const companies = params.companies?.length ?? 0;
  const institutions = params.institutions?.length ?? 0;
  if (params.relation === 'via_institution') checkViaInstitution(what, companies, institutions);
  else if (companies !== 2) {
    refuse(what, "relation 'between_companies' takes exactly two companies. For one company plus an institution, use 'via_institution'");
  }
  if (params.institutions_combine === 'all' && institutions < 2) refuse(what, "institutions_combine='all' needs two or more institutions to combine");
}

function checkViaInstitution(what: string, companies: number, institutions: number): void {
  if (companies !== 1) refuse(what, "relation 'via_institution' takes exactly one company");
  if (institutions === 0) {
    refuse(what, "relation 'via_institution' needs at least one institution. One company with no institution is an employee search: use search({ category: 'person' })");
  }
}

/** Who one person can reach at a company (API: `ReachRequest`). */
export function reachBody(params: W.ReachRequest): W.ReachRequest {
  const what = 'relationships.reach';
  checkShape(what, params, 'ReachRequest');
  if (!params.person.li_url.trim().toLowerCase().includes(PERSON_URL)) {
    refuse(what, "person.li_url: expected a LinkedIn *person* URL containing 'linkedin.com/in/'");
  }
  const people = params.target_company.people;
  if ([people?.department, people?.seniority, people?.country].some((list) => (list?.length ?? 0) > 0)) {
    refuse(what, 'narrow the people reached with top-level `people`; `target_company.people` is not used here');
  }
  return params;
}

/** The institutions two companies' people share (API: `InstitutionsRequest`). */
export function institutionsBody(params: W.InstitutionsRequest): W.InstitutionsRequest {
  checkShape('relationships.institutions', params, 'InstitutionsRequest');
  return params;
}

/** A relationship question in words (API: `AskRequest`). */
export function askBody(params: W.AskRequest): W.AskRequest {
  checkShape('relationships.ask', params, 'AskRequest');
  return params;
}

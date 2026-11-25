/**
 * Records by identifier: companies, people, and each document kind. Billed per record
 * returned. Every lookup answers one row per value sent, found values first (not in the order
 * sent): `entityHit(answer, value)` finds a value's row, `missingValues(answer)` lists the
 * values that matched nothing, and `recordsOf(hit)` reads a row's matches as typed records.
 */

import type { RequestOptions } from '../core/transport.js';
import type * as W from '../generated/wire.js';
import { companyBody, documentBody, namedDocumentBody, personBody } from '../requests/entities.js';
import type { CompanyLookupParams, PersonLookupParams } from '../types/index.js';
import { Resource } from './resource.js';

type Projected = readonly string[] | undefined;

/** Look records up by identifier. */
export class Entities extends Resource {
  /**
   * Companies by domain, LinkedIn URL or name: up to 50 resolved by `by` (default `auto`, each
   * value classified), or up to 1,000 internal record ids with `by: null`. `fields` keeps only those
   * fields of each record (and its `id`), applied by the SDK: the company lookup takes none.
   */
  async companies(params: CompanyLookupParams, options?: RequestOptions): Promise<W.EntitiesEnvelope> {
    const answer = await this.json('entitiesCompanies', { body: companyBody('entities.companies', params) }, options);
    return project(answer, params.fields);
  }

  /** People by LinkedIn URL or name (`by` defaults to `auto`), as `companies`. */
  async persons(params: PersonLookupParams, options?: RequestOptions): Promise<W.EntitiesEnvelope> {
    const answer = await this.json('entitiesPersons', { body: personBody('entities.persons', params) }, options);
    return project(answer, params.fields);
  }

  /** Patents by id (up to 100), such as a search row's `d1_...` id; no `by`. `fields` is sent. */
  async patents(params: W.DocumentLookup, options?: RequestOptions): Promise<W.EntitiesEnvelope> {
    return this.json('entitiesPatents', { body: documentBody('entities.patents', params) }, options);
  }

  /** Trends by id (up to 100), as `patents`. */
  async trends(params: W.DocumentLookup, options?: RequestOptions): Promise<W.EntitiesEnvelope> {
    return this.json('entitiesTrends', { body: documentBody('entities.trends', params) }, options);
  }

  /** Academic reports by id (up to 100), as `patents`. */
  async academicReports(params: W.DocumentLookup, options?: RequestOptions): Promise<W.EntitiesEnvelope> {
    return this.json('entitiesAcademicReports', { body: documentBody('entities.academicReports', params) }, options);
  }

  /** News articles by headline (the server's default `by`) or by id (`by: 'id'`): 50 headlines or 100 ids. */
  async news(params: W.NamedDocumentLookup, options?: RequestOptions): Promise<W.EntitiesEnvelope> {
    return this.json('entitiesNews', { body: namedDocumentBody('entities.news', params) }, options);
  }

  /** Market reports by title (the default) or by id, as `news`. */
  async marketReports(params: W.NamedDocumentLookup, options?: RequestOptions): Promise<W.EntitiesEnvelope> {
    return this.json('entitiesMarketReports', { body: namedDocumentBody('entities.marketReports', params) }, options);
  }

  /** Funding rounds by the raising company's name (the default) or by id, as `news`. */
  async fundings(params: W.NamedDocumentLookup, options?: RequestOptions): Promise<W.EntitiesEnvelope> {
    return this.json('entitiesFundings', { body: namedDocumentBody('entities.fundings', params) }, options);
  }

  /** Job openings by role (the default) or by id, as `news`. */
  async jobOpenings(params: W.NamedDocumentLookup, options?: RequestOptions): Promise<W.EntitiesEnvelope> {
    return this.json('entitiesJobOpenings', { body: namedDocumentBody('entities.jobOpenings', params) }, options);
  }
}

/** `answer` with each match cut down to `fields` and its `id`. */
function project(answer: W.EntitiesEnvelope, fields: Projected): W.EntitiesEnvelope {
  if (fields === undefined) return answer;
  const keep = new Set([...fields, 'id']);
  const only = (match: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> =>
    Object.fromEntries(Object.entries(match).filter(([name]) => keep.has(name)));
  return { ...answer, results: answer.results.map((hit) => ({ ...hit, matches: hit.matches.map(only) })) };
}

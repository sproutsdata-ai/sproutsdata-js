/**
 * The `/v1/entities/*` surface: records by id, one method per category.
 *
 * Every method has the same shape — inputs in, one {@link EntityHit} per
 * input out, misses included (`found: false`, `matches: []`) — and the same
 * scope (`dsp.entities.read`) and billing rule (1 credit per record found;
 * misses are free, and a failed retrieval is never charged). `matches` is always a list: exactly one
 * entry for id-keyed lookups, one or more for the four named-document
 * categories under `by: "name"`. Only the record type and the resolver
 * options differ per category.
 */

import type { RequestOptions } from './http';
import { APIResource } from './resource';
import type {
  AcademicReportRecord,
  CompanyRecord,
  FundingRecord,
  JobOpeningRecord,
  MarketReportRecord,
  NewsRecord,
  PatentRecord,
  PersonRecord,
  TrendRecord,
} from './records';
import type {
  CompanyEntitiesParams,
  DocumentEntitiesParams,
  EntitiesEnvelope,
  NamedDocumentEntitiesParams,
  PersonEntitiesParams,
} from './types';
import { compact, ensure } from './validate';

/**
 * `ids` must be a non-empty list of non-empty strings. How many a call may
 * carry — per category, and with or without `by` — is the server's to say:
 * its 422 names the limit.
 */
function validateIds(ids: unknown): asserts ids is string[] {
  ensure(Array.isArray(ids) && ids.length > 0, '`ids` must be a non-empty array of strings');
  ids.forEach((id: unknown, i) => {
    ensure(typeof id === 'string' && id.length > 0, `\`ids[${i}]\` must be a non-empty string`);
  });
}

export class Entities extends APIResource {
  // async so a validation failure rejects the returned promise instead of
  // throwing synchronously — same contract as `SproutsData.search`.
  private async lookup<TMatch>(
    path: string,
    params: CompanyEntitiesParams | PersonEntitiesParams | DocumentEntitiesParams,
    options: RequestOptions | undefined,
  ): Promise<EntitiesEnvelope<TMatch>> {
    ensure(params !== null && typeof params === 'object', 'params must be an object with `ids`');
    validateIds(params.ids);
    // Spread rather than pick, so an unknown parameter reaches the server and
    // gets its clean 422 instead of being silently dropped here.
    return this.transport.request('POST', path, {
      body: compact({ ...params }),
      routeClass: 'billed',
      options,
    });
  }

  // The four categories with an external name distinct from their id.
  // `by` is always sent: the SDK's default ("id") is not the server's
  // ("name"), so omitting it would change the call's meaning on the wire.
  private async namedLookup<TMatch>(
    path: string,
    params: NamedDocumentEntitiesParams,
    options: RequestOptions | undefined,
  ): Promise<EntitiesEnvelope<TMatch>> {
    ensure(params !== null && typeof params === 'object', 'params must be an object with `ids`');
    validateIds(params.ids);
    return this.transport.request('POST', path, {
      body: compact({ ...params, by: params.by ?? 'id' }),
      routeClass: 'billed',
      options,
    });
  }

  /**
   * Look up companies by platform id — or by raw domain / LinkedIn URL / name
   * when `by` is set. A search hit's `id` is not a platform id: look a hit up
   * with `lookupRef(hit)`, which gives `{ by: 'domain', value }` (or
   * `li_url`).
   */
  companies(
    params: CompanyEntitiesParams,
    options?: RequestOptions,
  ): Promise<EntitiesEnvelope<CompanyRecord>> {
    return this.lookup('/v1/entities/companies', params, options);
  }

  /**
   * Look up persons by platform id — or by raw LinkedIn URL / name when `by`
   * is set (no `domain`: a person has none). A search hit's `id` is not a
   * platform id: look a hit up with `lookupRef(hit)`, which gives
   * `{ by: 'li_url', value }`.
   */
  persons(
    params: PersonEntitiesParams,
    options?: RequestOptions,
  ): Promise<EntitiesEnvelope<PersonRecord>> {
    return this.lookup('/v1/entities/persons', params, options);
  }

  /** Look up patents by platform id. */
  patents(
    params: DocumentEntitiesParams,
    options?: RequestOptions,
  ): Promise<EntitiesEnvelope<PatentRecord>> {
    return this.lookup('/v1/entities/patents', params, options);
  }

  /**
   * Look up news articles by platform id (the default) — or by headline with
   * `by: "name"`, where one entry can match several articles.
   */
  news(
    params: NamedDocumentEntitiesParams,
    options?: RequestOptions,
  ): Promise<EntitiesEnvelope<NewsRecord>> {
    return this.namedLookup('/v1/entities/news', params, options);
  }

  /** Look up trends by platform id. */
  trends(
    params: DocumentEntitiesParams,
    options?: RequestOptions,
  ): Promise<EntitiesEnvelope<TrendRecord>> {
    return this.lookup('/v1/entities/trends', params, options);
  }

  /**
   * Look up market reports by platform id (the default) — or by report title
   * with `by: "name"`, where one entry can match several reports.
   */
  marketReports(
    params: NamedDocumentEntitiesParams,
    options?: RequestOptions,
  ): Promise<EntitiesEnvelope<MarketReportRecord>> {
    return this.namedLookup('/v1/entities/market-reports', params, options);
  }

  /**
   * Look up funding rounds by platform id (the default) — or by the company
   * the round belongs to with `by: "name"`, where one entry can match several
   * rounds.
   */
  fundings(
    params: NamedDocumentEntitiesParams,
    options?: RequestOptions,
  ): Promise<EntitiesEnvelope<FundingRecord>> {
    return this.namedLookup('/v1/entities/fundings', params, options);
  }

  /** Look up academic reports by platform id. */
  academicReports(
    params: DocumentEntitiesParams,
    options?: RequestOptions,
  ): Promise<EntitiesEnvelope<AcademicReportRecord>> {
    return this.lookup('/v1/entities/academic-reports', params, options);
  }

  /**
   * Look up job openings by platform id (the default) — or by job role with
   * `by: "name"`, where one entry can match several postings, ordered
   * most-recent-first (the one named lookup not ordered by match score).
   */
  jobOpenings(
    params: NamedDocumentEntitiesParams,
    options?: RequestOptions,
  ): Promise<EntitiesEnvelope<JobOpeningRecord>> {
    return this.namedLookup('/v1/entities/job-openings', params, options);
  }
}

/**
 * Envelope → `Document[]`: the retriever's whole output contract.
 *
 * Two rules that are easy to get wrong and expensive later:
 * `metadata.record` is always the complete raw row (the escape hatch that
 * makes a lossy `page_content` acceptable), and request-level fields —
 * `total_is_estimate` above all — are copied onto every document, because a
 * lambda five frames into a chain sees one document, not the envelope. A
 * chain that renders "found 3 companies" from an estimate is stating a
 * falsehood we handed it.
 */

import { Document } from '@langchain/core/documents';
import type { Attribution, Degradation, ResolvedSearch, ResultCategory, SearchEnvelope, SearchHit } from 'sproutsdata';

import { renderPageContent } from './render.js';

/**
 * The metadata on every `Document` the retriever returns. `record` is always
 * the complete raw row; request-level fields are copied onto every document
 * so a lambda five frames into a chain can still see them.
 */
export interface SproutsDataDocumentMetadata {
  id: string;
  category: ResultCategory;
  score: number | null;
  /** The complete raw search hit, untouched. The escape hatch. */
  record: SearchHit;
  /** Best available pointer: domain, then LinkedIn URL, else null. */
  source: string | null;
  /** The handle for a support conversation. Empty only if the response carried none. */
  request_id: string;
  as_of: string;
  credential: string;
  /** What the page cost, in credits; `null` when not metered. */
  credits_charged: number | null;
  /**
   * What the platform decided the request meant: its `category`,
   * `filters`, `filters_source` and `conflicts`. Omitted when disabled.
   */
  resolved_search?: ResolvedSearch | null;
  /** How many records matched the whole request, not this page. */
  total: number;
  /** When true, `total` is a floor: "at least N". Render "N+", never "N". */
  total_is_estimate: boolean;
  /** Non-empty means recall, precision or freshness was reduced. Never an error. */
  degradation: readonly Degradation[];
  attribution: readonly Attribution[];
}

export interface EnvelopeToDocumentsOptions {
  contentFields?: readonly string[] | undefined;
  includeResolvedSearch: boolean;
}

function toSource(record: Record<string, unknown>): string | null {
  for (const key of ['domain', 'linkedin_url', 'url']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

export function envelopeToDocuments(envelope: SearchEnvelope, options: EnvelopeToDocumentsOptions): Document[] {
  const { meta } = envelope;
  return envelope.results.map((hit) => {
    const metadata: SproutsDataDocumentMetadata = {
      id: hit.id,
      category: hit.category,
      score: hit.score,
      record: hit,
      source: toSource(hit),
      request_id: meta.request_id,
      as_of: meta.as_of,
      credential: meta.credential,
      credits_charged: meta.credits_charged,
      total: envelope.total,
      total_is_estimate: envelope.total_is_estimate,
      degradation: envelope.degradation,
      attribution: envelope.attribution,
    };
    if (options.includeResolvedSearch) metadata.resolved_search = envelope.resolved_search;
    return new Document({ pageContent: renderPageContent(hit, options.contentFields), metadata });
  });
}

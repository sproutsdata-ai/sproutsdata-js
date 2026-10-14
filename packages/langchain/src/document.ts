/**
 * Envelope → `Document[]` — the retriever's whole output contract.
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
import type { Attribution, Degradation, EntityCategory, ResolvedSearch, SearchEnvelope, SearchHit } from 'sproutsdata';

import { renderPageContent } from './render';

/**
 * The metadata on every `Document` the retriever returns. `record` is always
 * the complete raw row; request-level fields are copied onto every document
 * so a lambda five frames into a chain can still see them.
 */
export interface SproutsDataDocumentMetadata {
  id: string;
  category: EntityCategory;
  score: number | null;
  /** The complete raw search hit, untouched. The escape hatch. */
  record: SearchHit;
  /** Best available pointer: domain, then LinkedIn URL, else null. */
  source: string | null;
  /** The handle for a support conversation. Empty only if the response carried none. */
  request_id: string;
  environment: string;
  as_of: string;
  credential: string;
  /**
   * What the platform decided the request meant: `filters`,
   * `filters_source` and `conflicts`. Omitted when disabled.
   */
  resolved_search?: ResolvedSearch | null;
  /** How many records matched the whole request, not this page. */
  total: number;
  /** When true, `total` is a floor: "at least N". Render "N+", never "N". */
  total_is_estimate: boolean;
  /** Non-empty means recall, precision or freshness was reduced. Never an error. */
  degradation: Degradation[];
  attribution: Attribution[];
}

export interface EnvelopeToDocumentsOptions {
  contentFields?: string[];
  includeResolvedSearch: boolean;
}

function toSource(record: Record<string, unknown>): string | null {
  for (const key of ['domain', 'li_url', 'linkedin_url']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

export function envelopeToDocuments(envelope: SearchEnvelope, options: EnvelopeToDocumentsOptions): Document[] {
  // Every field read with a fallback: a response missing part of `meta`
  // still yields documents, as the Python adapter's do.
  const meta: Partial<SearchEnvelope['meta']> = envelope.meta ?? {};
  return envelope.results.map((hit) => {
    const metadata: SproutsDataDocumentMetadata = {
      id: hit.id,
      category: hit.category,
      score: hit.score,
      record: hit,
      source: toSource(hit),
      request_id: meta.request_id ?? '',
      environment: meta.environment ?? '',
      as_of: meta.as_of ?? '',
      credential: meta.credential ?? '',
      total: envelope.total,
      total_is_estimate: envelope.total_is_estimate,
      degradation: envelope.degradation,
      attribution: envelope.attribution,
    };
    if (options.includeResolvedSearch) metadata.resolved_search = envelope.resolved_search;
    return new Document({ pageContent: renderPageContent(hit, options.contentFields), metadata });
  });
}

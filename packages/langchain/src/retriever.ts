/**
 * `SproutsDataRetriever`: Sprouts search as a LangChain retriever.
 *
 * Lossy by construction: a `page_content` string is a poor fit for a
 * structured record, so each document renders a short per-category line and
 * carries the complete raw row under `metadata.record`. For agents, prefer
 * the tools (`sproutsDataTools()`); this class exists for chains that
 * already speak `BaseRetriever`.
 *
 * `fast` is the default mode with a category. A retriever bound into an agent
 * loop can fire several times per user turn, and `auto` runs a model on every
 * first page (an order of magnitude slower, and billed as a different
 * action). With `category: 'auto'` no mode is sent: the server reads the
 * question in `auto`, its only mode there.
 *
 * Errors throw, unchanged from the SDK. A retriever has no error-as-data
 * channel, and the SDK's typed errors carry `request_id` in the message.
 * Retry policy belongs to the caller (`retriever.withRetry()`): the SDK
 * transport already retries what is safe to retry. Arguments are checked by
 * the client and the server, never copied here, so no copy of the server's
 * bounds or vocabularies can go stale.
 */

import type { CallbackManagerForRetrieverRun } from '@langchain/core/callbacks/manager';
import type { Document } from '@langchain/core/documents';
import { BaseRetriever, type BaseRetrieverInput } from '@langchain/core/retrievers';
import type { DiscoverFilters, SearchCategory, SearchMode, SearchParams, SproutsData } from 'sproutsdata';
import { type ConnectionOptions, resolveClient } from 'sproutsdata/tools';

import { envelopeToDocuments } from './document.js';

/** Constructor fields for {@link SproutsDataRetriever}. */
export interface SproutsDataRetrieverFields extends BaseRetrieverInput, ConnectionOptions {
  /** Number of documents to retrieve: the request's `limit`. Default 10. */
  k?: number;
  /** Category searched, sent on every request; `'auto'` lets the question pick it. Default `'company'`. */
  category?: SearchCategory | 'auto';
  /**
   * Search mode. Unset, `'fast'` is sent with a category, so a change in the
   * server's default can never change what a deployed retriever bills; with
   * `category: 'auto'` no mode is sent (`auto` is its only one).
   */
  mode?: SearchMode;
  /** Filters sent verbatim on every retrieval, full Sprouts filter vocabulary. */
  filters?: DiscoverFilters | Record<string, unknown>;
  /** Restrict results to these domains. */
  includeDomains?: string[];
  /** Exclude results from these domains. */
  excludeDomains?: string[];
  /**
   * Which record fields to render into `page_content`, as `field: value`
   * lines in this order. Omit for the built-in per-category one-liner. The
   * full record is always under `metadata.record` either way.
   */
  contentFields?: string[];
  /** Copy `resolved_search` onto each document's metadata. Default true. */
  includeResolvedSearch?: boolean;
}

/**
 * Sprouts search as a LangChain retriever.
 *
 * ```ts
 * const retriever = new SproutsDataRetriever({ k: 10 });
 * const docs = await retriever.invoke('industrial IoT platforms in the DACH region');
 * ```
 *
 * The key never becomes a field: it goes to the client, which holds it in a
 * private field, so `JSON.stringify`, `toJSON()` and `util.inspect` of the
 * retriever never show it.
 */
export class SproutsDataRetriever extends BaseRetriever {
  static override lc_name(): string {
    return 'SproutsDataRetriever';
  }

  lc_namespace: string[] = ['langchain', 'retrievers', 'sproutsdata'];

  readonly k: number;
  readonly category: SearchCategory | 'auto';
  readonly mode: SearchMode | undefined;
  readonly filters: DiscoverFilters | Record<string, unknown> | undefined;
  readonly includeDomains: string[] | undefined;
  readonly excludeDomains: string[] | undefined;
  readonly contentFields: string[] | undefined;
  readonly includeResolvedSearch: boolean;

  readonly #client: SproutsData;

  constructor(fields: SproutsDataRetrieverFields = {}) {
    // The connection stays out of `lc_kwargs`, which LangChain serialises
    // and Node's inspect prints.
    const { client, apiKey, baseUrl, timeoutMs, maxRetries, ...rest } = fields;
    super(rest);
    this.k = rest.k ?? 10;
    this.category = rest.category ?? 'company';
    this.mode = rest.mode ?? (this.category === 'auto' ? undefined : 'fast');
    this.filters = rest.filters;
    this.includeDomains = rest.includeDomains;
    this.excludeDomains = rest.excludeDomains;
    this.contentFields = rest.contentFields;
    this.includeResolvedSearch = rest.includeResolvedSearch ?? true;
    this.#client = resolveClient({ client, apiKey, baseUrl, timeoutMs, maxRetries });
  }

  override async _getRelevantDocuments(
    query: string,
    _runManager?: CallbackManagerForRetrieverRun,
  ): Promise<Document[]> {
    const params = {
      query,
      limit: this.k,
      category: this.category,
      ...(this.mode === undefined ? {} : { mode: this.mode }),
      ...(this.filters === undefined ? {} : { filters: this.filters }),
      // An empty domain list says nothing, and the server would refuse it.
      ...(this.includeDomains === undefined || this.includeDomains.length === 0 ? {} : { include_domains: this.includeDomains }),
      ...(this.excludeDomains === undefined || this.excludeDomains.length === 0 ? {} : { exclude_domains: this.excludeDomains }),
    };
    // The client checks the body against the category's own type before sending.
    const envelope = await this.#client.search(params as SearchParams);

    // The one zero-result case worth a warning: the platform inferred filters
    // from the query and they ANDed to nothing. Without `resolved_search`
    // this reads as "no results" instead of "these filters found nothing".
    if (envelope.results.length === 0 && envelope.resolved_search?.filters_source === 'parser') {
      console.warn(
        '[sproutsdata] Search returned no results; the platform inferred these ' +
          `filters from the query: ${JSON.stringify(envelope.resolved_search.filters)} ` +
          `(request_id: ${envelope.meta.request_id})`,
      );
    }

    return envelopeToDocuments(envelope, {
      contentFields: this.contentFields,
      includeResolvedSearch: this.includeResolvedSearch,
    });
  }
}

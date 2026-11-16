/** Relationships: people connected across companies and institutions. */

import type { RequestOptions } from '../core/transport.js';
import type * as W from '../generated/wire.js';
import { askBody, institutionsBody, reachBody, relationshipBody } from '../requests/relationships.js';
import type { DistributiveOmit, PageOptions } from '../types/index.js';
import { Resource } from './resource.js';

/** Who is connected to whom. Billed by session, as search is; `institutions` per call. */
export class Relationships extends Resource {
  /**
   * People connected across companies: a question in words (`query`), or its structure
   * (`relation` with its `companies`: two for `between_companies`, the default; one plus
   * `institutions` for `via_institution`).
   *
   * @throws {ClientValidationError} Both a sentence and structure, or a structure without its sides.
   * @throws {InvalidRequestError} A company or institution matched nothing (`relationship.anchor_not_found`) or several.
   */
  async find(params: W.RelationshipRequest, options?: RequestOptions): Promise<W.RelationshipEnvelope> {
    return this.json('relationships', { body: relationshipBody(params) }, options);
  }

  /** Every connected person, page after page: `find`'s parameters plus `maxResults`. */
  iterFind(params: DistributiveOmit<W.RelationshipRequest, 'cursor'> & PageOptions, options?: RequestOptions): AsyncGenerator<W.RelationshipHit, void, undefined> {
    const { maxResults, ...find } = params;
    return this.rows('relationships', { body: relationshipBody(find) }, (page) => page.results, options, maxResults);
  }

  /**
   * Who `person` (`{ li_url }`, a LinkedIn profile) can reach at `target_company`. `people`
   * narrows the people reached. The cursor is bound to the page size: page 2 must ask for page
   * 1's `limit`.
   */
  async reach(params: W.ReachRequest, options?: RequestOptions): Promise<W.ReachEnvelope> {
    return this.json('relationshipsReach', { body: reachBody(params) }, options);
  }

  /**
   * Everyone `person` can reach, page after page. Every page asks for the first page's size
   * (the server binds the cursor to it), and the walk stops at `maxResults`, trimming here.
   */
  iterReach(params: Omit<W.ReachRequest, 'cursor'> & PageOptions, options?: RequestOptions): AsyncGenerator<W.ReachHit, void, undefined> {
    const { maxResults, ...reach } = params;
    return this.rows('relationshipsReach', { body: reachBody(reach) }, (page) => page.results, options, maxResults);
  }

  /** The institutions two companies' people share, counted, without ranking people. */
  async institutions(params: W.InstitutionsRequest, options?: RequestOptions): Promise<W.SharedInstitutionsEnvelope> {
    return this.json('relationshipsInstitutions', { body: institutionsBody(params) }, options);
  }

  /**
   * A relationship question in words; the server picks the route that answers it (`route`). A
   * `relationships` or `reach` answer pages: send its `next_cursor` back here with the same
   * `query`. What the answer cost is `meta.credits_charged`.
   */
  async ask(params: W.AskRequest, options?: RequestOptions): Promise<W.AskEnvelope> {
    return this.json('relationshipsAsk', { body: askBody(params) }, options);
  }
}

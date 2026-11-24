/** The workspace's credits: the balance, the ledger behind it, and what a call would cost. Free. */

import type { RequestOptions } from '../core/transport.js';
import type * as W from '../generated/wire.js';
import { quoteBody } from '../requests/credits.js';
import { ledgerQuery } from '../requests/history.js';
import type { PageOptions, PageParams } from '../types/index.js';
import { Resource } from './resource.js';

/** The workspace's balance, its ledger, and quotes. */
export class Credits extends Resource {
  /**
   * The balance: `balance`, `reserved` (held for runs), `available`, `debt`, `status`.
   * `canAfford(credits, n)` compares `n` with `available`. A `frozen` wallet spends nothing
   * until Sprouts unfreezes it; a billed call then throws `WalletFrozenError`. `stale` says the
   * balance was read from a cache while the ledger was unreachable.
   */
  async retrieve(options?: RequestOptions): Promise<W.CreditsOut> {
    return this.json('creditsRetrieve', {}, options);
  }

  /**
   * What a call would cost, from the live price list. Holds nothing and costs nothing, and the
   * arithmetic is the meter's own, so the charge that follows matches the quote while the price
   * list is unchanged. `operation` is `search`, `search_auto` (an `auto` search), `similar`,
   * `relationships`, `institutions`, `lookup`, `org_chart`, `agent_run` or `enrichment`; `rows`
   * the rows on the page (up to 100), records found for `lookup` (up to 1,000) or the records to
   * enrich (up to 10,000), default 10; `start` the rows of the same search already paid for;
   * `effort` is required for `agent_run` and refused otherwise (`auto` quotes what it holds:
   * `basis` `run_up_to`); `fields` is for `enrichment` only, the fields asked of each record, each
   * at its own price (a phone number costs more than an email): what a job holds, `basis`
   * `values_up_to`, and only values newly found are charged. `available` and `covered` come from
   * a balance read moments ago, and are `null` when there is none.
   *
   * @throws {ClientValidationError} `effort` missing for `agent_run` or given for another
   *   operation, `fields` given for another operation or repeated, or more rows than a page
   *   holds, a lookup takes or a job takes. Nothing is sent.
   * @throws {InvalidRequestError} an enrichment quote over the 30,000 credits a job may hold.
   */
  async quote(params: W.QuoteIn, options?: RequestOptions): Promise<W.QuoteOut> {
    return this.json('creditsQuote', { body: quoteBody('credits.quote', params) }, options);
  }

  /**
   * One page of the ledger, newest first: each row's `kind` (`charge`, `grant`, ...), signed
   * `credits` (negative for a charge), `balance_after`, and the `action` or `source` behind it.
   */
  async transactions(params: PageParams = {}, options?: RequestOptions): Promise<W.TransactionsOut> {
    return this.json('creditsTransactions', { query: ledgerQuery(params) }, options);
  }

  /** Every ledger row, page after page, newest first. */
  iterTransactions(params: Omit<PageParams, 'cursor'> & PageOptions = {}, options?: RequestOptions): AsyncGenerator<W.TransactionOut, void, undefined> {
    const { maxResults, ...query } = params;
    return this.rows('creditsTransactions', { query: ledgerQuery(query) }, (page) => page.results, options, maxResults);
  }
}

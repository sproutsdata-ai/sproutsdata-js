/** The workspace's credits: the balance, and the ledger behind it. Free. */

import type { RequestOptions } from '../core/transport.js';
import type * as W from '../generated/wire.js';
import { ledgerQuery } from '../requests/history.js';
import type { PageOptions, PageParams } from '../types/index.js';
import { Resource } from './resource.js';

/** The workspace's balance and ledger. */
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
   * One page of the ledger, newest first: each row's `kind` (`charge`, `grant`, ...), signed
   * `credits` (negative for a charge), `balance_after`, and the `action` or `source` behind it.
   * A call made with a test key is free and writes no row.
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

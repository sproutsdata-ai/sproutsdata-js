/**
 * The base of every resource: one call, every row of a paged one, or an event stream, all
 * through the client's transport. A resource builds requests (`requests/`) and reads answers;
 * the HTTP, the retries and the paging rules are the core's.
 */

import { callJson, callPages, callStream, type Input, type JsonBody } from '../core/call.js';
import type { Clock } from '../core/clock.js';
import type { PageInput } from '../core/pagination.js';
import type { ServerSentEvent } from '../core/sse.js';
import type { RequestOptions, Transport } from '../core/transport.js';
import type { OperationMap, OperationName } from '../generated/operations.js';
import { checkMaxResults } from '../requests/build.js';

export class Resource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /** The clock the transport waits on. */
  protected get clock(): Clock {
    return this.#transport.clock;
  }

  /** Call an operation that answers with JSON, and get its typed body. */
  protected async json<K extends OperationName>(name: K, input: Input<K>, options?: RequestOptions): Promise<JsonBody<K>> {
    return (await callJson(this.#transport, name, input, options)).body;
  }

  /**
   * Every row of every page, at most `maxResults` of them, fetched as they are read: stopping
   * early fetches (and, on a billed operation, pays for) no further page. `maxResults` is
   * checked here, when the walk is made, not when its first row is read.
   */
  protected rows<K extends OperationName, Row>(
    name: K,
    first: PageInput & { readonly path?: OperationMap[K]['path'] },
    rowsOf: (page: JsonBody<K>) => readonly Row[],
    options: RequestOptions | undefined,
    maxResults: number | undefined,
  ): AsyncGenerator<Row, void, undefined> {
    checkMaxResults(name, maxResults);
    return walk(callPages(this.#transport, name, first, options, maxResults), rowsOf, maxResults);
  }

  /** Follow an operation's server-sent event stream. */
  protected stream<K extends OperationName>(name: K, input: Input<K>, options?: RequestOptions): AsyncGenerator<ServerSentEvent, void, undefined> {
    return callStream(this.#transport, name, input, options);
  }
}

async function* walk<K extends OperationName, Row>(
  pages: AsyncGenerator<{ readonly body: JsonBody<K> }, void, undefined>,
  rowsOf: (page: JsonBody<K>) => readonly Row[],
  maxResults: number | undefined,
): AsyncGenerator<Row, void, undefined> {
  let seen = 0;
  for await (const page of pages) {
    for (const row of rowsOf(page.body)) {
      if (maxResults !== undefined && seen >= maxResults) return;
      seen += 1;
      yield row;
    }
  }
}

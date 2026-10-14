/**
 * The base of every resource namespace (`client.runs`, `client.history`, …).
 *
 * The transport — and with it the API key — sits in a `#private` field, so a
 * resource serializes and inspects as an empty object: printing
 * `client.runs` can never print the key.
 */

import type { Transport } from './http';

export abstract class APIResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  protected get transport(): Transport {
    return this.#transport;
  }
}

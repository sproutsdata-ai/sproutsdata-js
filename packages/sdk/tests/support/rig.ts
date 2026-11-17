/** A feature under test: a resource over a scripted `fetch` and a clock that never waits. */

import { Transport } from '../../src/core/transport.js';
import { FakeClock, options, recordingFetch, type Scripted, type Sent } from './fakes.js';

export interface Rig {
  readonly clock: FakeClock;
  readonly sent: Sent[];
  readonly transport: Transport;
  /** The JSON body of the `index`th request. */
  body(index?: number): unknown;
  /** The query of the `index`th request. */
  query(index?: number): Record<string, string>;
}

export function rig(script: readonly Scripted[]): Rig {
  const clock = new FakeClock();
  const { fetch, sent } = recordingFetch(script);
  const transport = new Transport(options({ fetch, timeoutMs: 1_000 }), clock);
  return {
    clock,
    sent,
    transport,
    body: (index = 0) => sent[index]?.body,
    query: (index = 0) => Object.fromEntries(sent[index]?.url.searchParams ?? []),
  };
}

/** Every item of an async iterable. */
export async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}

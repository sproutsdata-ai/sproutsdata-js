/**
 * Waiting for work that runs server-side (an agent run, an export job): poll until it
 * settles, waiting longer between polls up to a cap, and give up in time. The multiplier, the
 * cap and the defaults are the route's entry in `spec/defaults.json` (`runWait`, `exportWait`),
 * as the Python SDK paces the same waits.
 */

import type { Clock } from './clock.js';
import { WaitTimeoutError } from './errors.js';

/** One wait: how to read the work, when it has settled, and how long to keep at it. */
export interface Polling<T> {
  readonly read: () => Promise<T>;
  readonly settled: (state: T) => boolean;
  /** What the timeout says the work was doing, given how many seconds were waited. */
  readonly stillGoing: (state: T, waitedSeconds: number) => string;
  readonly pollIntervalMs: number;
  /** `null` waits for as long as it takes. */
  readonly maxWaitMs: number | null;
  /** Each wait after the first is this many times the last one... */
  readonly pollMultiplier: number;
  /** ...up to this many milliseconds. */
  readonly pollMaxMs: number;
  readonly signal?: AbortSignal | undefined;
}

/** Poll until `settled`, and return that state; throw `WaitTimeoutError` (with `last`) at the limit. */
export async function waitFor<T>(clock: Clock, polling: Polling<T>): Promise<T> {
  const started = clock.now();
  let delay = polling.pollIntervalMs;
  for (;;) {
    const state = await polling.read();
    if (polling.settled(state)) return state;
    const waited = clock.now() - started;
    if (polling.maxWaitMs !== null && waited + delay > polling.maxWaitMs) {
      throw new WaitTimeoutError(polling.stillGoing(state, Math.round(waited / 1000)), state);
    }
    await clock.sleep(delay, polling.signal);
    delay = Math.min(delay * polling.pollMultiplier, Math.max(polling.pollMaxMs, delay));
  }
}

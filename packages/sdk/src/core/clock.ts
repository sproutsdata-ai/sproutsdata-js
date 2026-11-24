/**
 * Time, for the transport: now, waiting, and the randomness backoff jitters with. The one
 * place the SDK waits, passed to the transport, so a test replaces it and runs every retry
 * instantly and deterministically.
 */

import { APIUserAbortError } from './errors.js';

export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  /** Wait `ms`, or reject with `APIUserAbortError` as soon as `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** A number in [0, 1). */
  random(): number;
}

/** Wait `ms`, or reject with `APIUserAbortError` as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new APIUserAbortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new APIUserAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** The real clock. */
export const SYSTEM_CLOCK: Clock = {
  now: () => Date.now(),
  sleep,
  random: () => Math.random(),
};

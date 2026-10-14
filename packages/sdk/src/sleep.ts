/**
 * The one place the SDK waits: between retries and between `runs.wait`
 * polls. A module of its own so tests can observe every wait by mocking it.
 */

import { APIUserAbortError } from './errors';

/** Wait `ms`, or reject with {@link APIUserAbortError} as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new APIUserAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new APIUserAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

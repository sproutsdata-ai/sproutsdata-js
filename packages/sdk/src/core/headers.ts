/**
 * Headers matched without regard to case: a later `set` replaces an earlier one whatever
 * either's casing, which keeps a caller's `x-api-key` from riding along beside the SDK's.
 */

import { ClientValidationError } from './errors.js';

export class HeaderMap {
  readonly #entries = new Map<string, readonly [name: string, value: string]>();

  set(name: string, value: string): void {
    this.#entries.set(name.toLowerCase(), [name, value]);
  }

  merge(headers: Readonly<Record<string, string>>): void {
    for (const [name, value] of Object.entries(headers)) this.set(name, value);
  }

  /** The headers as a plain object, refusing any `fetch` could not send (the value is never echoed). */
  toObject(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, value] of this.#entries.values()) {
      try {
        new Headers([[name, value]]);
      } catch {
        throw new ClientValidationError(
          `Header '${name.replace(/[^\x21-\x7e]/g, '?')}' cannot be sent: names must be tokens, and values ` +
            'must not contain newlines or other control characters.',
        );
      }
      out[name] = value;
    }
    return out;
  }
}

/** Response headers as an object with lower-cased names. */
export function lowered(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name.toLowerCase()] = value;
  });
  return out;
}

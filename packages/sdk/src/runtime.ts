/**
 * What the client needs to know about the runtime it was constructed in:
 * environment variables, whether this is a browser, the `User-Agent` that
 * names the runtime, process warnings, and random ids. Every probe is guarded, so the client constructs
 * the same way in Node, Bun, Deno, edge workers and (opted-in) browsers.
 */

import { IDEMPOTENCY_KEY_PREFIX, USER_AGENT_PRODUCT } from './constants';
import { VERSION } from './version';

type ProcessLike = {
  env?: Record<string, string | undefined>;
  versions?: Record<string, string | undefined>;
  platform?: string;
  emitWarning?: (warning: string, options?: string | { type?: string; code?: string }) => void;
};

function processLike(): ProcessLike | undefined {
  return typeof process === 'undefined' ? undefined : (process as ProcessLike);
}

/** An environment variable, or `undefined` when unset, empty, or unreadable. */
function readEnv(name: string): string | undefined {
  try {
    const value = processLike()?.env?.[name];
    return value === undefined || value === '' ? undefined : value;
  } catch {
    // Deno without --allow-env throws on access.
    return undefined;
  }
}

const warnedDeprecated = new Set<string>();

/**
 * `name`, else the deprecated `fallback` — which emits one
 * `DeprecationWarning` per process naming the variable to use instead.
 */
export function readEnvWithFallback(name: string, fallback: string): string | undefined {
  const value = readEnv(name);
  if (value !== undefined) return value;
  const legacy = readEnv(fallback);
  if (legacy !== undefined && !warnedDeprecated.has(fallback)) {
    warnedDeprecated.add(fallback);
    const proc = processLike();
    if (typeof proc?.emitWarning === 'function') {
      proc.emitWarning(
        `${fallback} is deprecated and will stop being read at 1.0; set ${name} instead.`,
        'DeprecationWarning',
      );
    }
  }
  return legacy;
}

const warnedCodes = new Set<string>();

/**
 * Emit a `SproutsDataWarning` once per process for `code` (a runtime with no
 * `process.emitWarning` gets none). Used where a result is usable but not
 * what it looks like — a truncated or depth-capped page iteration.
 */
export function warnOnce(code: string, message: string): void {
  if (warnedCodes.has(code)) return;
  warnedCodes.add(code);
  const proc = processLike();
  if (typeof proc?.emitWarning === 'function') {
    proc.emitWarning(message, { type: 'SproutsDataWarning', code });
  }
}

/**
 * 32 random hex characters. `crypto.randomUUID` where the runtime has it
 * (Node 19+, Deno, Bun, workers); Node 18 has no global `crypto`, so a
 * `Math.random` fallback there — an idempotency key needs uniqueness, not
 * secrecy.
 */
function randomHex(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID().replace(/-/g, '');
  let out = '';
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/**
 * `sdk-<32 hex>`: the `Idempotency-Key` of one logical call, built once and
 * resent on every retry of it.
 */
export function newIdempotencyKey(): string {
  return `${IDEMPOTENCY_KEY_PREFIX}${randomHex()}`;
}

export function isBrowserLike(): boolean {
  const w = (globalThis as { window?: { document?: unknown } }).window;
  return w !== undefined && w.document !== undefined;
}

/** `<runtime>/<version>; <os>`, as far as the runtime lets us tell. */
function runtimeDescription(): string {
  try {
    const g = globalThis as {
      Deno?: { version?: { deno?: string }; build?: { os?: string } };
      Bun?: { version?: string };
    };
    const proc = processLike();
    // Deno and Bun both expose a Node-compatible `process`, so ask them first.
    if (g.Deno?.version?.deno !== undefined) {
      return `deno/${g.Deno.version.deno}; ${g.Deno.build?.os ?? 'unknown'}`;
    }
    if (g.Bun?.version !== undefined) {
      return `bun/${g.Bun.version}; ${proc?.platform ?? 'unknown'}`;
    }
    if (proc?.versions?.node !== undefined) {
      return `node/${proc.versions.node}; ${proc.platform ?? 'unknown'}`;
    }
  } catch {
    // A locked-down runtime; describe it as unknown rather than fail.
  }
  return 'unknown/unknown; unknown';
}

/**
 * `sproutsdata-js/<ver> (<runtime>/<ver>; <os>)`, or `undefined` in a
 * browser, which forbids setting the header.
 */
export function userAgent(): string | undefined {
  if (isBrowserLike()) return undefined;
  return `${USER_AGENT_PRODUCT}/${VERSION} (${runtimeDescription()})`;
}

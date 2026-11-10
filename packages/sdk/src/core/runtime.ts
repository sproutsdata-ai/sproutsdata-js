/**
 * What the SDK needs to know about the runtime it runs in: environment variables, whether
 * it is a browser, the `User-Agent` naming the runtime, process warnings, and random ids.
 * Every probe is guarded, so the client constructs the same way on Node, Bun, Deno and edge
 * runtimes. The one module that may touch `process`.
 */

import { IDEMPOTENCY_KEY_PREFIX, USER_AGENT_PRODUCT } from './constants.js';
import { VERSION } from '../version.js';

interface ProcessLike {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly versions?: Readonly<Record<string, string | undefined>>;
  readonly platform?: string;
  readonly emitWarning?: (warning: string, options?: { readonly type?: string; readonly code?: string }) => void;
}

function processLike(): ProcessLike | undefined {
  const candidate = (globalThis as { process?: ProcessLike }).process;
  return typeof candidate === 'object' ? candidate : undefined;
}

/** An environment variable, or `undefined` when unset, empty, or unreadable. */
export function readEnv(name: string): string | undefined {
  try {
    const value = processLike()?.env?.[name];
    return value === undefined || value === '' ? undefined : value;
  } catch {
    return undefined; // Deno without --allow-env throws on access.
  }
}

const warned = new Set<string>();

/** Emit a process warning once per process for `code` (a runtime without `emitWarning` gets none). */
export function warnOnce(code: string, message: string, type = 'SproutsDataWarning'): void {
  if (warned.has(code)) return;
  warned.add(code);
  processLike()?.emitWarning?.(message, { type, code });
}

/** `name`, else the deprecated `fallback`, which warns once naming its replacement. */
export function readEnvWithFallback(name: string, fallback: string): string | undefined {
  const value = readEnv(name);
  if (value !== undefined) return value;
  const legacy = readEnv(fallback);
  if (legacy !== undefined) {
    warnOnce(`SPROUTSDATA_ENV_${fallback}`, `${fallback} is deprecated and stops being read at 1.0; set ${name} instead.`, 'DeprecationWarning');
  }
  return legacy;
}

/** `sdk-<32 hex>`: the `Idempotency-Key` of one logical call, resent on its retries. */
export function newIdempotencyKey(): string {
  return `${IDEMPOTENCY_KEY_PREFIX}${crypto.randomUUID().replaceAll('-', '')}`;
}

/** Whether this looks like a browser (a `window` with a `document`). */
export function isBrowserLike(): boolean {
  const view = (globalThis as { window?: { document?: unknown } }).window;
  return view?.document !== undefined;
}

interface RuntimeGlobals {
  readonly Deno?: { readonly version?: { readonly deno?: string }; readonly build?: { readonly os?: string } };
  readonly Bun?: { readonly version?: string };
}

function deno(g: RuntimeGlobals): string | undefined {
  const version = g.Deno?.version?.deno;
  return version === undefined ? undefined : `deno/${version}; ${g.Deno?.build?.os ?? 'unknown'}`;
}

function bun(g: RuntimeGlobals, proc: ProcessLike | undefined): string | undefined {
  const version = g.Bun?.version;
  return version === undefined ? undefined : `bun/${version}; ${proc?.platform ?? 'unknown'}`;
}

function node(proc: ProcessLike | undefined): string | undefined {
  const version = proc?.versions?.['node'];
  return version === undefined ? undefined : `node/${version}; ${proc?.platform ?? 'unknown'}`;
}

function runtimeDescription(): string {
  try {
    const g = globalThis as RuntimeGlobals;
    const proc = processLike();
    // Deno and Bun both expose a Node-compatible `process`, so ask them first.
    return deno(g) ?? bun(g, proc) ?? node(proc) ?? 'unknown/unknown; unknown';
  } catch {
    return 'unknown/unknown; unknown'; // a locked-down runtime: unknown rather than a failure
  }
}

/** `sproutsdata-js/<version> (<runtime>/<version>; <os>)`. */
export function userAgent(): string {
  return `${USER_AGENT_PRODUCT}/${VERSION} (${runtimeDescription()})`;
}

/**
 * Keeping the API key out of anything printable.
 *
 * The key lives in ECMAScript `#private` fields, which `JSON.stringify` and
 * `util.inspect` never enumerate. The objects that hold it also describe
 * themselves through `toJSON` and Node's inspect hook, so a log line or a
 * debugger print shows which key is in use (`sk_dsp_live_***`) but never
 * the secret.
 */

/** Node's hook for `util.inspect` / `console.log`. A registered symbol: no `node:util` import. */
export const INSPECT_CUSTOM: unique symbol = Symbol.for('nodejs.util.inspect.custom');

/** The third argument Node passes to an inspect hook: `util.inspect` itself. */
export type InspectFn = (value: unknown, options?: unknown) => string;

/**
 * `sk_dsp_live_<secret>` → `sk_dsp_live_***`. Safe for logs and error
 * messages. Only the first three segments are kept: the secret is base64url
 * and may itself contain `_`.
 */
export function redactKey(apiKey: string): string {
  const [scheme, platform, environment, secret] = apiKey.split('_', 4);
  if (secret === undefined) return '***';
  return `${scheme}_${platform}_${environment}_***`;
}

/** An inspect hook body: `Name { …view }`, or the bare view when Node passes no formatter. */
export function inspectView(
  name: string,
  view: Record<string, unknown>,
  options: unknown,
  inspect: InspectFn | undefined,
): unknown {
  return inspect === undefined ? view : `${name} ${inspect(view, options)}`;
}

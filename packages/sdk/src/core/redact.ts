/**
 * Keeping the API key out of anything printable.
 *
 * The key lives in ECMAScript `#private` fields, which `JSON.stringify` and `util.inspect`
 * never show; the objects holding it describe themselves through `toJSON`, so a log line
 * shows which key is in use (`sk_dsp_live_***`), never the secret.
 */

/** `sk_dsp_live_<secret>` -> `sk_dsp_live_***`. The secret may itself contain `_`. */
export function redactKey(apiKey: string): string {
  const [scheme, platform, environment, secret] = apiKey.split('_', 4);
  if (scheme === undefined || platform === undefined || environment === undefined || secret === undefined) return '***';
  return `${scheme}_${platform}_${environment}_***`;
}

/**
 * The one serialisation every tool result goes through: `JSON.stringify` with keys sorted.
 *
 * A result is handed to a model, and compared by `spec/tools/fixtures/`, in one form: the text
 * the Python SDK's `to_json` writes for the same value (`spec/tools/README.md`, "Canonical
 * JSON"). Compact separators, keys sorted by UTF-16 code unit as `Array.prototype.sort` orders
 * them, which for the keys a result holds is code-point order.
 */

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, item]) => [key, sorted(item)]));
  }
  return value;
}

/**
 * The canonical text of a tool result: what a model is handed.
 *
 * @throws {TypeError} A value JSON cannot hold (a `bigint`, a cycle).
 */
export function toJson(value: unknown): string {
  return JSON.stringify(sorted(value));
}

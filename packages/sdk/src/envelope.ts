/**
 * What the SDK adds to a parsed success body before handing it back: the
 * response's `X-Request-Id`, and the `truncated` flag of contract 02 §6.
 */

import type { Degradation } from './types';

/** The degradation reason meaning the server stopped paging before the results ran out. */
export const PAGINATION_TRUNCATED = 'pagination_truncated';

/** True when `degradation` says the server stopped paging, so `has_more: false` is not "complete". */
export function hasPaginationTruncated(degradation: unknown): boolean {
  return (
    Array.isArray(degradation) &&
    degradation.some(
      (entry: unknown) =>
        entry !== null &&
        typeof entry === 'object' &&
        (entry as Partial<Degradation>).reason === PAGINATION_TRUNCATED,
    )
  );
}

/**
 * Set `truncated` on an envelope-shaped object (one with `results` and
 * `degradation`). It is true when the server already said so (the
 * `relationships.institutions` answer carries its own `truncated`) or when
 * `degradation` holds `pagination_truncated`.
 */
export function markTruncated(body: unknown): void {
  if (body === null || typeof body !== 'object') return;
  const envelope = body as Record<string, unknown>;
  if (!Array.isArray(envelope.results) || !Array.isArray(envelope.degradation)) return;
  envelope.truncated = envelope.truncated === true || hasPaginationTruncated(envelope.degradation);
}

/**
 * Normalise a parsed success body in place. The `X-Request-Id` header wins
 * over the body's `meta.request_id`: the header is what support searches by,
 * and the two are the same value whenever both are present. A body that
 * arrives without `meta` still gets the header's id, in a `meta` holding
 * only `request_id` — as the Python SDK reports it — so the handle for a
 * support conversation is never lost to a body that left it out.
 */
export function normalizeBody(body: unknown, headerRequestId: string | null): void {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return;
  const record = body as Record<string, unknown>;
  if (headerRequestId !== null) {
    const meta = record.meta;
    if (meta !== null && typeof meta === 'object' && !Array.isArray(meta)) {
      (meta as Record<string, unknown>).request_id = headerRequestId;
    } else {
      record.meta = { request_id: headerRequestId };
    }
  }
  markTruncated(body);
}

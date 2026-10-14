/**
 * From a search hit to the entity lookup that fetches its full record.
 *
 * A search hit's `id` is a *search* id — a company's domain or a 16-hex
 * hash, a person's hash — and not the platform id `/v1/entities/*` resolves
 * by default, so passing it as `ids` finds nothing. What does resolve is the
 * hit's own identifier with `by` set: a company's `domain` (or, lacking one,
 * its LinkedIn page) and a person's `linkedin_url`.
 */

import type { SearchHit } from './types';

/** The `by` / value pair that looks a search hit up on `entities.companies` / `entities.persons`. */
export interface LookupRef {
  by: 'domain' | 'li_url';
  value: string;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * How to look `hit` up, or null when it carries nothing that resolves (a
 * document hit, or a row with neither identifier).
 *
 * ```ts
 * const ref = lookupRef(page.results[0]);
 * if (ref) await client.entities.companies({ ids: [ref.value], by: ref.by });
 * ```
 */
export function lookupRef(hit: SearchHit): LookupRef | null {
  const linkedinUrl = nonEmptyString(hit.linkedin_url);
  if (hit.category === 'company') {
    const domain = nonEmptyString(hit.domain);
    if (domain !== undefined) return { by: 'domain', value: domain };
    return linkedinUrl === undefined ? null : { by: 'li_url', value: linkedinUrl };
  }
  if (hit.category === 'person') {
    return linkedinUrl === undefined ? null : { by: 'li_url', value: linkedinUrl };
  }
  return null;
}

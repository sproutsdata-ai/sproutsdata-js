/**
 * The bodies of `POST /v1/entities/*`, checked as the server checks them. Companies and people
 * are looked up by domain, LinkedIn URL or name (`by`), or as prism ids with no `by`; documents
 * by id, and news, market reports, funding rounds and job openings by name too. A search row's
 * `d1_...` id is a document id.
 */

import type * as W from '../generated/wire.js';
import type { CompanyLookupParams, PersonLookupParams } from '../types/index.js';
import { refuse } from './build.js';
import { checkShape } from './shape.js';

/** Values resolved by `by` are classified one by one (be search/schemas/entities.py:26). */
export const MAX_RESOLVED = 50;

/** A company lookup's body: `by` defaults to `auto`, `fields` is applied by the SDK, not sent. */
export function companyBody(what: string, params: CompanyLookupParams): W.CompanyLookup {
  const by = params.by === undefined ? 'auto' : params.by;
  const body: W.CompanyLookup = by === null ? { ids: params.ids } : { ids: params.ids, by };
  return checked(what, body, 'CompanyLookup', by !== null, 'resolving by `by`');
}

/** A person lookup's body, as `companyBody`. */
export function personBody(what: string, params: PersonLookupParams): W.PersonLookup {
  const by = params.by === undefined ? 'auto' : params.by;
  const body: W.PersonLookup = by === null ? { ids: params.ids } : { ids: params.ids, by };
  return checked(what, body, 'PersonLookup', by !== null, 'resolving by `by`');
}

/** A lookup by id of a patent, trend or academic report. */
export function documentBody(what: string, params: W.DocumentLookup): W.DocumentLookup {
  return checked(what, params, 'DocumentLookup', false, '');
}

/** A news, market report, funding round or job opening lookup, by name (the default) or id. */
export function namedDocumentBody(what: string, params: W.NamedDocumentLookup): W.NamedDocumentLookup {
  return checked(what, params, 'NamedDocumentLookup', params.by !== 'id', 'a name search');
}

function checked<T extends { readonly ids: readonly string[] }>(what: string, body: T, type: string, resolving: boolean, reason: string): T {
  if (typeof body.ids === 'string') refuse(what, 'ids must be a list of values, not one string');
  checkShape(what, body, type);
  // be search/schemas/entities.py:56 (_resolved_cap), applied at :75, :89 and :115.
  if (resolving && body.ids.length > MAX_RESOLVED) {
    refuse(what, `${reason} is capped at ${String(MAX_RESOLVED)} per call (got ${String(body.ids.length)}): each one is classified or can match several records`);
  }
  return body;
}

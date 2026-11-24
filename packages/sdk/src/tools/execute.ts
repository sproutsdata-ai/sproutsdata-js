/**
 * One planned call, made on the public client. Every lookup category goes through an
 * exhaustive table: a category added to the spec without a method here fails to compile.
 */

import type { CompanyBy, DocumentBy, EntitiesEnvelope, PersonBy, SearchEnvelope, SproutsData } from '../index.js';
import type { LookupCategory, LookupPlan, PagePlan } from './plan.js';

const COMPANY_BY: readonly CompanyBy[] = ['auto', 'domain', 'li_url', 'name'];
const PERSON_BY: readonly PersonBy[] = ['auto', 'li_url', 'name'];
const DOCUMENT_BY: readonly DocumentBy[] = ['id', 'name'];

/** `{ by }` when `value` is one of `allowed` (the plan has already refused any other), else nothing. */
function byOf<T extends string>(value: string | undefined, allowed: readonly T[]): { readonly by?: T } {
  const by = allowed.find((candidate) => candidate === value);
  return by === undefined ? {} : { by };
}

/** The page a search or look-alike plan asks for. */
export async function executePage(client: SproutsData, plan: PagePlan): Promise<SearchEnvelope> {
  switch (plan.tool) {
    case 'sprouts_search':
      return client.search(plan.params);
    case 'sprouts_similar':
      return client.similar(plan.params);
  }
}

type Lookup = (entities: SproutsData['entities'], ids: readonly string[], by: string | undefined, projection: { readonly fields?: readonly string[] }) => Promise<EntitiesEnvelope>;

/** Each category's `client.entities` method: a `Record` over the category union, so none is missing. */
const LOOKUPS: Readonly<Record<LookupCategory, Lookup>> = {
  company: (entities, ids, by, projection) => entities.companies({ ids, ...byOf(by, COMPANY_BY), ...projection }),
  person: (entities, ids, by, projection) => entities.persons({ ids, ...byOf(by, PERSON_BY), ...projection }),
  patent: (entities, ids, _by, projection) => entities.patents({ ids, ...projection }),
  trend: (entities, ids, _by, projection) => entities.trends({ ids, ...projection }),
  academic_report: (entities, ids, _by, projection) => entities.academicReports({ ids, ...projection }),
  news_article: (entities, ids, by, projection) => entities.news({ ids, ...byOf(by, DOCUMENT_BY), ...projection }),
  market_report: (entities, ids, by, projection) => entities.marketReports({ ids, ...byOf(by, DOCUMENT_BY), ...projection }),
  funding_round: (entities, ids, by, projection) => entities.fundings({ ids, ...byOf(by, DOCUMENT_BY), ...projection }),
  job_opening: (entities, ids, by, projection) => entities.jobOpenings({ ids, ...byOf(by, DOCUMENT_BY), ...projection }),
};

/** The answer to a lookup plan, from the method of its category. */
export async function executeLookup(client: SproutsData, plan: LookupPlan): Promise<EntitiesEnvelope> {
  return LOOKUPS[plan.category](client.entities, plan.ids, plan.by, plan.fields === undefined ? {} : { fields: plan.fields });
}

/**
 * The `/v1/relationships` surface: who knows whom, and through what.
 *
 * Four POSTs, one domain. `find` is the list query — people at one company
 * connected to another, or affiliated with named institutions. `reach` is its
 * drill-down — who one specific person (by LinkedIn URL, which `find` returns
 * on every row) can reach at a target company. `institutions` is the bridge
 * list on its own — which employers and schools two companies share, with
 * nobody ranked and no pagination. `ask` takes the question in words and
 * routes it to whichever of those shapes fits, reporting the choice back as
 * `route`. All four are billed and require `dsp.search.read`.
 */

import { markTruncated } from './envelope';
import type { RequestOptions } from './http';
import { envelopeShape, paginate, type PageOptions, type PageShape } from './paginate';
import { APIResource } from './resource';
import type { EntityCategory, Envelope } from './types';
import { compact, ensure } from './validate';

/** Which relationship question is being asked. */
export type RelationKind = 'between_companies' | 'via_institution';

/**
 * What counts as *knowing* someone. `overlapping` — the two people were at
 * the shared institution at the same time. `shared` — both were there at some
 * point, which on a large employer counts everyone who ever passed through.
 */
export type ConnectionBasis = 'overlapping' | 'shared';

/** Restrict the shared institution to a former employer, or a school. */
export type InstitutionType = 'employment' | 'education';

/**
 * Which people on one side of a relationship count. These hang off a company
 * rather than off the request because a relationship has two sides,
 * constrained independently. Only three axes — the affiliation corpus carries
 * no firmographics, so industry/headcount/etc. belong on `POST /v1/search`.
 */
export interface PeopleConstraints {
  /** Department labels (org-chart vocabulary). At most 20. */
  department?: string[];
  /** At most 20. */
  seniority?: string[];
  /** At most 20. */
  country?: string[];
}

/** A company on the relationship, plus which of its people count. */
export interface RelationshipCompanyRef {
  /** 1–300 characters. */
  value: string;
  /**
   * How to read `value`. `auto` (the default) infers it from the value's
   * shape. Prefer `domain` or `li_url` when you have one — `name` is not a
   * unique key, so it resolves to the best-ranked candidate.
   */
  by?: 'auto' | 'name' | 'domain' | 'li_url' | 'id';
  people?: PeopleConstraints;
}

/** An institution the connection must run through. */
export interface RelationshipInstitutionRef {
  /** 1–300 characters. */
  value: string;
  /**
   * How to read `value`. `auto` (the default) infers it: an `edu:` / `name:`
   * key — what `institutions[].id` returns — is an `inst_key`, a LinkedIn
   * URL is an `li_url`, anything else is a name.
   */
  by?: 'auto' | 'name' | 'li_url' | 'inst_key';
  /**
   * `unknown` (the default) lets the server decide from the index. When a
   * name is genuinely both — Cambridge is a company and a university — the
   * request is refused with both options rather than resolved by coin flip.
   */
  kind?: 'company' | 'school' | 'unknown';
}

/**
 * Body for `POST /v1/relationships`. Send `query` for the question in words,
 * or the structured fields (`relation` + `companies`), never both.
 */
export interface RelationshipParams {
  /** The question in words — "who at Adyen do we know from Stripe". ≤2000 chars. */
  query?: string;
  /** Which question this is. Defaults to `between_companies`. Rejected beside `query`. */
  relation?: RelationKind;
  /**
   * **Order is the contract.** For `between_companies` (exactly 2), the first
   * company's people are what comes back and the second is who they are
   * connected to. `via_institution` takes exactly 1.
   */
  companies?: RelationshipCompanyRef[];
  /** At most 10. */
  institutions?: RelationshipInstitutionRef[];
  /**
   * `any` (default) — affiliated with at least one. `all` — with every one
   * (needs ≥2 institutions; totals may come back as estimates).
   */
  institutions_combine?: 'any' | 'all';
  institution_type?: InstitutionType;
  /** Defaults to `overlapping` on the server — the deliberate, narrower reading. */
  connection_basis?: ConnectionBasis;
  /** Only count institutions the person has left ("previously worked at"). */
  exclude_current?: boolean;
  /** Add each person's current employer. Costs a further lookup upstream. */
  include_company_context?: boolean;
  /** Page size, 1–100. Defaults to 10 on the server. */
  limit?: number;
  /** Opaque signed cursor from a previous page's `next_cursor`. */
  cursor?: string;
}

/** Body for `POST /v1/relationships/reach`. */
export interface RelationshipReachParams {
  /**
   * The person the reach question runs through — by LinkedIn person URL
   * (`linkedin.com/in/…`), the only accepted form. `find` returns it on every
   * row as `linkedin_url`, so the two calls compose.
   */
  person: { li_url: string };
  /** The company being reached into. Its people are what comes back. */
  target_company: RelationshipCompanyRef;
  /** Constrains the people being *reached* — the only side with more than one person. */
  people?: PeopleConstraints;
  institution_type?: InstitutionType;
  /** Defaults to `overlapping` on the server. */
  connection_basis?: ConnectionBasis;
  /** Page size, 1–100. Defaults to 10 on the server. */
  limit?: number;
  /** Opaque signed cursor from a previous page's `next_cursor`. */
  cursor?: string;
}

/** One institution through which a person is connected. */
export interface ViaInstitution {
  /** The institution's key in the affiliation corpus — send back to narrow to it. */
  id: string;
  name: string | null;
  /** `employment` — a shared employer — or `education`. */
  kind: string | null;
  /**
   * How this institution was identified: `url`, `edu`, or `name` — always
   * returned, because a `name` match is a genuinely weaker signal.
   */
  match_confidence: string | null;
  /** When this person's association began, `YYYY-MM-DD`. */
  started: string | null;
  /** When it ended. Null means still there. */
  ended: string | null;
  /** What they did there — a job title, or a degree for a school. */
  role: string | null;
  /** Why this institution counts as a reason — in words, not a code. */
  match_type: string;
}

/** One person, and why they are connected. */
export interface RelationshipHit {
  /** Use with `POST /v1/entities/persons` for the full record. */
  id: string;
  /** Always `person`. */
  category: EntityCategory;
  full_name: string | null;
  title: string | null;
  linkedin_url: string | null;
  country: string | null;
  avatar: string | null;
  /** The same department vocabulary the request filters on. */
  department: string | null;
  seniority: string | null;
  /**
   * How many people at the **other** company this person can reach, under
   * the envelope's `connection_basis`. `0` is a computed, checked answer;
   * null means the count was never attempted (a `via_institution` query has
   * no other side to count against).
   */
  number_of_contacts_overlapping_tenure_with: number | null;
  /** Distinct institutions connecting this person to the other side. Never 0. */
  match_reason_count: number;
  /**
   * Every reason this person matched, strongest first — 1:1 with `via`
   * entries' own `match_type`, reordered by connection strength.
   */
  match_type: string[];
  /** Previously worked at the company on the other side — the strongest signal. */
  is_alum: boolean;
  /** Currently employed or enrolled at the other side specifically. */
  currently_at_target: boolean;
  /** Why this person matched. Never empty on a returned row. */
  via: ViaInstitution[];
  /** Present only with `include_company_context`. */
  company_name: string | null;
  company_domain: string | null;
  /**
   * False when the affiliation graph knows this person but the entity index
   * has no record — a real connection with a thin profile, returned rather
   * than dropped.
   */
  profile_complete: boolean;
}

/** An institution bridging the two sides, with how many people each has. */
export interface SharedInstitution {
  id: string;
  name: string | null;
  kind: string | null;
  match_confidence: string | null;
  /** Distinct people at the first company. */
  people_first: number;
  /** Distinct people at the second company. */
  people_second: number;
}

/**
 * The `find` response: the standard envelope plus the bridges themselves —
 * `institutions` is often the answer on its own, and what a caller narrows by
 * on the next request.
 */
export interface RelationshipEnvelope extends Envelope<RelationshipHit> {
  institutions: SharedInstitution[];
  /** Which definition of *knows* produced the counts. */
  connection_basis: ConnectionBasis;
  /** Present only when an `ask` question asked for a breakdown ("by department"). */
  breakdown?: Breakdown | null;
  /** Present only when an `ask` question asked for a proportion ("what share of their sales org"). */
  share?: Share | null;
}

/** One row of a {@link Breakdown}. */
export interface BreakdownGroup {
  /** The value as the index holds it. */
  key: string;
  /** What to show: a department or seniority label, or an institution's name. */
  label: string;
  /** Distinct people in this group. */
  people: number;
  /** `employment` or `education`, for an institution breakdown. */
  kind?: string | null;
}

/** The matching people broken down by one axis. */
export interface Breakdown {
  group_by: 'department' | 'seniority' | 'country' | 'institution' | (string & {});
  groups: BreakdownGroup[];
  /**
   * False when a count is an estimate, values were merged under one label,
   * or the question required several institutions at once — each group is
   * then an upper bound.
   */
  exact: boolean;
  /** Smaller groups exist and were not returned. */
  more_groups: boolean;
}

/** The answer as a proportion of the subject company's own people. */
export interface Share {
  /** Everyone currently at the subject company who meets the same person filters, connected or not. */
  population: number;
  population_is_estimate: boolean;
  /** `total / population`, from 0 to 1. Null when the population is zero. */
  share: number | null;
}

/** One of several named people a reach question ran through. */
export interface SeedReach {
  /** The named person's id. */
  id: string;
  total: number;
  total_is_estimate: boolean;
}

/** One of several companies a reach question reached into. */
export interface ReachTarget {
  /** Rows at this company carry the same `target_index`. */
  index: number;
  /** The company as the question named it. */
  value: string;
  /** The company it resolved to. */
  cid?: string | null;
  domain?: string | null;
  /** What it resolved to, by name. Read this before trusting a zero. */
  name?: string | null;
  /**
   * Set when this name resolved to the same company as an earlier target:
   * its rows and total are under the `index` this points to, and this entry
   * holds none of its own.
   */
  same_as?: number | null;
  /** People reachable at this company. */
  total: number;
  total_is_estimate: boolean;
}

/** How one reachable person knows the anchor, at one shared institution. */
export interface Connection {
  inst: string;
  name: string | null;
  /** `employment` — a shared employer — or `education`. */
  kind: string | null;
  match_confidence: string | null;
  /** What the reachable person did there. */
  their_role: string | null;
  their_started: string | null;
  /** Null means still there. */
  their_ended: string | null;
  /** What the person you asked through did there. */
  anchor_role: string | null;
  anchor_started: string | null;
  anchor_ended: string | null;
  /**
   * Whole months the two were there at the same time. Null when either
   * side's start date is unknown — not `0`, which would claim they were
   * never there together.
   */
  overlap_months: number | null;
  /** Why this counts as a connection, in words. */
  match_type: string;
}

/** One person reachable through the anchor, and how. */
export interface ReachHit {
  /** Use with `POST /v1/entities/persons` for the full record. */
  id: string;
  /** Always `person`. */
  category: EntityCategory;
  full_name: string | null;
  title: string | null;
  linkedin_url: string | null;
  country: string | null;
  company_name: string | null;
  department: string | null;
  seniority: string | null;
  /** Why this person is reachable. Never empty on a returned row. */
  how: Connection[];
  /**
   * Every reason, strongest first — 1:1 with `how` entries' own
   * `match_type`, reordered by strength.
   */
  match_type: string[];
  /** When the question ran through several named people: the ids of those who can reach this person. */
  reached_by?: string[] | null;
  /** When the question reached into several companies: which one this person is at, as an index into `targets`. */
  target_index?: number | null;
}

/**
 * An institution the anchor shares with people at the target company. One
 * count only — the anchor's own side would always be `1`.
 */
export interface ReachInstitution {
  /** The institution's key — send it back as an `institutions[]` anchor on `find` to narrow to it. */
  id: string;
  name: string | null;
  /** `employment` — a shared employer — or `education`. */
  kind: string | null;
  /** `url`, `edu`, or `name` — a `name` match is a weaker signal. */
  match_confidence: string | null;
  /** Distinct people at the target company reachable through this institution. Never null. */
  people_at_target: number;
}

/**
 * The `reach` response: the standard envelope, the institutions behind the
 * whole answer (not just this page), and which *knows* was applied.
 */
export interface ReachEnvelope extends Envelope<ReachHit> {
  /** Every institution connecting the anchor to the target, across all pages. */
  institutions: ReachInstitution[];
  connection_basis: ConnectionBasis;
  /**
   * When an `ask` question ran through several named people: how many each
   * reaches on their own. `total` is then their sum — an upper bound, since
   * a person two of them reach counts twice.
   */
  seeds?: SeedReach[] | null;
  /**
   * When an `ask` question reached into several companies: each one, what it
   * resolved to and how many it holds. Rows are grouped by company in this
   * order and `limit` applies per company, so a page can hold up to `limit`
   * rows for each. `total` is then their sum, exact.
   */
  targets?: ReachTarget[] | null;
}

/**
 * Body for `POST /v1/relationships/institutions`. Structured only — no
 * `query`, no `relation`, no `cursor`.
 */
export interface RelationshipInstitutionsParams {
  /**
   * **Exactly two, and order matters.** The first company's own institution
   * keys are excluded from the bridges and the second's are kept ("previously
   * worked at the other company" is the strongest bridge in the corpus), so
   * swapping the two changes which institutions come back and what
   * `people_first` / `people_second` count. Each company's `people`
   * constraints apply to its own side.
   */
  companies: RelationshipCompanyRef[];
  /** Shared employers only, or schools only. Unset returns both. */
  institution_type?: InstitutionType;
  /**
   * How many distinct people each side must have at an institution for it to
   * count, 1–100. Default 1 — at which a single coincidence is a bridge.
   * Applied after the upstream trims to the strongest `limit`, so raise
   * `limit` alongside it when the answer looks short.
   */
  min_people_per_side?: number;
  /**
   * Keep only institutions whose display name starts with this,
   * case-insensitively — a prefix, not a substring. 1–200 characters.
   */
  name_starts_with?: string;
  /**
   * How many institutions to return, strongest bridge first, 1–1000
   * (default 200). Not a page size: there is no cursor. When more exist,
   * `truncated` on the response is true.
   */
  limit?: number;
}

/**
 * The `institutions` response: the bridges as `results`. **Never paginated**
 * — `has_more` is always false and `next_cursor` always null; `truncated` is
 * the field to branch on.
 */
export interface SharedInstitutionsEnvelope extends Envelope<SharedInstitution> {
  /**
   * True when more institutions qualified than `limit` returned. Raise
   * `limit`, or narrow with `institution_type` / `name_starts_with`.
   */
  truncated: boolean;
}

/** Body for `POST /v1/relationships/ask` — deliberately three fields. */
export interface RelationshipAskParams {
  /**
   * The question, in words, 1–2000 characters. Which kind of question it is
   * ("who at Adyen do we know from Stripe", "who at Canva used to work with
   * Melanie Perkins", "what do Stripe and Adyen people have in common") is
   * worked out server-side and reported back as `route`.
   */
  query: string;
  /** Page size, 1–100. Defaults to 10 on the server. */
  limit?: number;
  /**
   * Opaque signed cursor from a previous page. It carries the plan worked out
   * for the question, so paging never re-interprets the sentence.
   */
  cursor?: string;
}

/**
 * Which question an `ask` turned out to be — and therefore which field of the
 * {@link AskEnvelope} holds the answer.
 */
export type AskRoute = 'relationships' | 'reach' | 'institutions' | 'compare' | 'fan_out';

/** What the question was understood to mean. Check it before trusting the rows. */
export interface AskReading {
  /** The part of the question this answer covers, in the caller's own words. */
  span: string;
  /** How many searches this answer took. */
  searches: number;
  /** What was widened, capped or could not be applied — one plain-language entry per thing. */
  warnings: string[];
}

/** One side of a comparison: an ordinary relationship envelope plus the half it answers. */
export interface ComparisonSideEnvelope extends RelationshipEnvelope {
  span: string;
}

/**
 * Two ways in, weighed against each other. Both sides always come back with
 * their evidence — read them rather than `stronger` when it is null.
 */
export interface ComparisonEnvelope {
  /** One per half of the question, in the order asked. */
  sides: ComparisonSideEnvelope[];
  /**
   * Index into `sides`, or null when no side is named — a real answer that
   * also covers "either count is approximate, so the two cannot be ranked".
   */
  stronger: number | null;
  /** False when the sides cannot be meaningfully weighed. */
  comparable: boolean;
  /** Applied to both sides. */
  connection_basis: ConnectionBasis;
}

/** What one person from a fan-out's first half can reach. */
export interface DrillDownEnvelope extends ReachEnvelope {
  /** The `id` in the parent `results` this hangs under. */
  person_id: string;
}

/**
 * The people the first half asked for, each with what they can reach. The
 * first half's page is complete on its own; `drill_downs` is the extra.
 */
export interface FanOutEnvelope extends RelationshipEnvelope {
  /** One per person drilled into, in `results` rank order. Shorter than `k` when rows lack a LinkedIn URL. */
  drill_downs: DrillDownEnvelope[];
  /** People in the top `k` that could not be drilled into (no LinkedIn URL). */
  skipped: number;
  /** How many results were drilled into. */
  k: number;
}

/**
 * The `ask` response. Read `route` first, then the field it names — exactly
 * one is populated. `compare` and `fan_out` are two-part answers and never
 * paginate; today only `relationships` pages.
 */
export interface AskEnvelope {
  route: AskRoute;
  reading: AskReading;
  relationships: RelationshipEnvelope | null;
  reach: ReachEnvelope | null;
  institutions: SharedInstitutionsEnvelope | null;
  compare: ComparisonEnvelope | null;
  fan_out: FanOutEnvelope | null;
  /** What the question cost, in credits: one figure for the whole answer. */
  credits_charged?: number | null;
}

/** The slots of an {@link AskEnvelope} that carry a pageable envelope. */
const ASK_PAGED_SLOTS = ['relationships', 'reach', 'institutions'] as const;

/** The populated pageable slot of an `ask` answer; `compare` and `fan_out` have none. */
function askSlot(page: AskEnvelope): RelationshipEnvelope | ReachEnvelope | SharedInstitutionsEnvelope | null {
  return page.relationships ?? page.reach ?? page.institutions ?? null;
}

/**
 * How `askPages` reads an answer: its rows and cursor are the populated
 * slot's. `compare` and `fan_out` carry no cursor, so the loop ends on them.
 */
const ASK_SHAPE: PageShape<AskEnvelope> = {
  rows: (page) => askSlot(page)?.results ?? [],
  withRows: (page, rows) => {
    const slot = ASK_PAGED_SLOTS.find((name) => page[name] !== null);
    return slot === undefined ? page : { ...page, [slot]: { ...page[slot], results: rows } };
  },
  nextCursor: (page) => askSlot(page)?.next_cursor ?? undefined,
  degradation: (page) => askSlot(page)?.degradation,
};

/** Every non-empty string in a list of company or institution refs. */
function validateRefs(refs: unknown, field: string): void {
  if (refs === undefined) return;
  ensure(Array.isArray(refs), `\`${field}\` must be an array`);
  refs.forEach((ref: unknown, i) => {
    const value = (ref as { value?: unknown } | null)?.value;
    ensure(
      typeof value === 'string' && value.length > 0,
      `\`${field}[${i}].value\` must be a non-empty string`,
    );
  });
}

export class Relationships extends APIResource {
  /**
   * People at one company connected to another, or affiliated with named
   * institutions. Provide `query` in words, or `relation` + `companies` —
   * never both. 2 credits for the first 10 results, then 1 per next 10;
   * requires `dsp.search.read`.
   */
  async find(params: RelationshipParams, options?: RequestOptions): Promise<RelationshipEnvelope> {
    ensure(params !== null && typeof params === 'object', 'find(params) requires a params object');
    const hasQuery = typeof params.query === 'string' && params.query.length > 0;
    const structured =
      params.relation !== undefined ||
      (Array.isArray(params.companies) && params.companies.length > 0);
    ensure(
      hasQuery || structured,
      'Provide `query` for a question in words, or `relation` plus `companies` for a structured one',
    );
    ensure(
      !(hasQuery && structured),
      'Send `query` or the structured fields, not both: a sentence and a structure ' +
        'alongside it have no defined precedence',
    );
    validateRefs(params.companies, 'companies');
    validateRefs(params.institutions, 'institutions');
    // Relation-shape rules (how many companies each relation takes, `all`
    // needing several institutions) and every bound stay on the server,
    // whose 422s name the fix — and which refuses before charging.
    return this.transport.request('POST', '/v1/relationships', {
      body: compact({ ...params }),
      routeClass: 'billed',
      options,
    });
  }

  /** Iterate `find` result pages, as `searchPages` does. Each page is charged for the results it adds. */
  findPages(
    params: RelationshipParams,
    options?: PageOptions,
  ): AsyncGenerator<RelationshipEnvelope, void, undefined> {
    return paginate((page, opts) => this.find(page, opts), params, options, envelopeShape());
  }

  /**
   * Who one specific person can reach at a target company. The anchor is a
   * LinkedIn person URL — the form `find` returns on every row. 2 credits for
   * the first 10 results, then 1 per next 10; requires `dsp.search.read`.
   */
  async reach(params: RelationshipReachParams, options?: RequestOptions): Promise<ReachEnvelope> {
    ensure(
      params !== null && typeof params === 'object',
      'reach(params) requires a params object',
    );
    const liUrl = params.person?.li_url;
    ensure(
      typeof liUrl === 'string' && liUrl.trim().length > 0,
      '`person.li_url` must be a non-empty string (a LinkedIn person URL)',
    );
    // Refused before the billed call: a company page here resolves to nothing
    // and reads as "this person knows nobody", which looks like a real answer.
    ensure(
      liUrl.trim().toLowerCase().includes('linkedin.com/in/'),
      "`person.li_url` must be a LinkedIn *person* URL containing 'linkedin.com/in/'",
    );
    ensure(
      typeof params.target_company?.value === 'string' && params.target_company.value.length > 0,
      '`target_company.value` must be a non-empty string',
    );
    return this.transport.request('POST', '/v1/relationships/reach', {
      body: compact({ ...params }),
      routeClass: 'billed',
      options,
    });
  }

  /** Iterate `reach` result pages, as `searchPages` does. Each page is charged for the results it adds. */
  reachPages(
    params: RelationshipReachParams,
    options?: PageOptions,
  ): AsyncGenerator<ReachEnvelope, void, undefined> {
    return paginate((page, opts) => this.reach(page, opts), params, options, envelopeShape());
  }

  /**
   * The employers and schools two companies have people at in common, with
   * how many on each side — the `institutions[]` of `find` on its own, without
   * paying for a ranked page of people. One aggregation, not a list: there is
   * no cursor and no `*Pages` helper; branch on `truncated` and raise `limit`
   * or narrow. 2 credits flat; requires `dsp.search.read`.
   */
  async institutions(
    params: RelationshipInstitutionsParams,
    options?: RequestOptions,
  ): Promise<SharedInstitutionsEnvelope> {
    ensure(
      params !== null && typeof params === 'object' && Array.isArray(params.companies),
      'institutions(params) requires `companies`',
    );
    validateRefs(params.companies, 'companies');
    return this.transport.request('POST', '/v1/relationships/institutions', {
      body: compact({ ...params }),
      routeClass: 'billed',
      options,
    });
  }

  /**
   * A relationship question in words, routed to whichever shape fits — people
   * between two companies, one person's reach, the shared institutions, a
   * comparison, or a fan-out. Read `route` on the answer, then the field it
   * names. Priced like the route it picks: 2 credits for the first 10
   * results, then 1 per next 10, or 2 flat for shared institutions; the cost
   * is the answer's top-level `credits_charged`. Requires `dsp.search.read`.
   */
  async ask(params: RelationshipAskParams, options?: RequestOptions): Promise<AskEnvelope> {
    ensure(params !== null && typeof params === 'object', 'ask(params) requires a params object');
    ensure(
      typeof params.query === 'string' && params.query.length > 0,
      '`query` must be a non-empty string',
    );
    const answer = await this.transport.request<AskEnvelope>('POST', '/v1/relationships/ask', {
      body: compact({ ...params }),
      routeClass: 'billed',
      options,
    });
    // The answer's envelopes sit one level down; flag them as every
    // top-level envelope is.
    ASK_PAGED_SLOTS.forEach((slot) => markTruncated(answer[slot]));
    return answer;
  }

  /**
   * Iterate `ask` answers, following the populated slot's `next_cursor` as
   * `searchPages` does. Only the `relationships` route issues cursors today;
   * `compare` and `fan_out` are single answers, so the loop yields once and
   * stops. Each page is charged for the results it adds.
   */
  askPages(
    params: RelationshipAskParams,
    options?: PageOptions,
  ): AsyncGenerator<AskEnvelope, void, undefined> {
    return paginate((page, opts) => this.ask(page, opts), params, options, ASK_SHAPE);
  }
}

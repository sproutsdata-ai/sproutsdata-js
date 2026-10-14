/**
 * The Sprouts Data client.
 *
 * Wraps the API-key surface of the Sprouts Data API:
 *
 * - `POST /v1/search`                — {@link SproutsData.search} (scope `dsp.search.read`)
 * - `POST /v1/similar`               — {@link SproutsData.similar} (scope `dsp.search.read`)
 * - `GET /v1/search/filters/{name}`  — {@link SproutsData.filterValues} (scope `dsp.search.read`)
 * - `GET /v1/search/filters/{category}/{name}` — {@link SproutsData.documentFilterValues} (scope `dsp.search.read`)
 * - `GET /v1/sorts/{category}`       — {@link SproutsData.sorts} (scope `dsp.search.read`)
 * - `GET /v1/coverage`               — {@link SproutsData.coverage} (scope `dsp.search.read`)
 * - `POST /v1/relationships*`        — {@link SproutsData.relationships} (scope `dsp.search.read`)
 * - `POST /v1/org-chart*`            — {@link SproutsData.orgChart} (scope `dsp.search.read`)
 * - `POST /v1/entities/*`            — {@link SproutsData.entities} (scope `dsp.entities.read`)
 * - `GET /v1/credits`, `/v1/keys/usage` — {@link SproutsData.credits} (scope `dsp.usage.read`)
 * - `GET /v1/usage/history*`         — {@link SproutsData.history} (scope `dsp.usage.read`)
 * - `/v1/agents/runs*`               — {@link SproutsData.runs} (scopes `dsp.agents.*`)
 * - `/v1/feedback*`                  — {@link SproutsData.feedback} (scope `dsp.search.read` or `dsp.usage.read`; `tags` is public)
 * - `/v1/lists*`                     — {@link SproutsData.lists} (scope `dsp.search.read` or `dsp.entities.read`)
 * - `POST /v1/search/export`         — {@link SproutsData.searchExport} (scope `dsp.search.read` or `dsp.entities.read`)
 * - `POST /v1/members/resolve`       — {@link SproutsData.members} (scope `dsp.search.read` or `dsp.agents.write`)
 *
 * Validation here is deliberately structural only (the cheap mistakes that
 * should fail before a network round trip). Semantic rules — which categories
 * accept domain filters, which categories `similar` supports — stay on the
 * server so this SDK never has to chase them.
 */

import {
  API_KEY_PATTERN,
  AUTO_CATEGORY,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_SEARCH_CATEGORY,
  DEFAULT_TIMEOUT_MS,
  DEPRECATED_ENV_API_KEY,
  DEPRECATED_ENV_BASE_URL,
  ENV_API_KEY,
  ENV_BASE_URL,
  GTM_CATEGORIES,
  INTEGRATION_PATTERN,
  LOOPBACK_HOSTS,
} from './constants';
import { Credits } from './credits';
import { Entities } from './entities';
import { ClientValidationError } from './errors';
import { Feedback } from './feedback';
import type { FilterName } from './filters';
import { History } from './history';
import { Transport, type RequestOptions } from './http';
import { checkItems, Lists, toCsvExport, type CsvExport, type SearchExportParams } from './lists';
import { Members } from './members';
import { OrgChart } from './org-chart';
import { envelopeShape, laterPageOptions, paginate, type PageOptions } from './paginate';
import { INSPECT_CUSTOM, inspectView, type InspectFn } from './redact';
import { Relationships } from './relationships';
import { Runs } from './runs';
import { isBrowserLike, readEnvWithFallback, userAgent } from './runtime';
import type {
  CoverageParams,
  CoverageResponse,
  DocumentFilterValuesParams,
  DocumentFilterValuesResponse,
  EntityCategory,
  FilterValuesParams,
  FilterValuesResponse,
  SearchEnvelope,
  SearchParams,
  SimilarParams,
  SortCatalogResponse,
} from './types';
import { assertNoRetiredFilters, assertNotRetiredFilter, compact, ensure, pathSegment } from './validate';

/**
 * `sort` must be a list of clauses, each naming a field. How many clauses,
 * which fields, which directions, and whether the category allows ordering
 * are the server's to say: its 422 names the field and points at
 * `GET /v1/sorts/{category}`.
 */
function validateSort(sort: unknown): void {
  if (sort === undefined) return;
  ensure(Array.isArray(sort), '`sort` must be an array of `{ field, direction? }` clauses');
  sort.forEach((clause: unknown, i) => {
    const field = (clause as { field?: unknown } | null)?.field;
    ensure(
      typeof field === 'string' && field.length > 0,
      `\`sort[${i}].field\` must be a non-empty string`,
    );
  });
}

/**
 * A `deep` search enumerates the category exhaustively and the server
 * ignores `filters`, `sort` and domain restrictions on it — silently, on a
 * billed call. Refusing them here is the only way the caller finds out.
 */
function assertDeepTakesQueryOnly(params: SearchParams): void {
  if (params.mode !== 'deep') return;
  const ignored = (['filters', 'sort', 'include_domains', 'exclude_domains'] as const).filter(
    (key) => params[key] !== undefined && !isEmptyValue(params[key]),
  );
  ensure(
    ignored.length === 0,
    `\`mode: 'deep'\` takes no ${ignored.map((key) => `\`${key}\``).join(', ')}: the server ` +
      'ignores them on a deep search, which is billed all the same. Drop them, or use ' +
      "`mode: 'auto'` to filter and sort.",
  );
}

/** The one rule on the filter-values query: `parent` and `level` both name a rung of the tree. */
function validateFilterValuesQuery(params: FilterValuesParams): void {
  if (params.parent !== undefined) {
    ensure(
      typeof params.parent === 'string' && params.parent.length > 0,
      '`parent` must be a non-empty string (a parent value of a two-level filter)',
    );
  }
  ensure(
    !(params.parent !== undefined && params.level !== undefined),
    'Send `parent` or `level`, not both: `parent` already names one rung of the tree',
  );
}

export interface SproutsDataOptions {
  /**
   * Your API key (`sk_dsp_live_…` or `sk_dsp_test_…`). Defaults to the
   * `SPROUTSDATA_API_KEY` environment variable (`DSP_API_KEY` is still read,
   * with a deprecation warning).
   */
  apiKey?: string;
  /**
   * API origin. Defaults to the `SPROUTSDATA_BASE_URL` environment variable
   * (`DSP_BASE_URL` is still read, with a deprecation warning), then
   * `https://api.sproutsdata.ai`. Must be `https://`; plain `http://` is
   * accepted for `localhost` and `127.0.0.1` only.
   */
  baseUrl?: string;
  /** Time budget per attempt, in milliseconds. Default 60 000. */
  timeoutMs?: number;
  /**
   * How many times a failed attempt may be retried. Default 2 (three
   * attempts); 0 disables retrying. What is retried depends on what the
   * route costs: a connection that provably never reached the server, 429,
   * 503 and 504 are retried everywhere, and 500 everywhere but
   * `feedback.create`. A read timeout, a dropped connection or a 502 is
   * retried only on free routes and `runs.create` (whose idempotency key
   * makes the repeat safe) — never on a billed call, which may already have
   * been charged. A `Retry-After` of up to 60 s is honoured in full; a longer
   * one is raised at once as a `RateLimitError` carrying `retryAfter`.
   */
  maxRetries?: number;
  /** Custom fetch implementation (testing, proxies). Default: global fetch. */
  fetch?: typeof globalThis.fetch;
  /**
   * Headers sent on every request. They cannot override `X-API-Key` or
   * `User-Agent`, in any casing, and `Origin` / `Referer` are refused, as is
   * `X-SproutsData-Client` (use `integration`).
   */
  defaultHeaders?: Record<string, string>;
  /**
   * For a framework or tool layer built on this client: its
   * `<name>/<version>` (for example `langchain/0.4.0`), sent as the
   * `X-SproutsData-Client` header so its traffic can be told apart. Letters,
   * digits, `.`, `_` and `-` on each side of the slash, and `+` also in the
   * version. `sproutsdata/tools` sets `js-tools/<version>` on its own copy of
   * the client unless one is set here.
   */
  integration?: string;
  /**
   * API keys are server-side credentials with a tenant's whole balance
   * behind them, and the API refuses browser requests outright
   * (`403 auth.browser_origin`). Constructing this client in a browser is
   * therefore an error unless you opt in explicitly.
   */
  dangerouslyAllowBrowser?: boolean;
}

/** What {@link SproutsData.withOptions} may change on the copy. */
export type SproutsDataCopyOptions = Pick<
  SproutsDataOptions,
  'timeoutMs' | 'maxRetries' | 'defaultHeaders' | 'integration'
>;

/** Everything a client was built from, resolved: what a copy starts from. */
type ResolvedOptions = Required<Omit<SproutsDataOptions, 'integration' | 'dangerouslyAllowBrowser'>> &
  Pick<SproutsDataOptions, 'integration' | 'dangerouslyAllowBrowser'>;

function isPlainObjectNonEmpty(value: unknown): boolean {
  return value !== null && typeof value === 'object' && Object.keys(value).length > 0;
}

/** An empty list or an empty object: a value that asks for nothing. */
function isEmptyValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return value !== null && typeof value === 'object' && Object.keys(value).length === 0;
}

/**
 * The params without the optional lists and `filters` that are empty. An
 * empty `sort` or `include_domains` asks for nothing, so it is not sent —
 * as the Python SDK leaves it out — and both SDKs put the same body on the
 * wire. That matters beyond tidiness: a cursor is signed over the request,
 * so a page fetched with `sort: []` and the next fetched without it would
 * not be the same request.
 */
function withoutEmpty<T extends object>(params: T, keys: ReadonlyArray<keyof T & string>): T {
  const kept = { ...params };
  for (const key of keys) {
    if (isEmptyValue(kept[key])) delete kept[key];
  }
  return kept;
}

/**
 * The `category` a search sends: the caller's, `company` when none is given
 * (as the Python SDK defaults it), and none at all for `auto` — an absent
 * category is how the API is asked to classify the query itself. What `auto`
 * then allows (`mode`, `filters`) is the server's to say.
 */
function wireCategory(category: SearchParams['category']): string | undefined {
  if (category === AUTO_CATEGORY) return undefined;
  return category ?? DEFAULT_SEARCH_CATEGORY;
}

/**
 * `https://` anywhere; `http://` only on the loopback hosts. A parsed URL is
 * echoed as scheme and host only, so userinfo in it never reaches a message.
 */
function validateBaseUrl(baseUrl: string): void {
  let url: URL | undefined;
  try {
    url = new URL(baseUrl);
  } catch {
    // Not a URL at all; reported below.
  }
  const shown = url === undefined ? baseUrl : `${url.protocol}//${url.host}`;
  ensure(
    url !== undefined && (url.protocol === 'https:' || url.protocol === 'http:'),
    `\`baseUrl\` must be an absolute https:// URL (got '${shown}')`,
  );
  ensure(
    url.protocol === 'https:' || LOOPBACK_HOSTS.includes(url.hostname),
    `\`baseUrl\` must use https:// — plain http:// would send the API key in the clear. ` +
      `http:// is accepted only for ${LOOPBACK_HOSTS.join(' and ')} (got '${url.origin}')`,
  );
}

/** Refuse an integration name the API could not attribute calls to. */
function validateIntegration(integration: unknown): void {
  if (integration === undefined) return;
  ensure(
    typeof integration === 'string' && INTEGRATION_PATTERN.test(integration),
    `\`integration\` must look like '<name>/<version>' — letters, digits, '.', '_' or '-' on ` +
      "each side, '+' also allowed in the version, for example 'langchain/0.4.0'. " +
      `Got ${typeof integration === 'string' ? `'${integration}'` : typeof integration}.`,
  );
}

export class SproutsData {
  // `#private`, so neither `JSON.stringify` nor `util.inspect` can reach the
  // transport or the settings, which hold the key. `toJSON` below prints a
  // redacted view.
  readonly #transport: Transport;
  readonly #settings: ResolvedOptions;

  /**
   * `POST /v1/entities/*` — records by id (or raw identifier), one method per
   * category: `companies`, `persons`, `patents`, `news`, `trends`,
   * `marketReports`, `fundings`, `academicReports`, `jobOpenings`.
   *
   * Billed 1 credit per record found; misses are returned (`found: false`),
   * not dropped, and are free. Requires `dsp.entities.read`.
   */
  readonly entities: Entities;

  /**
   * `POST /v1/relationships*` — who knows whom (`find`), who one person can
   * reach at a company (`reach`), the institutions two companies share
   * (`institutions`), and a question in words routed to whichever fits
   * (`ask`).
   *
   * 2 credits for the first 10 results, then 1 per next 10; `institutions` 2
   * flat. Requires `dsp.search.read`.
   */
  readonly relationships: Relationships;

  /**
   * `POST /v1/org-chart*` — one company's people counted by department and
   * seniority (`retrieve`), by sub-department (`departments`), and by
   * location (`locations`). A matrix, not a reporting tree.
   *
   * 1 credit flat per call. Requires `dsp.search.read`.
   */
  readonly orgChart: OrgChart;

  /**
   * `GET /v1/credits` and `GET /v1/keys/usage` — the tenant's balance
   * (`retrieve`) and the calling key's own spend (`usage`). Free; requires
   * `dsp.usage.read`.
   */
  readonly credits: Credits;

  /**
   * `GET /v1/usage/history*` — this credential's own billable runs: `list`,
   * `retrieve` (one run plus its replayable snapshot), and `metrics` (daily
   * rollups). Free; requires `dsp.usage.read`.
   */
  readonly history: History;

  /**
   * `/v1/agents/runs*` — asynchronous agentic runs: `create` (idempotent —
   * the SDK generates the key when you pass none; `dsp.agents.write`), `retrieve` / `wait` / `list` / `cancel` /
   * `results` / `events` (SSE) under `dsp.agents.read` or `.write`.
   */
  readonly runs: Runs;

  /**
   * `/v1/feedback*` — report a result or result set against one of your own
   * requests or agent runs, or a problem with the product (`create`), list
   * your reports (`list`, offset-paginated), read the tag vocabulary (`tags`),
   * and like, dislike or flag an answer (`votes.cast` / `votes.list`). Free.
   */
  readonly feedback: Feedback;

  /**
   * `/v1/lists*` — the workspace's saved lists: `list`, `create`, `rename`,
   * `delete`, `items` / `iterItems`, `addItems`, `removeItems` and `export`
   * (CSV). Free.
   */
  readonly lists: Lists;

  /**
   * `POST /v1/members/resolve` — whether one email belongs to a member of
   * this credential's organisation (`resolve`). Free.
   */
  readonly members: Members;

  constructor(options: SproutsDataOptions = {}) {
    const apiKey =
      options.apiKey ?? readEnvWithFallback(ENV_API_KEY, DEPRECATED_ENV_API_KEY);
    ensure(
      typeof apiKey === 'string' && apiKey.length > 0,
      `Missing API key. Pass \`apiKey\` or set the ${ENV_API_KEY} environment variable.`,
    );
    ensure(
      API_KEY_PATTERN.test(apiKey),
      'Invalid API key: keys look like `sk_dsp_live_…` or `sk_dsp_test_…` ' +
        '(`sk_<platform>_<live|test>_<secret>`).',
    );

    if (isBrowserLike() && options.dangerouslyAllowBrowser !== true) {
      throw new ClientValidationError(
        'SproutsData must not run in a browser: the API rejects browser requests ' +
          '(403 auth.browser_origin) and a key shipped to a browser is a key in ' +
          "every visitor's devtools. Call the API from your server. If you are " +
          'certain this environment is safe (e.g. an Electron main process), pass ' +
          '`dangerouslyAllowBrowser: true`.',
      );
    }

    const baseUrl =
      options.baseUrl ??
      readEnvWithFallback(ENV_BASE_URL, DEPRECATED_ENV_BASE_URL) ??
      DEFAULT_BASE_URL;
    validateBaseUrl(baseUrl);

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    ensure(Number.isFinite(timeoutMs) && timeoutMs > 0, '`timeoutMs` must be a positive number');
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    ensure(
      Number.isInteger(maxRetries) && maxRetries >= 0,
      '`maxRetries` must be a non-negative integer',
    );
    validateIntegration(options.integration);

    this.#settings = {
      apiKey,
      baseUrl,
      timeoutMs,
      maxRetries,
      fetch: options.fetch ?? globalThis.fetch,
      defaultHeaders: { ...options.defaultHeaders },
      integration: options.integration,
      dangerouslyAllowBrowser: options.dangerouslyAllowBrowser,
    };
    this.#transport = new Transport({
      baseUrl,
      apiKey,
      fetch: this.#settings.fetch,
      timeoutMs,
      maxRetries,
      userAgent: userAgent(),
      defaultHeaders: this.#settings.defaultHeaders,
      integration: options.integration,
    });
    this.entities = new Entities(this.#transport);
    this.relationships = new Relationships(this.#transport);
    this.orgChart = new OrgChart(this.#transport);
    this.credits = new Credits(this.#transport);
    this.history = new History(this.#transport);
    this.runs = new Runs(this.#transport);
    this.feedback = new Feedback(this.#transport);
    this.members = new Members(this.#transport);
    this.lists = new Lists(this.#transport);
  }

  /** What `JSON.stringify` shows: the configuration, with the key redacted. */
  toJSON(): Record<string, unknown> {
    return this.#transport.toJSON();
  }

  /** The `<name>/<version>` sent as `X-SproutsData-Client`, or undefined when none is set. */
  get integration(): string | undefined {
    return this.#settings.integration;
  }

  /**
   * A copy with different settings — same key, base URL and `fetch` — leaving
   * this client unchanged. Useful for one awkward call, a large batch that
   * needs longer or a billed request you would rather never retry:
   *
   * ```ts
   * await client.withOptions({ maxRetries: 0 }).search({ query: '…' });
   * ```
   *
   * `defaultHeaders` are added to this client's own. `integration` replaces
   * the copy's `X-SproutsData-Client` value, which is how a tool layer handed an
   * application's client names itself without changing what that client
   * sends.
   */
  withOptions(options: SproutsDataCopyOptions = {}): SproutsData {
    const settings = this.#settings;
    return new SproutsData({
      ...settings,
      timeoutMs: options.timeoutMs ?? settings.timeoutMs,
      maxRetries: options.maxRetries ?? settings.maxRetries,
      defaultHeaders: { ...settings.defaultHeaders, ...options.defaultHeaders },
      integration: options.integration ?? settings.integration,
    });
  }

  [INSPECT_CUSTOM](_depth: number, options: unknown, inspect?: InspectFn): unknown {
    return inspectView('SproutsData', this.toJSON(), options, inspect);
  }

  /**
   * Search companies, people, patents, news, trends, market reports, funding
   * rounds, or academic reports. Provide `query`, `filters`, or both.
   *
   * A hit's `id` is a search id, not a lookup key: to fetch the full record,
   * pass the hit to `lookupRef(hit)` and use what it returns with
   * `entities.companies` / `entities.persons`.
   *
   * Billed per result delivered: 0.5 credits (`fast`) or 0.595 (`auto`) for
   * the first 10, then 0.08 or 0.085 per extra result; `deep` at the agent
   * price of the effort it ran. Requires `dsp.search.read`.
   */
  async search(params: SearchParams, options?: RequestOptions): Promise<SearchEnvelope> {
    ensure(
      params !== null && typeof params === 'object',
      'search(params) requires a params object',
    );
    const keywordQuery = 'keyword_query' in params ? params.keyword_query : undefined;
    ensure(
      (typeof params.query === 'string' && params.query.length > 0) ||
        isPlainObjectNonEmpty(params.filters) ||
        keywordQuery !== undefined,
      'Provide `query`, `filters`, `keyword_query`, or a combination',
    );
    ensure(
      keywordQuery === undefined ||
        typeof keywordQuery === 'string' ||
        (keywordQuery !== null && typeof keywordQuery === 'object' && !Array.isArray(keywordQuery)),
      '`keyword_query` must be a keyword or a `{ and | or | not }` node',
    );
    assertNoRetiredFilters(params.filters);
    assertDeepTakesQueryOnly(params);
    validateSort(params.sort);

    const body = compact({
      ...withoutEmpty(params, ['filters', 'sort', 'include_domains', 'exclude_domains']),
      category: wireCategory(params.category),
    });
    return this.#transport.request('POST', '/v1/search', { body, routeClass: 'billed', options });
  }

  /**
   * Iterate search result pages, following `next_cursor` until the results
   * run out, `options.maxResults` rows have been yielded, or the server's
   * 10,000-row depth cap is reached (which stops with one warning).
   *
   * `params` is copied once, before the first request, and that copy is
   * re-sent for every page with only `cursor` — and, from page two,
   * `options.limit` — changed: the server's signed cursor refuses any other
   * change, so editing `params` mid-iteration cannot break the next page.
   * Each page is charged for the results it adds.
   */
  searchPages(
    params: SearchParams,
    options?: PageOptions,
  ): AsyncGenerator<SearchEnvelope, void, undefined> {
    return paginate((page, opts) => this.search(page, opts), params, options, envelopeShape());
  }

  /**
   * Look-alike ("companies like X") search from one or more anchors.
   *
   * Company-only: the server refuses another category rather than silently
   * substituting a different search. 2 credits for the first 10
   * results, then 1 per next 10; requires `dsp.search.read`.
   */
  async similar(params: SimilarParams, options?: RequestOptions): Promise<SearchEnvelope> {
    ensure(
      params !== null &&
        typeof params === 'object' &&
        Array.isArray(params.anchors) &&
        params.anchors.length > 0,
      'similar(params) requires at least one anchor in `anchors`',
    );
    params.anchors.forEach((anchor, i) => {
      ensure(
        typeof anchor?.value === 'string' && anchor.value.length > 0,
        `\`anchors[${i}].value\` must be a non-empty string`,
      );
    });
    assertNoRetiredFilters(params.filters);

    return this.#transport.request('POST', '/v1/similar', {
      body: compact({ ...withoutEmpty(params, ['filters']) }),
      routeClass: 'billed',
      options,
    });
  }

  /** Iterate look-alike result pages, as {@link SproutsData.searchPages} does. Each page is charged for the results it adds. */
  similarPages(
    params: SimilarParams,
    options?: PageOptions,
  ): AsyncGenerator<SearchEnvelope, void, undefined> {
    return paginate((page, opts) => this.similar(page, opts), params, options, envelopeShape());
  }

  /**
   * What the index holds — per-corpus counts, embedding coverage, and what is
   * known to be missing (`not_in_index`). Free; requires `dsp.search.read`.
   *
   * Distinct from `Envelope.coverage`, which is per-answer measured recall.
   */
  async coverage(params: CoverageParams = {}, options?: RequestOptions): Promise<CoverageResponse> {
    const query = { segment: params.segment, category: params.category };
    return this.#transport.request('GET', '/v1/coverage', { query, options });
  }

  /**
   * The values one filter accepts — for autocomplete and pickers. Page size
   * is fixed at 20 by the server. Free; requires `dsp.search.read`.
   *
   * Geography is looked up per level (`country`, `state`, `city`, `region`);
   * each answer belongs in `geo.places[].value` with the matching `level`.
   *
   * Two-level filters (`industry`, `sub_industry`, `department`) are walked
   * with `level: 'parents'` first, then `parent: '<name>'` per branch.
   */
  async filterValues(
    name: FilterName,
    params: FilterValuesParams = {},
    options?: RequestOptions,
  ): Promise<FilterValuesResponse> {
    ensure(typeof name === 'string' && name.length > 0, '`name` must be a filter name');
    assertNotRetiredFilter(name, `The '${name}' filter`);
    validateFilterValuesQuery(params);
    const query = {
      search: params.search,
      page: params.page === undefined ? undefined : String(params.page),
      parent: params.parent,
      level: params.level,
    };
    return this.#transport.request('GET', `/v1/search/filters/${pathSegment(name)}`, {
      query,
      options,
    });
  }

  /**
   * Every value a filter accepts, walking the pages for you. Page size is
   * fixed at 20 server-side, so a large vocabulary is many (free) requests —
   * pass `search` where you can. Stops at the last page, or at the first
   * empty one. `options.requestId` goes with the first page only.
   */
  async *iterFilterValues(
    name: FilterName,
    params: Omit<FilterValuesParams, 'page'> = {},
    options?: RequestOptions,
  ): AsyncGenerator<string, void, undefined> {
    const later = laterPageOptions(options ?? {});
    for (let page = 1; ; page++) {
      const result = await this.filterValues(name, { ...params, page }, page === 1 ? options : later);
      yield* result.values;
      if (!result.has_more || result.values.length === 0) return;
    }
  }

  /**
   * The values one *document* filter accepts — `filterValues` for the seven
   * document categories, whose filter names are that vertical's own and are
   * not mirrored in {@link FilterName}. An unknown name is a 404 from the
   * server. Page size is fixed at 20. Free; requires `dsp.search.read`.
   */
  async documentFilterValues(
    category: EntityCategory,
    name: string,
    params: DocumentFilterValuesParams = {},
    options?: RequestOptions,
  ): Promise<DocumentFilterValuesResponse> {
    ensure(
      typeof category === 'string' && category.length > 0,
      '`category` must be a document category',
    );
    ensure(
      !GTM_CATEGORIES.includes(category),
      `\`documentFilterValues\` is for the document categories; for '${category}' use ` +
        '`filterValues(name)`, whose vocabulary is typed',
    );
    ensure(typeof name === 'string' && name.length > 0, '`name` must be a filter name');
    assertNotRetiredFilter(name, `The '${name}' filter`);
    validateFilterValuesQuery(params);
    const query = {
      search: params.search,
      page: params.page === undefined ? undefined : String(params.page),
    };
    return this.#transport.request(
      'GET',
      `/v1/search/filters/${pathSegment(category)}/${pathSegment(name)}`,
      { query, options },
    );
  }

  /** Every value a document filter accepts, walking the pages as {@link SproutsData.iterFilterValues} does. */
  async *iterDocumentFilterValues(
    category: EntityCategory,
    name: string,
    params: Omit<DocumentFilterValuesParams, 'page'> = {},
    options?: RequestOptions,
  ): AsyncGenerator<string, void, undefined> {
    const later = laterPageOptions(options ?? {});
    for (let page = 1; ; page++) {
      const result = await this.documentFilterValues(
        category,
        name,
        { ...params, page },
        page === 1 ? options : later,
      );
      yield* result.values;
      if (!result.has_more || result.values.length === 0) return;
    }
  }

  /**
   * The sort catalogue for one category — every field `search`'s `sort` can
   * name, with labels, kinds, default directions and, for `company` /
   * `person`, which axis each applies to. Read live rather than hardcoded:
   * an empty `sorts` means the category takes no ordering instruction. Free;
   * requires `dsp.search.read`.
   */
  async sorts(category: EntityCategory, options?: RequestOptions): Promise<SortCatalogResponse> {
    ensure(typeof category === 'string' && category.length > 0, '`category` must be a category');
    return this.#transport.request('GET', `/v1/sorts/${pathSegment(category)}`, { options });
  }

  /**
   * Chosen records as a CSV file — the export behind a results table. At
   * most 1,000 items, named by their natural id as for `lists.addItems`.
   * Do-Not-Contact records are left out. Free; requires `dsp.search.read` or
   * `dsp.entities.read`. A {@link NotFoundError} with code
   * `export.not_enabled` while export is switched off.
   */
  async searchExport(params: SearchExportParams, options?: RequestOptions): Promise<CsvExport> {
    ensure(params !== null && typeof params === 'object', 'searchExport(params) requires a params object');
    const body: SearchExportParams = { items: checkItems(params.items) };
    if (params.request_id !== undefined) body.request_id = params.request_id;
    const raw = await this.#transport.requestBytes('POST', '/v1/search/export', {
      body,
      // Free today; priced through the meter once export pricing ships.
      routeClass: 'billed',
      options,
    });
    return toCsvExport(raw);
  }
}

/**
 * `Toolset`: the three Sprouts tools, ready for a model.
 *
 * A call goes through four steps, and only the third touches the network:
 *
 * 1. **Prepare** — parse the arguments, refuse what the schema or a tool rule
 *    refuses (as a result the model can read, never an exception), then lay
 *    the developer's settings over the model's: `defaults` under it, `fixed`
 *    over it, `baselineFilters` merged per filter key, `maxResults` as a
 *    ceiling.
 * 2. **Plan** — the exact client call, with everything shaping needs.
 * 3. **Execute** — one call on the `SproutsData` client.
 * 4. **Shape** — the response as contract 02 §12.2 describes it.
 *
 * The split between what the developer sets and what the model may choose
 * is the one the old adapters got right: cost and scope are never
 * model-settable. A `fixed` argument disappears from the schema the model
 * sees, so it cannot even be attempted; a baseline filter is merged in after
 * validation, and when it overrides something the model asked for, the
 * result says so rather than quietly answering a different question.
 *
 * Behaviour, messages and results match the Python SDK's
 * `sproutsdata.tools` byte for byte (`spec/tools/fixtures/`).
 */

import { SproutsData } from '../client';
import { ClientValidationError } from '../errors';
import type {
  EntitiesEnvelope,
  SearchEnvelope,
  SearchHit,
  SearchParams,
  SimilarAnchor,
  SimilarParams,
} from '../types';
import { VERSION } from '../version';
import { errorResult, fromError, invalidArguments, refused } from './errors';
import {
  anthropicAnswer,
  anthropicCalls,
  anthropicTool,
  chatAnswer,
  checkApi,
  openaiCalls,
  openaiTool,
  responsesAnswer,
  type OpenAIApi,
} from './providers';
import { resolvedSearch, shapeLookup, shapePage, wantedValues } from './shape';
import {
  clone,
  composeDescription,
  join,
  LOOKUP,
  SEARCH,
  SHAPING,
  SHORT_NAMES,
  SIMILAR,
  text,
  TOOL_NAMES,
  toJson,
  toolSpec,
} from './spec';
import type {
  AnthropicTool,
  AnthropicToolResult,
  JsonSchema,
  OpenAIChatTool,
  OpenAIChatToolMessage,
  OpenAIResponsesTool,
  OpenAIResponsesToolOutput,
  ToolArguments,
  ToolDefinition,
  ToolError,
  ToolName,
  ToolResult,
  ToolSettings,
} from './types';
import { applyDefaults, dropNulls, isObject, validate } from './validate';

/**
 * `X-SproutsData-Client` for calls a toolset makes, unless the caller names
 * their own integration (an adapter does: `langchain/<version>`).
 */
export const DEFAULT_INTEGRATION = `js-tools/${VERSION}`;

/**
 * The most rows a model may receive per call, whatever it asks for. A page
 * of 100 shaped rows is over 20,000 tokens of one tool result.
 */
export const MAX_RESULTS_CEILING = SHAPING.max_results_ceiling;

type Args = Record<string, unknown>;

/** Which tools to offer, and the arguments the application fixes. */
export interface CatalogOptions {
  /**
   * The tools to offer: full names, or `search`, `similar`, `lookup`.
   * Defaults to all three. Descriptions mention only tools in the set.
   */
  include?: readonly string[];
  /**
   * Per tool, arguments the application sets and the model never sees —
   * `{ sprouts_search: { category: 'person' } }`. Removed from that tool's
   * schema, and validated at construction.
   */
  fixed?: ToolSettings;
}

/** {@link CatalogOptions} plus the OpenAI choices. */
export interface OpenAIOptions {
  /** Send the strict-mode schema, so the model cannot produce arguments that do not fit it. Default true. */
  strict?: boolean;
  /** `chat` (Chat Completions, the default) or `responses`. */
  api?: OpenAIApi;
}

export interface ToolsetOptions extends CatalogOptions {
  /**
   * Per tool, arguments used when the model leaves them out —
   * `{ sprouts_search: { mode: 'auto' } }`. The model may still set them.
   */
  defaults?: ToolSettings;
  /**
   * The most rows one call returns, 1 to 25 (default 25): a cap on what the
   * model may ask for, not the page size. A call that names no `limit` gets 10,
   * and a model asking for more than the cap gets this many, with a caveat
   * saying so.
   */
  maxResults?: number;
  /**
   * Filters applied to every search and look-alike call, merged into the
   * model's per sub-key (`include`, `exclude`, `gte`, …). Where both set the
   * same key the application wins, and the result's `caveats` tell the model
   * its value was replaced.
   */
  baselineFilters?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /**
   * `<name>/<version>` for `X-SproutsData-Client`. Defaults to the client's
   * own, else `js-tools/<sdk version>`.
   */
  integration?: string;
}

function resolveNames(names: readonly string[] | undefined): ToolName[] {
  if (names === undefined) return [...TOOL_NAMES];
  if (typeof names === 'string') {
    throw new ClientValidationError('include must be a list of tool names, not a single string.');
  }
  const resolved = new Set<ToolName>();
  for (const name of names) {
    const full = SHORT_NAMES[name] ?? name;
    if (!TOOL_NAMES.includes(full as ToolName)) {
      throw new ClientValidationError(
        `Unknown tool '${name}'. Choose from ${TOOL_NAMES.join(', ')} ` +
          `(or ${Object.keys(SHORT_NAMES).join(', ')}).`,
      );
    }
    resolved.add(full as ToolName);
  }
  if (resolved.size === 0) throw new ClientValidationError('include must name at least one tool.');
  return TOOL_NAMES.filter((name) => resolved.has(name));
}

/**
 * Validate developer-set arguments (`fixed`, `defaults`) against each tool's
 * schema. Refused at construction, loudly: a typo here would otherwise
 * surface as a model mysteriously unable to do something, long after
 * deployment.
 */
function checkArguments(
  option: string,
  settings: ToolSettings | undefined,
  included: readonly ToolName[],
): Map<ToolName, Args> {
  const checked = new Map<ToolName, Args>();
  for (const [name, values] of Object.entries(settings ?? {})) {
    const tool = (SHORT_NAMES[name] ?? name) as ToolName;
    if (!included.includes(tool)) {
      throw new ClientValidationError(
        `${option} names '${name}', which is not in this toolset (${included.join(', ')}).`,
      );
    }
    const schema = toolSpec(tool).input_schema;
    const [value, problems] = validate({ ...schema, required: [] }, dropNulls(values), [option, tool]);
    if (problems.length > 0) throw new ClientValidationError(`Invalid ${option}: ${problems.join('; ')}`);
    checked.set(tool, value as Args);
  }
  return checked;
}

/** A tool schema with the developer's fixed arguments taken out of the model's view. */
function without(schema: JsonSchema, names: readonly string[]): JsonSchema {
  const out = clone(schema);
  for (const name of names) delete out.properties?.[name];
  if (out.required !== undefined) out.required = out.required.filter((name) => !names.includes(name));
  return out;
}

interface CatalogEntry {
  name: ToolName;
  description: string;
  inputSchema: JsonSchema;
  strictInputSchema: JsonSchema;
  refusedArguments: Readonly<Record<string, string>>;
  fullSchema: JsonSchema;
}

/** Which tools are offered, and how each is described to a model. */
class Catalog {
  readonly included: readonly ToolName[];
  readonly fixed: Map<ToolName, Args>;
  readonly entries = new Map<ToolName, CatalogEntry>();

  constructor(options: CatalogOptions) {
    this.included = Object.freeze(resolveNames(options.include));
    this.fixed = checkArguments('fixed', options.fixed, this.included);
    for (const name of this.included) {
      const spec = toolSpec(name);
      const hidden = Object.keys(this.fixed.get(name) ?? {});
      this.entries.set(name, {
        name,
        description: composeDescription(name, this.included),
        inputSchema: without(spec.input_schema, hidden),
        strictInputSchema: without(spec.strict_input_schema, hidden),
        refusedArguments: spec.refused_arguments,
        fullSchema: spec.input_schema,
      });
    }
  }

  definitions(): ToolDefinition[] {
    return [...this.entries.values()].map((entry) => ({
      name: entry.name,
      description: entry.description,
      input_schema: clone(entry.inputSchema),
    }));
  }

  openai({ strict = true, api = 'chat' }: OpenAIOptions): Array<OpenAIChatTool | OpenAIResponsesTool> {
    checkApi(api);
    return [...this.entries.values()].map((entry) =>
      openaiTool(
        entry.name,
        entry.description,
        clone(strict ? entry.strictInputSchema : entry.inputSchema),
        strict,
        api,
      ),
    );
  }

  anthropic(): AnthropicTool[] {
    return [...this.entries.values()].map((entry) =>
      anthropicTool(entry.name, entry.description, clone(entry.inputSchema)),
    );
  }
}

/** One prepared call: what to send, and what shaping the answer needs. */
interface Plan {
  tool: ToolName;
  params: Args;
  category: string;
  fields?: string[];
  filters?: Args;
  askedInWords: boolean;
  anchors: SimilarAnchor[];
  byWasSet: boolean;
  caveats: string[];
}

/**
 * The arguments as an object, or the error result saying why not. An empty
 * string or nothing at all is an empty object: some providers send `""` for
 * a call with no arguments.
 */
function parseArguments(args: unknown): { args: Args } | { failure: ToolError } {
  if (args === null || args === undefined || args === '') return { args: {} };
  let parsed: unknown = args;
  if (typeof args === 'string') {
    try {
      parsed = JSON.parse(args);
    } catch {
      return { failure: errorResult('invalid_arguments', text('validation', 'not_json')) };
    }
  }
  if (!isObject(parsed)) {
    return { failure: errorResult('invalid_arguments', text('validation', 'not_an_object')) };
  }
  return { args: parsed };
}

function firstDuplicate(sort: ReadonlyArray<{ field: string }>): string | undefined {
  const seen = new Set<string>();
  for (const clause of sort) {
    if (seen.has(clause.field)) return clause.field;
    seen.add(clause.field);
  }
  return undefined;
}

/** `HTTPS://www.Stripe.com/about` and `stripe.com` name the same company. */
function normalizeDomain(value: string): string {
  let lowered = value.trim().toLowerCase();
  const scheme = lowered.indexOf('://');
  if (scheme !== -1) lowered = lowered.slice(scheme + 3);
  if (lowered.startsWith('www.')) lowered = lowered.slice(4);
  return lowered.split('/')[0] ?? '';
}

/** JSON values compared by content, object key order ignored. */
function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  }
  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) return false;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
    );
  }
  return a === b;
}

function isNonEmptyList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

/**
 * A `SproutsData` client, from this copy of the SDK or another. Recognised
 * by the methods a toolset calls rather than by `instanceof`: an application
 * may hold a client from a second copy — another installed version, or the
 * CommonJS build beside the ES module one — and that client works the same.
 */
function isClient(value: unknown): value is SproutsData {
  if (value instanceof SproutsData) return true;
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<Record<'withOptions' | 'search' | 'similar' | 'entities', unknown>>;
  return (
    typeof candidate.withOptions === 'function' &&
    typeof candidate.search === 'function' &&
    typeof candidate.similar === 'function' &&
    candidate.entities !== null &&
    typeof candidate.entities === 'object'
  );
}

/** True when `value` is a tool error rather than a plan. */
function isError(value: Plan | ToolError): value is ToolError {
  return 'error' in value;
}

/**
 * The Sprouts tools over a `SproutsData` client.
 *
 * ```ts
 * import { SproutsData } from 'sproutsdata';
 * import { Toolset } from 'sproutsdata/tools';
 *
 * const tools = new Toolset(new SproutsData());
 * const response = await openai.chat.completions.create({ model, messages, tools: tools.openai() });
 * const message = response.choices[0].message;
 * messages.push(message, ...(await tools.handleOpenAIToolCalls(message)));
 * ```
 *
 * Calls go through a copy of the client that sends `X-SproutsData-Client`;
 * the client itself is not changed. Every option is checked here, and an
 * invalid one throws `ClientValidationError` before anything is sent.
 */
export class Toolset {
  readonly #catalog: Catalog;
  readonly #defaults: Map<ToolName, Args>;
  readonly #maxResults: number;
  readonly #baseline: Map<string, Args>;
  readonly #client: SproutsData;

  constructor(client: SproutsData, options: ToolsetOptions = {}) {
    if (!isClient(client)) {
      throw new TypeError(`Toolset needs a SproutsData client, got ${String(client)}.`);
    }
    this.#catalog = new Catalog(options);
    this.#defaults = checkArguments('defaults', options.defaults, this.#catalog.included);
    for (const [tool, values] of this.#defaults) {
      const fixed = this.#catalog.fixed.get(tool) ?? {};
      const clash = Object.keys(values).filter((key) => Object.hasOwn(fixed, key)).sort();
      if (clash.length > 0) {
        throw new ClientValidationError(`${tool}: ${clash.join(', ')} cannot be both fixed and defaulted.`);
      }
    }
    const maxResults = options.maxResults ?? MAX_RESULTS_CEILING;
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS_CEILING) {
      throw new ClientValidationError(
        `maxResults must be an integer from 1 to ${MAX_RESULTS_CEILING}, got ${String(maxResults)}.`,
      );
    }
    this.#maxResults = maxResults;
    this.#baseline = Toolset.#checkBaseline(options.baselineFilters);

    // The application's client is left as it is; calls from the toolset go
    // through a copy that names itself.
    const name = options.integration || client.integration || DEFAULT_INTEGRATION;
    this.#client = client.integration === name ? client : client.withOptions({ integration: name });
  }

  static #checkBaseline(baseline: ToolsetOptions['baselineFilters']): Map<string, Args> {
    const checked = new Map<string, Args>();
    for (const [name, value] of Object.entries(baseline ?? {})) {
      if (!isObject(value) || Object.keys(value).length === 0) {
        throw new ClientValidationError(
          `baselineFilters['${name}'] must be a non-empty filter object, such as ` +
            '{ include: [...] } or { gte: ... }.',
        );
      }
      checked.set(name, clone(value));
    }
    return checked;
  }

  // -- what the model is shown ------------------------------------------------

  /** The tools this set answers for. Route only these names to {@link Toolset.run}. */
  get toolNames(): readonly ToolName[] {
    return this.#catalog.included;
  }

  /** Provider-neutral tool specs: `[{ name, description, input_schema }]`. */
  definitions(): ToolDefinition[] {
    return this.#catalog.definitions();
  }

  /**
   * OpenAI function tools, for `api: 'chat'` (Chat Completions, the default)
   * or `'responses'`. `strict` (default true) sends the strict-mode schema,
   * so the model cannot produce arguments that do not match it.
   */
  openai(options: OpenAIOptions = {}): Array<OpenAIChatTool | OpenAIResponsesTool> {
    return this.#catalog.openai(options);
  }

  /** Anthropic Messages API tool definitions. */
  anthropic(): AnthropicTool[] {
    return this.#catalog.anthropic();
  }

  // -- run ----------------------------------------------------------------------

  /**
   * Run one tool call. Resolves to the result, or to `{ error: {...} }` the
   * model can act on — an unknown tool name, bad arguments and API failures
   * included.
   *
   * Throws only what the model cannot fix: `AuthenticationError`,
   * `PermissionDeniedError` and `InsufficientCreditsError`.
   */
  async run(name: string, args?: ToolArguments): Promise<ToolResult> {
    const plan = this.#prepare(name, args);
    if (isError(plan)) return plan;
    let response: SearchEnvelope | EntitiesEnvelope<Record<string, unknown>>;
    try {
      response = await this.#execute(plan);
    } catch (err) {
      return fromError(err);
    }
    return this.#finish(plan, response as unknown as Record<string, unknown>);
  }

  /**
   * Run every function call in an OpenAI message; resolve to the messages
   * answering them, in order.
   *
   * Takes a Chat Completions assistant message (or its `tool_calls`) or a
   * Responses API response (or its `output`), and returns `role: 'tool'`
   * messages or `function_call_output` items to send back. Every call is
   * answered — an unknown tool name or bad arguments included — so the next
   * request is valid.
   */
  async handleOpenAIToolCalls(
    message: unknown,
  ): Promise<Array<OpenAIChatToolMessage | OpenAIResponsesToolOutput>> {
    const answers: Array<OpenAIChatToolMessage | OpenAIResponsesToolOutput> = [];
    for (const call of openaiCalls(message)) {
      const content = toJson(await this.run(call.name, call.arguments as ToolArguments));
      answers.push(call.kind === 'chat' ? chatAnswer(call, content) : responsesAnswer(call, content));
    }
    return answers;
  }

  /**
   * Run every `tool_use` block in an Anthropic message (or list of content
   * blocks); resolve to the `tool_result` blocks, in order. Send them back as
   * the content of the next `user` message. Every block is answered, an
   * unknown tool name included, and a failed call carries `is_error: true`.
   */
  async handleAnthropicToolUse(message: unknown): Promise<AnthropicToolResult[]> {
    const answers: AnthropicToolResult[] = [];
    for (const call of anthropicCalls(message)) {
      const result = await this.run(call.name, call.arguments as ToolArguments);
      answers.push(anthropicAnswer(call, toJson(result), 'error' in result));
    }
    return answers;
  }

  // -- prepare ------------------------------------------------------------------

  #prepare(name: string, args: unknown): Plan | ToolError {
    const entry = isToolName(name) ? this.#catalog.entries.get(name) : undefined;
    if (entry === undefined) {
      return errorResult(
        'unknown_tool',
        text('errors', 'unknown_tool', { name, available: join(this.toolNames) }),
      );
    }
    const parsed = parseArguments(args);
    if ('failure' in parsed) return parsed.failure;
    const given = dropNulls(parsed.args) as Args;

    const properties = entry.inputSchema.properties ?? {};
    const trapped = Object.entries(entry.refusedArguments).filter(
      ([key]) => Object.hasOwn(given, key) && !Object.hasOwn(properties, key),
    );
    const trappedKeys = new Set(trapped.map(([key]) => key));
    const [checked, problems] = validate(
      entry.inputSchema,
      Object.fromEntries(Object.entries(given).filter(([key]) => !trappedKeys.has(key))),
    );
    const allProblems = [...trapped.map(([key, message]) => `${key}: ${message}`), ...problems];
    if (allProblems.length > 0) return invalidArguments(allProblems);

    const validated = checked as Args;
    const fixed = this.#catalog.fixed.get(entry.name) ?? {};
    const explicitLimit = Object.hasOwn(fixed, 'limit') ? undefined : (validated.limit as number | undefined);
    const merged = applyDefaults(entry.fullSchema, {
      ...clone(this.#defaults.get(entry.name) ?? {}),
      ...validated,
      ...clone(fixed),
    }) as Args;
    if (entry.name === SEARCH) return this.#planSearch(merged, explicitLimit);
    if (entry.name === SIMILAR) return this.#planSimilar(merged, explicitLimit);
    return Toolset.#planLookup(merged);
  }

  /**
   * The model's filters under the application's, merged per sub-key. Per
   * sub-key rather than per filter: a baseline `industry.include` must not
   * silently discard the model's `industry.exclude`. Where both set the same
   * key the application wins, and the model is told.
   */
  #mergeFilters(requested: Args | undefined): [Args | undefined, string[]] {
    if (this.#baseline.size === 0) return [requested, []];
    const merged: Args = clone(requested ?? {});
    const notes: string[] = [];
    for (const [name, baseline] of this.#baseline) {
      const mine = merged[name];
      const combined: Args = isObject(mine) ? { ...mine } : {};
      for (const [key, value] of Object.entries(baseline)) {
        if (Object.hasOwn(combined, key) && !sameJson(combined[key], value)) {
          notes.push(
            text('caveats', 'application_filter', {
              path: `${name}.${key}`,
              value,
              requested: combined[key],
            }),
          );
        }
        combined[key] = clone(value);
      }
      merged[name] = combined;
    }
    return [merged, notes];
  }

  #cap(limit: number, explicit: number | undefined): [number, string[]] {
    if (limit <= this.#maxResults) return [limit, []];
    const notes =
      explicit === undefined
        ? []
        : [text('caveats', 'limit_capped', { requested: explicit, limit: this.#maxResults })];
    return [this.#maxResults, notes];
  }

  #planSearch(args: Args, explicitLimit: number | undefined): Plan | ToolError {
    const category = args.category as string;
    const query = args.query as string | undefined;
    const filters = args.filters as Args | undefined;
    const sort = (args.sort ?? []) as Array<{ field: string }>;
    const domains = isNonEmptyList(args.include_domains) || isNonEmptyList(args.exclude_domains);

    // An empty `filters` and a blank `query` say nothing, so they count as
    // absent: refused here, in the words every SDK uses, rather than by
    // whatever the client or the server says about an empty search.
    const blankQuery = query === undefined || query.trim() === '';
    const emptyFilters = filters === undefined || Object.keys(filters).length === 0;
    if (blankQuery && emptyFilters) return refused(text('rules', 'needs_query_or_filters'));
    const auto = category === 'auto';
    if (auto) {
      if (query === undefined) return refused(text('rules', 'auto_needs_query'));
      if (args.mode !== 'auto') return refused(text('rules', 'auto_needs_auto_mode'));
      if (filters !== undefined || domains || sort.length > 0) {
        return refused(text('rules', 'auto_takes_query_only'));
      }
      if (this.#baseline.size > 0) return refused(text('rules', 'auto_conflicts_with_application'));
    } else if (domains && !SHAPING.domain_categories.includes(category)) {
      return refused(text('rules', 'domains_need_entity_category', { category }));
    }
    const duplicate = firstDuplicate(sort);
    if (duplicate !== undefined) return refused(text('rules', 'sort_duplicate_field', { field: duplicate }));

    const [mergedFilters, notes] = auto ? [undefined, []] : this.#mergeFilters(filters);
    const [limit, capped] = this.#cap(args.limit as number, explicitLimit);
    // `auto` is passed on as given: the client's `search` leaves `category`
    // off the wire for it, which is how the API is asked to classify the query.
    const params: Args = { mode: args.mode, limit, category };
    // An empty list is passed on as given: the client leaves it off the wire.
    for (const key of ['query', 'include_domains', 'exclude_domains', 'sort', 'cursor']) {
      if (Object.hasOwn(args, key)) params[key] = args[key];
    }
    if (mergedFilters !== undefined && Object.keys(mergedFilters).length > 0) params.filters = mergedFilters;
    return {
      tool: SEARCH,
      params,
      category,
      fields: args.fields as string[] | undefined,
      filters: mergedFilters,
      askedInWords: query !== undefined,
      anchors: [],
      byWasSet: false,
      caveats: [...notes, ...capped],
    };
  }

  #planSimilar(args: Args, explicitLimit: number | undefined): Plan {
    const anchors = args.anchors as SimilarAnchor[];
    const [mergedFilters, notes] = this.#mergeFilters(args.filters as Args | undefined);
    const [limit, capped] = this.#cap(args.limit as number, explicitLimit);
    // Look-alike search is company-only; the category is sent as the
    // Python SDK sends it, so both put the same body on the wire.
    const params: Args = { anchors, category: 'company', combine: args.combine, limit };
    if (mergedFilters !== undefined && Object.keys(mergedFilters).length > 0) params.filters = mergedFilters;
    if (Object.hasOwn(args, 'cursor')) params.cursor = args.cursor;

    // What the response cannot say: which anchors resolved, and whether a
    // name picked the company the model meant.
    if (anchors.length > 1) notes.push(text('caveats', 'anchors_unreported', { count: anchors.length }));
    const byName = anchors.filter((anchor) => anchor.by === 'name').map((anchor) => anchor.value);
    if (byName.length > 0) notes.push(text('caveats', 'anchors_by_name', { names: join(byName) }));
    const unweighted = anchors.filter((anchor) => anchor.weight === 0).map((anchor) => anchor.value);
    if (unweighted.length > 0) notes.push(text('caveats', 'anchors_zero_weight', { names: join(unweighted) }));
    return {
      tool: SIMILAR,
      params,
      category: 'company',
      fields: args.fields as string[] | undefined,
      filters: mergedFilters,
      askedInWords: false,
      anchors,
      byWasSet: false,
      caveats: [...notes, ...capped],
    };
  }

  static #planLookup(args: Args): Plan | ToolError {
    const category = args.category as string;
    const by = args.by as string | undefined;
    const rules = SHAPING.lookup_by[category] ?? { accepts: [], default: null };
    if (by !== undefined) {
      if (rules.accepts.length === 0) return refused(text('rules', 'by_not_accepted', { category }));
      if (category === 'person' && by === 'domain') return refused(text('rules', 'person_has_no_domain'));
      if (!rules.accepts.includes(by)) {
        return refused(text('rules', 'by_not_valid', { by, category, allowed: join(rules.accepts) }));
      }
    }
    const sent = by ?? rules.default;
    const params: Args = { ids: args.ids };
    if (sent !== null) params.by = sent;
    if (Object.hasOwn(args, 'fields')) params.fields = args.fields;
    return {
      tool: LOOKUP,
      params,
      category,
      fields: args.fields as string[] | undefined,
      askedInWords: false,
      anchors: [],
      byWasSet: by !== undefined,
      caveats: [],
    };
  }

  // -- execute ------------------------------------------------------------------

  #execute(plan: Plan): Promise<SearchEnvelope | EntitiesEnvelope<Record<string, unknown>>> {
    const client = this.#client;
    if (plan.tool === SEARCH) return client.search(plan.params as unknown as SearchParams);
    if (plan.tool === SIMILAR) return client.similar(plan.params as unknown as SimilarParams);
    // Typed as the part every category shares; `by` and `fields` ride along.
    const params = plan.params as { ids: string[] };
    switch (plan.category) {
      case 'company':
        return client.entities.companies(params);
      case 'person':
        return client.entities.persons(params);
      case 'patent':
        return client.entities.patents(params);
      case 'news_article':
        return client.entities.news(params);
      case 'trend':
        return client.entities.trends(params);
      case 'market_report':
        return client.entities.marketReports(params);
      case 'funding_round':
        return client.entities.fundings(params);
      case 'academic_report':
        return client.entities.academicReports(params);
      default:
        return client.entities.jobOpenings(params);
    }
  }

  // -- shape --------------------------------------------------------------------

  #finish(plan: Plan, body: Record<string, unknown>): ToolResult {
    if (plan.tool === LOOKUP) return shapeLookup(body, plan.category, plan.fields, plan.byWasSet);
    let hits = (Array.isArray(body.results) ? body.results : []).filter(isObject) as SearchHit[];
    const caveats = [...plan.caveats];
    if (plan.tool === SIMILAR) {
      // A company is not a look-alike of itself; the engine sometimes returns
      // an anchor anyway, wasting a row on a known answer. Only domain anchors
      // can be matched to a row with certainty.
      const anchors = new Set(
        plan.anchors.filter((anchor) => anchor.by === 'domain').map((anchor) => normalizeDomain(anchor.value)),
      );
      const hitId = (hit: SearchHit): string => (typeof hit.id === 'string' ? hit.id : '');
      const removed = hits
        .filter((hit) => anchors.has(normalizeDomain(String(hit.domain || hitId(hit)))))
        .map(hitId);
      if (removed.length > 0) {
        hits = hits.filter((hit) => !removed.includes(hitId(hit)));
        caveats.push(text('caveats', 'anchors_removed', { ids: join(removed) }));
      }
    }
    const resolved = resolvedSearch(body);
    return shapePage(body, {
      hits,
      category: plan.category,
      fields: plan.fields,
      wanted: wantedValues(plan.filters, resolved === undefined ? undefined : ((resolved.filters ?? {}) as Args)),
      withLookup: this.toolNames.includes(LOOKUP),
      askedInWords: plan.askedInWords,
      caveats,
    });
  }
}

/** Provider-neutral tool specs, without a client. See {@link Toolset} for the options. */
export function definitions(options: CatalogOptions = {}): ToolDefinition[] {
  return new Catalog(options).definitions();
}

/** OpenAI function tools, without a client. See {@link Toolset.openai}. */
export function openai(
  options: CatalogOptions & OpenAIOptions = {},
): Array<OpenAIChatTool | OpenAIResponsesTool> {
  return new Catalog(options).openai(options);
}

/** Anthropic tool definitions, without a client. See {@link Toolset.anthropic}. */
export function anthropic(options: CatalogOptions = {}): AnthropicTool[] {
  return new Catalog(options).anthropic();
}

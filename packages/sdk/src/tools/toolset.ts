/**
 * `Toolset`: the three Sprouts tools over a `SproutsData` client.
 *
 * A call goes through four steps, and only the third touches the network:
 *
 * 1. **Prepare**: parse the arguments, refuse what the schema or a tool rule refuses (as a result
 *    the model can read, never an exception), then lay the application's settings over the
 *    model's: `defaults` under them, `fixed` over them, `baselineFilters` merged per filter key,
 *    `maxResults` as a ceiling.
 * 2. **Plan**: the exact client call (`plan.ts`).
 * 3. **Execute**: one call on the client (`execute.ts`).
 * 4. **Shape**: the response as the model reads it (`shape.ts`).
 */

import type { SearchEnvelope, SproutsData } from '../index.js';
import { isLookupArguments, isSearchArguments, isSimilarArguments, parseArguments } from './args.js';
import { Catalog, checkSettings, type OfferedTool } from './catalog-set.js';
import { join, LOOKUP, MAX_RESULTS_CEILING, SIMILAR, text, toolName } from './catalog.js';
import { isSproutsData } from './connection.js';
import { type ErrorResult, error, fromError, invalidArguments } from './errors.js';
import { executeLookup, executePage } from './execute.js';
import { type LookupPlan, type PagePlan, type Plan, planLookup, planSearch, planSimilar, type Settings } from './plan.js';
import { anthropicAnswer, anthropicCalls, chatAnswer, openaiCalls, responsesAnswer, type ToolCall } from './providers.js';
import { type PageShaping, shapeLookup, shapePage, wantedValues } from './shape.js';
import { toJson } from './canonical.js';
import type {
  AnthropicTool,
  AnthropicToolResult,
  OpenAIChatTool,
  OpenAIChatToolMessage,
  OpenAIResponsesTool,
  OpenAIResponsesToolOutput,
  ToolArguments,
  ToolDefinition,
  ToolName,
  ToolResult,
  ToolSettings,
} from './types.js';
import { applyDefaults, dropNulls, isObject, validate, withDefaultsRequired } from './validate.js';

/** What a toolset is built with, beside its client. */
export interface ToolsetOptions {
  /** Which tools to offer: full names or `search`, `similar`, `lookup` (default all three). */
  readonly include?: readonly string[];
  /** Per tool, arguments the application sets and the model never sees (removed from its schema). */
  readonly fixed?: ToolSettings;
  /** Per tool, arguments used when the model leaves them out. The model may still set them. */
  readonly defaults?: ToolSettings;
  /** The most rows one call returns, 1 to 25 (default 25): a cap on what the model may ask for. */
  readonly maxResults?: number;
  /** Filters every search and look-alike carries, merged into the model's per sub-key; the application wins. */
  readonly baselineFilters?: ToolSettings;
}

function checkBaseline(baseline: ToolSettings | undefined): Settings['baseline'] {
  const checked: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [name, given] of Object.entries(baseline ?? {})) {
    const value: unknown = given; // a caller without types may pass anything
    if (!isObject(value) || Object.keys(value).length === 0) {
      throw new TypeError(`baselineFilters['${name}'] must be a non-empty filter object, such as { include: [...] } or { gte: ... }.`);
    }
    checked[name] = structuredClone(value);
  }
  return checked;
}

function checkCap(maxResults: unknown): number {
  if (typeof maxResults !== 'number' || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS_CEILING) {
    throw new TypeError(`maxResults must be an integer from 1 to ${String(MAX_RESULTS_CEILING)}, got ${String(maxResults)}.`);
  }
  return maxResults;
}

/**
 * The model's arguments checked against the schema it was shown, or the error listing every
 * problem. A refused argument (`page`, `offset`) is answered with what to use instead.
 */
function check(offered: OfferedTool, given: unknown): [Readonly<Record<string, unknown>>, undefined] | [undefined, ErrorResult] {
  const present = isObject(given) ? given : {};
  const known = offered.inputSchema.properties ?? {};
  const trapped = Object.entries(offered.refusedArguments).filter(([key]) => Object.hasOwn(present, key) && !Object.hasOwn(known, key));
  const rest = Object.fromEntries(Object.entries(present).filter(([key]) => !trapped.some(([refused]) => refused === key)));
  const [checked, problems] = validate(offered.inputSchema, rest);
  const all = [...trapped.map(([key, message]) => `${key}: ${message}`), ...problems];
  return all.length > 0 || !isObject(checked) ? [undefined, invalidArguments(all)] : [checked, undefined];
}

/** `https://www.Stripe.com/about` and `stripe.com` name the same company. */
function domainOf(value: string): string {
  let lowered = value.trim().toLowerCase();
  const scheme = lowered.indexOf('://');
  if (scheme >= 0) lowered = lowered.slice(scheme + 3);
  if (lowered.startsWith('www.')) lowered = lowered.slice(4);
  return lowered.split('/', 1)[0] ?? '';
}

/**
 * The Sprouts tools over a `SproutsData` client.
 *
 * ```ts
 * const tools = new Toolset(new SproutsData());
 * const response = await openai.chat.completions.create({ ..., tools: tools.openai() });
 * messages.push(...(await tools.handleOpenAIToolCalls(response.choices[0].message)));
 * ```
 *
 * What a model can fix comes back as data (`{ error: {...} }`); what only the application can
 * fix (a rejected key, a missing scope, no credits) is thrown.
 */
export class Toolset {
  readonly #client: SproutsData;
  readonly #catalog: Catalog;
  readonly #defaults: ReadonlyMap<ToolName, Readonly<Record<string, unknown>>>;
  readonly #settings: Settings;

  /**
   * @throws {ClientValidationError} An option names an unknown tool or sets an invalid argument.
   * @throws {TypeError} `client` is not a `SproutsData` client, or `maxResults` or `baselineFilters` is invalid.
   */
  constructor(client: SproutsData, options: ToolsetOptions = {}) {
    if (!isSproutsData(client)) throw new TypeError('Toolset needs a SproutsData client.');
    this.#client = client;
    this.#catalog = new Catalog(options.include, options.fixed);
    this.#defaults = checkSettings('defaults', options.defaults, this.#catalog.included);
    for (const [tool, values] of this.#defaults) {
      const clash = Object.keys(values).filter((key) => Object.hasOwn(this.#catalog.fixed.get(tool) ?? {}, key));
      if (clash.length > 0) throw new TypeError(`${tool}: ${clash.join(', ')} cannot be both fixed and defaulted.`);
    }
    this.#settings = { maxResults: checkCap(options.maxResults ?? MAX_RESULTS_CEILING), baseline: checkBaseline(options.baselineFilters) };
  }

  /** The tools this set answers for. Route only these names to `run()`. */
  get toolNames(): readonly ToolName[] {
    return this.#catalog.included;
  }

  /** Provider-neutral tool specs: `[{ name, description, input_schema }]`. */
  definitions(): ToolDefinition[] {
    return this.#catalog.definitions();
  }

  /** OpenAI function tools, for `api: 'chat'` (the default) or `'responses'`; `strict` (default true) sends the strict schema. */
  openai(options: { readonly strict?: boolean; readonly api?: 'chat' | 'responses' } = {}): (OpenAIChatTool | OpenAIResponsesTool)[] {
    return this.#catalog.openai(options.strict ?? true, options.api ?? 'chat');
  }

  /** Anthropic Messages API tool definitions. */
  anthropic(): AnthropicTool[] {
    return this.#catalog.anthropic();
  }

  /**
   * Run one tool call: the result, or `{ error: {...} }` the model can act on.
   *
   * @throws {AuthenticationError | PermissionDeniedError | InsufficientCreditsError} Only what the model cannot fix.
   */
  async run(name: string, args?: ToolArguments): Promise<ToolResult> {
    const plan = this.#prepare(name, args);
    if (!('tool' in plan)) return plan;
    return plan.tool === LOOKUP ? this.#lookup(plan) : this.#page(plan);
  }

  async #page(plan: PagePlan): Promise<ToolResult> {
    let page: SearchEnvelope;
    try {
      page = await executePage(this.#client, plan);
    } catch (failure) {
      return fromError(failure);
    }
    return shapePage(page, this.#pageShaping(plan, page));
  }

  async #lookup(plan: LookupPlan): Promise<ToolResult> {
    try {
      return shapeLookup(await executeLookup(this.#client, plan), plan.category, plan.fields, plan.byWasSet);
    } catch (failure) {
      return fromError(failure);
    }
  }

  /**
   * Run every function call in an OpenAI message; resolve to the messages answering them. Takes a
   * Chat Completions assistant message or a Responses API response. Every call is answered.
   */
  async handleOpenAIToolCalls(message: unknown): Promise<(OpenAIChatToolMessage | OpenAIResponsesToolOutput)[]> {
    const answers: (OpenAIChatToolMessage | OpenAIResponsesToolOutput)[] = [];
    for (const call of openaiCalls(message)) {
      const content = toJson(await this.#runCall(call));
      answers.push(call.kind === 'responses' ? responsesAnswer(call, content) : chatAnswer(call, content));
    }
    return answers;
  }

  /** Run every `tool_use` block in an Anthropic message; resolve to the `tool_result` blocks. */
  async handleAnthropicToolUse(message: unknown): Promise<AnthropicToolResult[]> {
    const answers: AnthropicToolResult[] = [];
    for (const call of anthropicCalls(message)) {
      const result = await this.#runCall(call);
      answers.push(anthropicAnswer(call, toJson(result), 'error' in result));
    }
    return answers;
  }

  #runCall(call: ToolCall): Promise<ToolResult> {
    const args: unknown = call.arguments;
    // Anything else a provider sent is handed on as JSON text, which the parser then refuses.
    const given: ToolArguments = typeof args === 'string' || isObject(args) || args === null || args === undefined ? args : JSON.stringify(args);
    return this.run(call.name, given);
  }

  #prepare(name: string, args: ToolArguments): Plan | ErrorResult {
    const offered = this.#offered(name);
    if (offered === undefined) {
      return error('unknown_tool', text('errors', 'unknown_tool', { name, available: join(this.#catalog.included) }));
    }
    const tool = offered.name;
    const [parsed, failure] = parseArguments(args);
    if (parsed === undefined) return failure;
    const [checked, refusal] = check(offered, dropNulls(parsed));
    if (checked === undefined) return refusal;
    const fixed = this.#catalog.fixed.get(tool) ?? {};
    const explicit = Object.hasOwn(fixed, 'limit') ? undefined : checked['limit'];
    const merged = applyDefaults(offered.fullSchema, { ...structuredClone(this.#defaults.get(tool) ?? {}), ...checked, ...structuredClone(fixed) });
    return this.#plan(tool, merged, typeof explicit === 'number' ? explicit : undefined);
  }

  /** The tool `name` (a full name, exactly) in this set, else `undefined`. */
  #offered(name: string): OfferedTool | undefined {
    const tool = toolName(name);
    return tool === undefined || tool !== name ? undefined : this.#catalog.offered.get(tool);
  }

  #plan(tool: ToolName, merged: unknown, explicitLimit: number | undefined): Plan | ErrorResult {
    switch (tool) {
      case 'sprouts_search':
        return isSearchArguments(merged) ? planSearch(this.#settings, merged, explicitLimit) : this.#refuse(tool, merged);
      case 'sprouts_similar':
        return isSimilarArguments(merged) ? planSimilar(this.#settings, merged, explicitLimit) : this.#refuse(tool, merged);
      case 'sprouts_entity_lookup':
        return isLookupArguments(merged) ? planLookup(merged) : this.#refuse(tool, merged);
    }
  }

  /** What the full schema refuses in arguments the model's (narrower) schema let through. */
  #refuse(tool: ToolName, merged: unknown): ErrorResult {
    const full = this.#catalog.offered.get(tool)?.fullSchema ?? { type: 'object' };
    return invalidArguments(validate(withDefaultsRequired(full), merged)[1]);
  }

  #pageShaping(plan: PagePlan, page: SearchEnvelope): PageShaping {
    const { shaping } = plan;
    let hits = page.results;
    const caveats = [...shaping.caveats];
    if (plan.tool === SIMILAR) {
      // A company is not a look-alike of itself; only domain anchors can be matched with certainty.
      const anchors = new Set(plan.anchors.filter((a) => a.by === 'domain').map((a) => domainOf(a.value)));
      const removed = hits.filter((h) => anchors.has(domainOf(typeof h['domain'] === 'string' ? h['domain'] : h.id))).map((h) => h.id);
      if (removed.length > 0) {
        hits = hits.filter((h) => !removed.includes(h.id));
        caveats.push(text('caveats', 'anchors_removed', { ids: join(removed) }));
      }
    }
    return {
      hits,
      category: shaping.category,
      fields: shaping.fields,
      wanted: wantedValues(shaping.filters, page.resolved_search?.filters),
      withLookup: this.#catalog.included.includes(LOOKUP),
      askedInWords: shaping.askedInWords,
      caveats,
    };
  }
}

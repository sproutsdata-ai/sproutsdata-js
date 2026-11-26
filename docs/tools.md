# Tools for models

`sproutsdata/tools` gives a model three tools, `sprouts_search`,
`sprouts_similar` and `sprouts_entity_lookup`, ready to hand to OpenAI,
Anthropic, or any framework that takes a JSON Schema. It builds the tool
definitions, runs the calls a model makes, and shapes each answer into compact
JSON the model can read.

The tools have the same names, input schemas and result shape as the Sprouts
MCP server and the Python SDK's `sproutsdata.tools`, all from the shared spec.
No provider SDK is imported: the helpers build and read plain objects. A
`Toolset` calls the API through the client you give it, using its public
methods only.

## With OpenAI (Chat Completions)

```ts
import OpenAI from 'openai';
import { SproutsData } from 'sproutsdata';
import { Toolset } from 'sproutsdata/tools';

const openai = new OpenAI();
const tools = new Toolset(new SproutsData());
const model = 'gpt-5';

const messages: unknown[] = [{ role: 'user', content: 'Find VPs of Marketing at fintech companies in Germany.' }];
for (;;) {
  const response = await openai.chat.completions.create({ model, messages, tools: tools.openai() });
  const message = response.choices[0].message;
  messages.push(message);
  if (!message.tool_calls?.length) break;
  messages.push(...(await tools.handleOpenAIToolCalls(message)));
}
```

`tools.openai()` uses OpenAI's strict mode by default, so the model cannot send
arguments that do not fit the schema. A model in strict mode sends `null` for an
argument it does not use, and the toolset reads that as "not set". Pass
`{ strict: false }` for the plain schema.

## With OpenAI (Responses API)

Ask for the flat tool shape, and hand back the whole response:

```ts
import OpenAI from 'openai';
import { SproutsData } from 'sproutsdata';
import { Toolset } from 'sproutsdata/tools';

const openai = new OpenAI();
const tools = new Toolset(new SproutsData());

const input: unknown[] = [{ role: 'user', content: 'Companies like Adyen and Checkout.com in the Nordics' }];
for (;;) {
  const response = await openai.responses.create({ model: 'gpt-5', input, tools: tools.openai({ api: 'responses' }) });
  input.push(...response.output);
  const outputs = await tools.handleOpenAIToolCalls(response);
  if (outputs.length === 0) break;
  input.push(...outputs);
}
```

## With Anthropic

```ts
import Anthropic from '@anthropic-ai/sdk';
import { SproutsData } from 'sproutsdata';
import { Toolset } from 'sproutsdata/tools';

const anthropic = new Anthropic();
const tools = new Toolset(new SproutsData());

const messages: unknown[] = [{ role: 'user', content: 'Find VPs of Marketing at fintech companies in Germany.' }];
for (;;) {
  const response = await anthropic.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 2048, tools: tools.anthropic(), messages });
  messages.push({ role: 'assistant', content: response.content });
  if (response.stop_reason !== 'tool_use') break;
  messages.push({ role: 'user', content: await tools.handleAnthropicToolUse(response) });
}
```

A `tool_result` block carries `is_error: true` when the call failed, so the
model reads it as an error rather than as data.

## Every call is answered

`handleOpenAIToolCalls` and `handleAnthropicToolUse` run every call in the
message, one after another, and return one answer per call, in order. That
includes a call to a tool the set does not offer, or with arguments that are
not valid JSON: a provider refuses the next request if any call is left
unanswered.

If the model also has tools of your own, route by name and give only the
Sprouts calls to the toolset:

```ts
import { SproutsData } from 'sproutsdata';
import { Toolset, toJson } from 'sproutsdata/tools';

const tools = new Toolset(new SproutsData());
const sprouts: readonly string[] = tools.toolNames;

async function answer(call: { readonly name: string; readonly arguments: string }): Promise<string> {
  if (sprouts.includes(call.name)) return toJson(await tools.run(call.name, call.arguments));
  return JSON.stringify({ error: `no tool named ${call.name}` });
}
console.log(await answer({ name: 'sprouts_search', arguments: '{"query":"payments companies in Germany"}' }));
```

## Calling a tool directly

`run(name, args)` takes a tool name and the model's arguments (a JSON string or
an object) and resolves to the result. `toJson(result)` is the exact text a
model should see: keys sorted, no spaces, the canonical form both SDKs produce.

```ts
import { SproutsData } from 'sproutsdata';
import { Toolset, toJson } from 'sproutsdata/tools';

const tools = new Toolset(new SproutsData());
const result = await tools.run('sprouts_search', { query: 'payments companies in Germany', mode: 'auto' });
console.log(toJson(result));
```

`tools.definitions()` returns provider-neutral specs, `[{ name, description,
input_schema }]`, for frameworks that take a JSON Schema directly. The same
definitions are available without a client from the module-level
`definitions(include, { fixed })`, `openai(include, { fixed, strict, api })` and
`anthropic(include, { fixed })`.

## What a result looks like

From `spec/tools/fixtures/search_company_parser_inferred.json`, one row of three shown and its
fields shortened:

```json
{
  "caveats": [
    "vector_coverage_incomplete: 12% of company records have no embedding and were matched lexically only. (impact: recall)",
    "rows_without_lookup: 1 of 3 rows carry no domain or LinkedIn URL, so they have no `lookup` value and cannot be looked up."
  ],
  "has_more": true,
  "interpreted_as": {
    "conflicts": [],
    "filters": { "technology": { "include": ["hubspot"] }, "…": "…" },
    "source": "parser"
  },
  "next_cursor": "eyJvIjozfQ.c1a9",
  "request_id": "req_9f2c41d07a",
  "results": [
    {
      "account_name": "Brightloop",
      "category": "company",
      "domain": "brightloop.io",
      "id": "d1_WMtEHkBEb68NgK1p035wCzgfKhx5wvrlQAnqihg3",
      "lookup": { "by": "domain", "value": "brightloop.io" },
      "technology": ["HubSpot", "Google Tag Manager", "…", "… +19 more"]
    }
  ],
  "suggestion": null,
  "total": 13137,
  "total_is_estimate": false
}
```

- **Rows are trimmed.** Rows carry a compact default set of fields unless the
  model names `fields`. Text is cut at 300 characters and lists at 15 entries,
  with a final `"… +N more"`. Values the request asked for come first.
- **`lookup`** is how to fetch a row's full record with
  `sprouts_entity_lookup`: a company by its domain (or LinkedIn page), a person
  by their LinkedIn URL, a document by its `d1_...` id. A company row's `id` is a
  sealed reference and a person row's a hash: neither is a lookup key. Rows carry `lookup`
  only when the lookup tool is offered; a caveat counts the rows that have none.
- **`interpreted_as`** shows the filters the engine applied; `source:
  "parser"` means it inferred them from the words. `sparse_filters`, present
  only when there are some, names applied filters whose field few records hold.
- **`total_is_estimate: true`** makes `total` a floor: "at least N".
- **Partial rows.** A company or person search also returns rows meeting only
  part of the search, after the exact ones. Such a row keeps `unmet` (each filter
  it misses, and how), `matched_filters` and `match_score` whatever the
  projection; `total_exact` counts the exact rows (`total` counts both), and a
  `partial_rows` caveat tells the model to report them as close matches
  (`spec/tools/fixtures/search_partial_matches.json`). The model can send
  `partial_matches: false` for exact matches only.
- **`mode`** is `fast` unless the model asks for `auto`: the tool tells the model
  to put constraints in `filters`, and `fast` reads the words only for what they
  are about. A search sent to the API without a mode would run in `auto`, so the
  tool always sends one.
- **`caveats`** lists anything the server could not do, and anything the
  toolset changed (a row cap, an application filter that replaced the model's).
  An empty answer's first caveat is `no_match`, with the reason.
- **`suggestion`** is advice: another `category` (`kind: "search"`), or, on an
  empty answer, the filters to leave out (`kind: "relax"`, with `without`).
- **`request_id`** identifies the call; quote it to support.

A lookup answers every id: `found`, up to three `matches`, and `ambiguous` when
more than one record matched. Company and person lookups apply `fields`
locally. `found: true` with no matches is a record that resolved but could not
be read, and a caveat says so.

A search on a document category refuses company and person filters, as the
API does.

## Errors: returned or thrown

| Failure | What happens |
|---|---|
| Arguments that break the schema, an unknown argument, a tool rule | Returned: `{ error: { code: 'invalid_arguments', ... } }`, every problem in `field_errors` |
| An unknown tool name | Returned: `unknown_tool` |
| 404, 409, 422, 429, 5xx, timeouts, connection failures | Returned, with the server's code and message |
| 401, 403, 402 | Thrown: `AuthenticationError`, `PermissionDeniedError`, `InsufficientCreditsError` |

Every returned error has the same six keys: `code`, `message`, `retryable`,
`retry_after` (seconds), `field_errors` and `request_id`. `retryable` answers
"would the same call, unchanged, be both useful and safe?". All three tools are
charged once the server has done the work, so a call that may have reached the
server without an answer is not retryable, and the message tells the model not
to repeat it.

What is thrown is what only the application can fix: a key, a scope, or
credits. `isApplicationError(err)` tells those three apart, whichever copy of
the SDK threw them.

## Settings the model cannot change

```ts
import { SproutsData } from 'sproutsdata';
import { Toolset } from 'sproutsdata/tools';

const tools = new Toolset(new SproutsData(), {
  include: ['search', 'lookup'],
  fixed: { sprouts_search: { category: 'person' } },
  defaults: { sprouts_search: { mode: 'auto' } },
  maxResults: 10,
  baselineFilters: { geo: { places: [{ value: 'Germany', level: 'country' }] } },
});
console.log(tools.toolNames);
```

| Option | Effect |
|---|---|
| `include` | The tools to offer: full names, or `search`, `similar`, `lookup`. Default: all three. A description never mentions a tool outside the set. |
| `fixed` | Per tool, arguments the application sets. They are removed from the schema the model sees. |
| `defaults` | Per tool, arguments used when the model leaves them out. The model may still set them. |
| `maxResults` | The most rows one call returns, 1 to 25 (the default). A model asking for more gets this many, and a caveat. |
| `baselineFilters` | Filters merged into every search and look-alike, per filter key. Where both set the same key, the application's value wins, and a caveat tells the model. A `category: 'auto'` search, which takes no filters, is refused under a baseline. |

Every option is checked when the toolset is built: an unknown tool or an invalid
argument throws `ClientValidationError`, and a value that is not a client, or an
invalid `maxResults` or `baselineFilters`, throws `TypeError`.

## Connecting a toolset

`new Toolset(client, options)` takes a `SproutsData` client and uses it as it
is. A framework that builds its own client from settings uses `resolveClient`:

```ts
import { SproutsData } from 'sproutsdata';
import { resolveClient, type ConnectionOptions } from 'sproutsdata/tools';

const fromSettings: ConnectionOptions = { apiKey: process.env.SPROUTSDATA_API_KEY, timeoutMs: 30_000 };
const built = resolveClient(fromSettings); // a new client from the settings

const given = resolveClient({ client: new SproutsData() }); // the same client, as it is
console.log(JSON.stringify(built), JSON.stringify(given));
```

`ConnectionOptions` is a `client`, or the settings to build one (`apiKey`,
`baseUrl`, `timeoutMs`, `maxRetries`), never both: settings beside a client
would configure nothing, so `resolveClient` throws `ClientValidationError`. A
client made by a second copy of the package (an adapter's own dependency, say)
is recognised as a client too.

## Frameworks

[`@sproutsdata.ai/langchain`](../packages/langchain) (tools and a retriever) and
[`@sproutsdata.ai/ai-sdk`](../packages/ai-sdk) are thin layers over a
`Toolset`: the same tools, options and results, with the framework's own tool
type around them. Any other framework that takes a JSON Schema tool needs only
`definitions()` (or `openai()`) and `run()`; the
[OpenAI Agents SDK page](integrations/openai-agents.md) shows one.

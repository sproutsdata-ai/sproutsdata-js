# Tools for models

`sproutsdata/tools` gives a model three tools — `sprouts_search`,
`sprouts_similar` and `sprouts_entity_lookup` — ready to hand to OpenAI,
Anthropic, or any framework that takes a JSON Schema. It builds the tool
definitions, runs the calls a model makes, and shapes each answer into compact
JSON the model can read.

The tools are the same everywhere: the Sprouts MCP server and the Python SDK's
`sproutsdata.tools` use the same names, input schemas and result shape, all
generated from the shared spec, and the same call gives the same bytes in both
SDKs. A prompt written for one works with the others. No provider SDK is
imported: the helpers build and read plain objects.

## With OpenAI (Chat Completions)

```ts
import OpenAI from 'openai';
import { SproutsData } from 'sproutsdata';
import { Toolset } from 'sproutsdata/tools';

const gpt = new OpenAI();
const tools = new Toolset(new SproutsData());

const messages: OpenAI.ChatCompletionMessageParam[] = [
  { role: 'user', content: 'Find VPs of Marketing at fintech companies in Germany.' },
];
for (;;) {
  const response = await gpt.chat.completions.create({ model, messages, tools: tools.openai() });
  const message = response.choices[0]!.message;
  messages.push(message);
  if (!message.tool_calls?.length) break;
  messages.push(...(await tools.handleOpenAIToolCalls(message)));
}
```

`tools.openai()` uses OpenAI's strict mode by default, so the model cannot
produce arguments that do not fit the schema; a model in strict mode sends
`null` for an argument it does not use, which the toolset reads as "not set".
Pass `{ strict: false }` to send the plain schema instead.

## With OpenAI (Responses API)

Ask for the flat tool shape, and hand back the whole response:

```ts
const input: OpenAI.Responses.ResponseInput = [
  { role: 'user', content: 'Companies like Adyen and Checkout.com in the Nordics' },
];
for (;;) {
  const response = await gpt.responses.create({ model, input, tools: tools.openai({ api: 'responses' }) });
  input.push(...response.output);
  const outputs = await tools.handleOpenAIToolCalls(response);
  if (outputs.length === 0) break;
  input.push(...outputs);
}
```

## With Anthropic

```ts
import Anthropic from '@anthropic-ai/sdk';

const claude = new Anthropic();
const messages: Anthropic.MessageParam[] = [
  { role: 'user', content: 'Find VPs of Marketing at fintech companies in Germany.' },
];
for (;;) {
  const response = await claude.messages.create({
    model,
    max_tokens: 2048,
    tools: tools.anthropic(),
    messages,
  });
  messages.push({ role: 'assistant', content: response.content });
  if (response.stop_reason !== 'tool_use') break;
  messages.push({ role: 'user', content: await tools.handleAnthropicToolUse(response) });
}
```

Each `tool_result` block carries `is_error: true` when the call failed, so the
model reads the error rather than treating it as data.

## Every call is answered

`handleOpenAIToolCalls` and `handleAnthropicToolUse` run every call in the
message, one after another, and return one answer per call, in order —
including a call to a tool the set does not have, or with arguments that are
not valid JSON. A provider rejects the next request if any call is left
unanswered, so nothing is skipped.

If the model also has tools of your own, route by name and give only the
Sprouts calls to the toolset:

```ts
const sprouts: readonly string[] = tools.toolNames;
for (const call of message.tool_calls ?? []) {
  if (sprouts.includes(call.function.name)) {
    const result = await tools.run(call.function.name, call.function.arguments);
  }
}
```

## Calling a tool directly

`run(name, args)` takes a tool name and the model's arguments (a JSON string or
an object) and resolves to the result. `toJson(result)` is the exact text a
model should see: keys sorted, no spaces, numbers as JavaScript writes them —
the canonical form both SDKs produce.

```ts
import { toJson } from 'sproutsdata/tools';

const result = await tools.run('sprouts_search', { query: 'payments companies in Germany', mode: 'auto' });
const text = toJson(result);
```

`tools.definitions()` returns provider-neutral specs, `[{ name, description,
input_schema }]`, for frameworks that take a JSON Schema directly. The same
definitions are available without a client from the module-level
`definitions()`, `openai()` and `anthropic()`, which take `include` and
`fixed`.

## What a result looks like

```json
{
  "caveats": ["vector_coverage_incomplete: 12% of company records have no embedding … (impact: recall)"],
  "environment": "test",
  "has_more": true,
  "interpreted_as": {
    "conflicts": [],
    "filters": { "technology": { "include": ["hubspot"] } },
    "source": "parser"
  },
  "next_cursor": "eyJvIjozfQ.c1a9",
  "request_id": "req_9f2c41d07a",
  "results": [
    {
      "account_name": "Brightloop",
      "category": "company",
      "domain": "brightloop.io",
      "id": "brightloop.io",
      "lookup": { "by": "domain", "value": "brightloop.io" },
      "technology": ["HubSpot", "Google Tag Manager", "…", "… +19 more"]
    }
  ],
  "suggestion": null,
  "total": 13137,
  "total_is_estimate": false
}
```

- **Rows are trimmed.** Company and person rows carry a compact default set of
  fields unless the model names `fields`. Text is cut at 300 characters and
  lists at 15 entries, with a final `"… +N more"`. Values the request asked for
  come first, so a "companies using HubSpot" search shows HubSpot in every row.
- **`lookup`** is how to fetch a row's full record: a company by its domain, a
  person by their LinkedIn URL. A search row's `id` is not a record id, and the
  tool descriptions say so. Rows carry `lookup` only when the lookup tool is
  offered.
- **`interpreted_as`** shows the filters the engine actually applied; `source:
  "parser"` means it inferred them from the words.
- **`total_is_estimate: true`** makes `total` a floor: "at least N".
- **`caveats`** lists anything the server could not do, and anything the
  toolset changed — a row cap, an application filter that replaced the model's.
- **`environment: "test"`** means a test key: real records, zero credits.

A lookup answers every id, in order: `found`, up to three `matches`, and
`ambiguous` when more than one record matched. `found: true` with no matches is
a record that resolved but did not come back, not a miss.

## Errors: returned or thrown

| Failure | What happens |
|---|---|
| Arguments that break the schema, an unknown argument, a tool rule | Returned: `{ error: { code: 'invalid_arguments', … } }`, every problem listed in `field_errors` |
| An unknown tool name | Returned: `unknown_tool` |
| 404, 409, 422, 429, 5xx, timeouts, connection failures | Returned, with the server's code and message |
| 401, 403, 402 | **Thrown**: `AuthenticationError`, `PermissionDeniedError`, `InsufficientCreditsError` |

Every returned error has the same six keys: `code`, `message`, `retryable`,
`retry_after` (seconds), `field_errors` and `request_id`. `retryable` answers
"would the same call, unchanged, be both useful and safe?". All three tools are
charged once the server has done the work, so a call that timed out or lost its
connection after it was sent, or got a gateway's 502, is **not** retryable — it
may already have been charged — and the message tells the model not to repeat
it.

A tool rule is refused in a sentence the model can act on, before anything is
sent. A search needs `query` or `filters`, and a `filters` that is empty once
`null` members are removed, or a `query` that is only whitespace, counts as
absent — so a strict-mode call that nulls out every filter is refused the same
way as one that sent nothing.

What is thrown is what only you can fix: a key, a scope, or credits. A model
told "insufficient credits" as data tends to retry or improvise; an exception
stops the run where you can handle it.

## Settings the model cannot change

```ts
const tools = new Toolset(new SproutsData(), {
  include: ['search', 'lookup'],
  fixed: { sprouts_search: { category: 'person' } },
  defaults: { sprouts_search: { mode: 'auto' } },
  maxResults: 10,
  baselineFilters: { geo: { places: [{ value: 'germany', level: 'country' }] } },
});
```

| Option | Effect |
|---|---|
| `include` | The tools to offer: full names, or `'search'`, `'similar'`, `'lookup'`. Default: all three. A description never mentions a tool outside the set. |
| `fixed` | Per tool, arguments you set. They are removed from the schema the model sees, so it cannot try to change them. |
| `defaults` | Per tool, arguments used when the model leaves them out. The model may still set them. |
| `maxResults` | The most rows one call returns, from 1 to 25 (the default). A model asking for more gets this many, and a `limit_capped` caveat. |
| `baselineFilters` | Filters merged into every search and look-alike call. The merge is per key: a baseline `industry.include` keeps the model's `industry.exclude`. Where both set the same key yours wins, and an `application_filter` caveat tells the model its value was replaced. A `category: 'auto'` search, which takes no filters, is refused under a baseline. |
| `integration` | `<name>/<version>` for the `X-SproutsData-Client` header. Default: the client's own, else `js-tools/<sdk version>`. |

Every option is checked when the toolset is built, and an invalid one throws
`ClientValidationError` before anything is sent.

## Frameworks

[`@sproutsdata.ai/langchain`](../packages/langchain) (tools and a retriever) and
[`@sproutsdata.ai/ai-sdk`](../packages/ai-sdk) are thin layers over a `Toolset`: the
same tools, options and results, with the framework's own tool type around
them. Any other framework that takes a JSON Schema tool needs only
`definitions()` (or `openai()`) and `run()`; the
[OpenAI Agents SDK recipe](integrations/openai-agents.md) is one.

A toolset accepts a client from a second copy of the SDK — another installed
version, or the CommonJS build beside the ES module one — and recognises its
errors by `name` and `status`, so what is returned and what is thrown does not
depend on which copy made the client.

## Attribution

Calls from a toolset carry `X-SproutsData-Client: js-tools/<version>`, so usage
from tool layers can be told apart from direct API use. The toolset sends them
through a copy of your client (`client.withOptions({ integration })`); the
client you passed in is not changed. A framework built on the SDK names itself
with `integration`, on the toolset or on the client:

```ts
const client = new SproutsData({ integration: 'my-agent/1.2.0' });
```

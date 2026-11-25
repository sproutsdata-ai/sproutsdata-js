# @sproutsdata.ai/langchain

The Sprouts tools (search, look-alike search and entity lookup) as
[LangChain](https://js.langchain.com) tools, and Sprouts search as a retriever.
A thin layer over the [`sproutsdata`](https://github.com/sproutsdata-ai/sproutsdata-js/tree/main/packages/sdk) SDK.

The tools are `sproutsdata/tools`: the same names (`sprouts_search`,
`sprouts_similar`, `sprouts_entity_lookup`), input schemas and result shape as
the Sprouts MCP server, the OpenAI and Anthropic helpers in the SDK, the
Python `langchain-sproutsdata` package and the AI SDK adapter. This package
adds only what LangChain needs to call them.

## Install

```bash
npm install @sproutsdata.ai/langchain sproutsdata @langchain/core
```

`sproutsdata` and `@langchain/core` are peer dependencies, so your application
and this package share one copy of each.

## Quickstart

```ts
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { sproutsDataTools } from '@sproutsdata.ai/langchain';

declare const chatModel: BaseChatModel; // any chat model that supports tool calling

// Reads SPROUTSDATA_API_KEY (and SPROUTSDATA_BASE_URL, if set).
const tools = sproutsDataTools();
const byName = new Map(tools.map((tool) => [tool.name, tool]));
const model = chatModel.bindTools?.(tools);
if (model === undefined) throw new Error('This chat model does not support tool calling.');

const messages: BaseMessage[] = [new HumanMessage('Find VPs of Marketing at fintech companies in Germany.')];
for (;;) {
  const reply = await model.invoke(messages);
  messages.push(reply);
  if (!reply.tool_calls?.length) break;
  for (const call of reply.tool_calls) {
    const tool = byName.get(call.name);
    if (tool !== undefined) messages.push(await tool.invoke(call));
  }
}
```

`sproutsDataTools()` returns the three tools as `StructuredTool`s, sharing one
client and one toolset; agent frameworks built on LangChain take the array as it
is.

## Connecting

Pass your own `client` (a `SproutsData`), or the settings to build one:
`apiKey`, `baseUrl`, `timeoutMs`, `maxRetries` (the `SproutsDataConnection`
type). A client you pass is used as it is. Settings beside a client would
configure nothing, so they are refused with a `ClientValidationError`.

```ts
import { SproutsData } from 'sproutsdata';
import { SproutsDataRetriever, sproutsDataTools } from '@sproutsdata.ai/langchain';

const client = new SproutsData({ timeoutMs: 30_000 });
const tools = sproutsDataTools({ client });
const retriever = new SproutsDataRetriever({ client, k: 5 });

const fromSettings = sproutsDataTools({ apiKey: process.env.SPROUTSDATA_API_KEY, maxRetries: 3 });
console.log(tools.length, fromSettings.length, retriever.k);
```

Every option is checked when the tools or the retriever are built: a missing
key, a refused base URL, settings beside a client or an invalid option throw
`ClientValidationError` there, not in the middle of an agent run.

## Settings the model cannot change

```ts
import { sproutsDataTools } from '@sproutsdata.ai/langchain';

const tools = sproutsDataTools({
  include: ['search', 'lookup'],
  fixed: { sprouts_search: { category: 'person' } },
  defaults: { sprouts_search: { mode: 'auto' } },
  maxResults: 10,
  baselineFilters: { geo: { places: [{ value: 'Germany', level: 'country' }] } },
});
console.log(tools.map((tool) => tool.name));
```

| Option | Effect |
| --- | --- |
| `include` | The tools to offer: full names, or `search`, `similar`, `lookup`. Default: all three. A description never mentions a tool outside the set. |
| `fixed` | Per tool, arguments the application sets. They are removed from the schema the model sees. |
| `defaults` | Per tool, arguments used when the model leaves them out. |
| `maxResults` | The most rows one call returns, 1 to 25 (the default). A call that names no `limit` gets 10. A model asking for more than the cap gets this many, and a caveat says so. |
| `baselineFilters` | Filters merged into every search and look-alike call, per filter key. Where the model set the same key, the application's value wins, and a caveat tells the model. |

The full description of each tool, its arguments and its result is in the
SDK's [Tools for models](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/tools.md).

## What a tool returns

A JSON string, compact and with sorted keys; or, when invoked with a model's
`ToolCall`, a `ToolMessage` carrying it.

- `results`: rows trimmed to a compact set of fields, lists cut at 15 entries
  with a final `"… +N more"`, values the request asked for first. A row a
  lookup can take carries `lookup` (a company by domain or LinkedIn page, a
  person by LinkedIn URL, a document by its id), when the lookup tool is
  offered.
- `total` and `total_is_estimate`: when `total_is_estimate` is true, `total` is
  a floor, "at least N". The same holds in the retriever's metadata.
- `interpreted_as`: the filters the engine applied, and whether it inferred
  them from the words.
- `caveats`: anything the server could not do, and anything your settings
  changed.
- `request_id`.
- A lookup answers every id, with up to three `matches` and `ambiguous: true`
  when more than one record matched.

## Errors

| Failure | What happens |
| --- | --- |
| Arguments that break the schema, an unknown argument, a tool rule | Returned to the model: `{"error": {"code": "invalid_arguments", ...}}` with every problem listed |
| 404, 409, 422, 429, 5xx, timeouts | Returned to the model, with the server's code and message |
| 401, 403, 402 | Thrown: `AuthenticationError`, `PermissionDeniedError`, `InsufficientCreditsError` |
| No key, a refused base URL, settings beside a client, an invalid option | Thrown by `sproutsDataTools()` or the retriever's constructor |

LangChain checks a JSON Schema tool's input itself and throws on a mismatch,
which would end the run. These tools hand a refused input to the toolset
instead, which answers with every problem named, or, for a representation the
MCP server also accepts (`"25"` for 25), runs the call. So a bad argument does
not end an agent run: the model reads what was wrong and corrects it. Errors
are recognised by class name, so this holds even when your application and
this package load different copies of `sproutsdata`.

## Building one tool

`SproutsDataSearchResults`, `SproutsDataFindSimilar` and
`SproutsDataEntityLookup` each wrap a core toolset. Build the toolset with
`include` naming exactly the tools you give the model; a toolset that does not
offer the tool throws a `TypeError`.

```ts
import { SproutsData } from 'sproutsdata';
import { Toolset } from 'sproutsdata/tools';
import { SproutsDataSearchResults } from '@sproutsdata.ai/langchain';

const search = new SproutsDataSearchResults({
  toolset: new Toolset(new SproutsData(), { include: ['search'] }),
});
console.log(search.name);
```

## The retriever

```ts
import { SproutsDataRetriever } from '@sproutsdata.ai/langchain';

const retriever = new SproutsDataRetriever({ k: 10 });
const docs = await retriever.invoke('industrial IoT platforms in the DACH region');
for (const doc of docs) console.log(doc.pageContent, doc.metadata['request_id']);
```

Each `Document` renders a short line per category as `pageContent` (lossy by
design) and carries the complete raw row under `metadata.record`. Request-level
fields (`request_id`, `as_of`, `credential`, `credits_charged`,
`total`, `total_is_estimate`, `degradation`, `attribution` and
`resolved_search`) are copied onto every document, typed as
`SproutsDataDocumentMetadata`, because a step deep in a chain sees one
document, not the response. `contentFields: ['domain', 'industry']` renders
those fields as `field: value` lines instead.

Fields: `k` (the request's `limit`, default 10), `category` (default
`'company'`, or `'auto'` to let the question pick it), `mode`, `filters`,
`includeDomains` / `excludeDomains`, `contentFields`, `includeResolvedSearch`
(default true), and the connection settings above.

**The mode.** With a category, the retriever sends `mode: 'fast'` unless you
set another, so a change in the server's default can never change what a
deployed retriever bills. A retriever in an agent loop can fire several times
per turn, and `auto` runs a model on every first page. With
`category: 'auto'`, no mode is sent: the server reads the question in `auto`,
its only mode there.

When a search returns nothing and the platform had inferred filters from the
query, the retriever logs one `console.warn` naming them and the `request_id`.

The retriever throws the SDK's errors, unchanged: a retriever has no
error-as-data channel. Retry policy belongs to the caller
(`retriever.withRetry()`); the SDK transport already retries what is safe to
retry.

The key is never a field: it goes to the client, which keeps it private, so
`JSON.stringify` and `util.inspect` of the retriever or a tool never show it.

## Compatibility

Generated from `package.json`; `tests/readme.test.ts` fails when they differ.

<!-- compat:start -->
| Requirement | Versions |
| --- | --- |
| Node.js | >=22.12.0 |
| `@langchain/core` | ^1.0.0 |
| `sproutsdata` | >=0.1.0 <0.2.0 |
<!-- compat:end -->

## Cost

Every tool call and every retrieval is billed (each answer's
`meta.credits_charged` says what it cost), and an agent loop can fire several
per user turn. Every key is a live key, so each of those calls is charged to the
workspace's credits.

## See also

- [`sproutsdata`](https://github.com/sproutsdata-ai/sproutsdata-js/tree/main/packages/sdk): the SDK, with pagination, typed filters,
  relationships, agent runs and usage.
- [`@sproutsdata.ai/ai-sdk`](https://github.com/sproutsdata-ai/sproutsdata-js/tree/main/packages/ai-sdk): the same tools for the Vercel AI SDK.
- [Integrations](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/integrations/README.md): the same tools in
  frameworks without a package of their own.

## License

The SDK code is released under the [MIT License](LICENSE).

The licence covers this code only. Use of the Sprouts Data API, and of the data
it returns, is governed by the Sprouts
[Terms and Conditions](https://sprouts.ai/terms-and-conditions) and
[Privacy Policy](https://sprouts.ai/privacy-policy), or by your agreement with
Sprouts Inc. if you have one.

# @sproutsdata.ai/langchain

The Sprouts tools — search, look-alike search and entity lookup — as
[LangChain](https://js.langchain.com) tools, and Sprouts search as a retriever.
A thin layer over the [`sproutsdata`](../sdk) SDK.

The tools are `sproutsdata/tools`: the same names (`sprouts_search`,
`sprouts_similar`, `sprouts_entity_lookup`), input schemas and result shape as
the Sprouts MCP server, the OpenAI and Anthropic helpers in the SDK, the
Python `langchain-sproutsdata` package and the AI SDK adapter. A prompt or
skill written against one works with the others. This package adds only what
LangChain needs to call them.

## Install

```bash
npm install @sproutsdata.ai/langchain sproutsdata @langchain/core
```

`sproutsdata` and `@langchain/core` are peer dependencies, so your application
and this package share one copy of each.

## Quickstart

```ts
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { sproutsDataTools } from '@sproutsdata.ai/langchain';

// Reads SPROUTSDATA_API_KEY (and SPROUTSDATA_BASE_URL, if set).
const tools = sproutsDataTools();
const byName = new Map(tools.map((tool) => [tool.name, tool]));
const model = new ChatAnthropic({ model: 'claude-sonnet-4-5' }).bindTools(tools);

const messages: BaseMessage[] = [new HumanMessage('Find VPs of Marketing at fintech companies in Germany.')];
for (;;) {
  const reply = await model.invoke(messages);
  messages.push(reply);
  if (!reply.tool_calls?.length) break;
  for (const call of reply.tool_calls) messages.push(await byName.get(call.name)!.invoke(call));
}
```

`sproutsDataTools()` returns all three tools as `StructuredTool`s, sharing one
client; agent frameworks built on LangChain take the array as it is. Calls
carry `X-SproutsData-Client: langchain/<version>`. Develop with a test key
(`sk_dsp_test_<your-key>`): test keys are metered but charged zero credits.

## Settings the model cannot change

```ts
const tools = sproutsDataTools({
  include: ['search', 'lookup'],
  fixed: { sprouts_search: { category: 'person' } },
  defaults: { sprouts_search: { mode: 'auto' } },
  maxResults: 10,
  baselineFilters: { geo: { places: [{ value: 'germany', level: 'country' }] } },
});
```

| Option | Effect |
| --- | --- |
| `include` | The tools to offer: full names, or `'search'`, `'similar'`, `'lookup'`. Default: all three. A description never mentions a tool outside the set. |
| `fixed` | Per tool, arguments you set. They are removed from the schema the model sees. |
| `defaults` | Per tool, arguments used when the model leaves them out. |
| `maxResults` | The most rows one call returns, **from 1 to 25** (the default): a cap on what the model may ask for. A call that names no `limit` gets 10. A model asking for more than the cap gets this many, and a `limit_capped` caveat says so. |
| `baselineFilters` | Filters merged into every search and look-alike call, per key. Where the model set the same key yours wins, and an `application_filter` caveat tells it. |

Connection settings: `apiKey`, `baseUrl`, `timeoutMs`, `maxRetries`, or your
own `client` (`SproutsData`). Your client is used through a copy that names
this package; it is not changed. Every option is checked when the tools are
built: a missing key or an invalid option throws `ClientValidationError`
there, not in the middle of an agent run.

The full description of each tool, its arguments and its result is in the
SDK's [Tools for models](../../docs/tools.md).

## What a tool returns

A JSON string, compact and with sorted keys — or, when invoked with a model's
`ToolCall`, a `ToolMessage` carrying it.

- `results` — rows trimmed to a compact set of fields, lists cut at 15 entries
  with a final `"… +N more"`, values the request asked for first. Company and
  person rows carry a `lookup` hint (by domain or LinkedIn URL) for fetching
  the full record.
- `total` and `total_is_estimate` — when `total_is_estimate` is true, `total`
  is a floor: "at least N". The same meaning applies everywhere in this
  package, the retriever's metadata included.
- `interpreted_as` — the filters the engine actually applied, and whether it
  inferred them from the words.
- `caveats` — anything the server could not do, and anything your settings
  changed.
- A lookup answers every id, in order, with up to three `matches` and
  `ambiguous: true` when more than one record matched.

## Errors

| Failure | What happens |
| --- | --- |
| Arguments that break the schema, an unknown argument, a tool rule | Returned to the model: `{"error": {"code": "invalid_arguments", …}}` with every problem listed |
| 404, 409, 422, 429, 5xx, timeouts | Returned to the model, with the server's code and message |
| 401, 403, 402 | **Thrown**: `AuthenticationError`, `PermissionDeniedError`, `InsufficientCreditsError` |
| No key, a refused base URL, an invalid option | **Thrown** by `sproutsDataTools()` or the retriever's constructor |

LangChain checks a JSON Schema tool's input itself and throws on a mismatch,
which would end the run. These tools hand a refused input to the SDK instead,
which answers with every problem named — or, for a representation the MCP
server also accepts (`"25"` for 25), runs the call. So a bad argument never
ends an agent run: the model reads what was wrong and corrects it. Errors are
matched by name, so this holds even when your application and this package
load different copies of `sproutsdata`.

## Building one tool

`SproutsDataSearchResults`, `SproutsDataFindSimilar` and
`SproutsDataEntityLookup` each wrap a core toolset. Build the toolset with
`include` naming exactly the tools you give the model:

```ts
import { SproutsData } from 'sproutsdata';
import { Toolset } from 'sproutsdata/tools';
import { SproutsDataSearchResults } from '@sproutsdata.ai/langchain';

const search = new SproutsDataSearchResults({
  toolset: new Toolset(new SproutsData(), { include: ['search'] }),
});
```

A toolset you build sends its own `X-SproutsData-Client` value unless you pass
`integration`.

## The retriever

```ts
import { SproutsDataRetriever } from '@sproutsdata.ai/langchain';

const retriever = new SproutsDataRetriever({ k: 10, mode: 'fast' });
const docs = await retriever.invoke('industrial IoT platforms in the DACH region');
```

Each `Document` renders a short per-category line as `pageContent` (lossy by
design) and carries the complete raw row under `metadata.record`.
Request-level fields — `request_id`, `environment`, `as_of`, `credential`,
`total`, `total_is_estimate`, `degradation`, `attribution` and
`resolved_search` — are copied onto every document (typed as
`SproutsDataDocumentMetadata`), because a step five frames into a chain sees
one document, not the response. `contentFields: ['domain', 'industry']`
renders those fields as `field: value` lines instead.

Fields: `k` (the request's `limit`, default 10), `category` (default
`'company'`), `mode` (default `'fast'`), `filters`, `includeDomains` /
`excludeDomains`, `contentFields`, `includeResolvedSearch` (default true),
and the connection settings above. Every field is sent as given, and the
server's 422 names any it refuses. `fast` is the default because a retriever
in an agent loop can fire several times per turn, and `auto` runs a model on
every first page.

When a search returns nothing and the platform had inferred filters from the
query, the retriever logs one `console.warn` naming them and the `request_id`.

The retriever **throws** the SDK's errors, unchanged: a retriever has no
error-as-data channel. Retry policy belongs to the caller
(`retriever.withRetry()`); the SDK transport already retries what is safe to
retry.

The key is never a field: it goes to the client, which keeps it private, so
`JSON.stringify`, `toJSON()` and `util.inspect` of the retriever or a tool
never show it.

## Compatibility

Generated from `package.json`; `tests/readme.test.ts` fails when they differ.

<!-- compat:start -->
| Requirement | Versions |
| --- | --- |
| Node.js | >=20.0.0 |
| `@langchain/core` | ^1.0.0 |
| `sproutsdata` | ^0.4.0 |
<!-- compat:end -->

## Cost

Every tool call and every retrieval is billed (each result's
`meta.credits_charged` says what it cost), and an agent loop can
fire several per user turn. Use a `sk_dsp_test_` key while developing: the
response says `environment: "test"`, and nothing is charged.

## See also

- [`sproutsdata`](../sdk) — the SDK: pagination, typed filters, relationships,
  agent runs, usage.
- [`@sproutsdata.ai/ai-sdk`](../ai-sdk) — the same tools for the Vercel AI SDK.
- [Integrations](../../docs/integrations/README.md) — the same tools in frameworks without a
  package of their own, and the MCP route.

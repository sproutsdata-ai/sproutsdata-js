# @sproutsdata.ai/ai-sdk

The Sprouts tools — search, look-alike search and entity lookup — for the
[Vercel AI SDK](https://ai-sdk.dev). A thin layer over the
[`sproutsdata`](../sdk) SDK.

The tools are `sproutsdata/tools`: the same names (`sprouts_search`,
`sprouts_similar`, `sprouts_entity_lookup`), input schemas and result shape as
the Sprouts MCP server, the OpenAI and Anthropic helpers in the SDK, and the
LangChain adapters. A prompt or skill written against one works with the
others. This package adds only what the AI SDK needs to call them.

## Install

```bash
npm install @sproutsdata.ai/ai-sdk sproutsdata ai
```

`sproutsdata` and `ai` are peer dependencies, so your application and this
package share one copy of each.

## Quickstart

```ts
import { generateText, stepCountIs } from 'ai';
import { raiseSproutsDataErrors, sproutsDataTools } from '@sproutsdata.ai/ai-sdk';

const { text } = await generateText({
  model: 'anthropic/claude-sonnet-4-5',
  tools: sproutsDataTools(), // reads SPROUTSDATA_API_KEY (and SPROUTSDATA_BASE_URL, if set)
  stopWhen: [stepCountIs(5), raiseSproutsDataErrors],
  prompt: 'Find VPs of Marketing at fintech companies in Germany.',
});
```

`sproutsDataTools()` returns `{ sprouts_search, sprouts_similar,
sprouts_entity_lookup }`, keyed by the names the model sees, sharing one client.
Calls carry `X-SproutsData-Client: ai-sdk/<version>`. Develop with a test key
(`sk_dsp_test_<your-key>`): test keys are metered but charged zero credits.

The client is built when the tools are, so a missing key throws there rather
than in the middle of a run. In a framework that imports route modules at build
time (Next.js), call `sproutsDataTools()` inside the request handler.

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
there.

Search mode is `fast` or `auto`, as on the MCP server. Deep search is not a
tool argument and cannot be set here.

The full description of each tool, its arguments and its result is in the
SDK's [Tools for models](../../docs/tools.md).

## What a tool returns

The toolset's result object; the model receives it as JSON.

- `results` — rows trimmed to a compact set of fields, lists cut at 15 entries
  with a final `"… +N more"`, values the request asked for first. Company and
  person rows carry a `lookup` hint (by domain or LinkedIn URL) for fetching
  the full record.
- `total` and `total_is_estimate` — when `total_is_estimate` is true, `total`
  is a floor: "at least N".
- `interpreted_as` — the filters the engine actually applied, and whether it
  inferred them from the words.
- `caveats` — anything the server could not do, and anything your settings
  changed.
- A lookup answers every id, in order, with up to three `matches` and
  `ambiguous: true` when more than one record matched.

## Errors

| Failure | What happens |
| --- | --- |
| Arguments that break the schema, an unknown argument, a tool rule | Returned to the model: `{ error: { code: 'invalid_arguments', … } }` with every problem listed |
| 404, 409, 422, 429, 5xx, timeouts | Returned to the model, with the server's code and message |
| 401, 403, 402 | **Thrown**: `AuthenticationError`, `PermissionDeniedError`, `InsufficientCreditsError` |
| No key, a refused base URL, an invalid option | **Thrown** by `sproutsDataTools()` |

The AI SDK does no validation of its own here: each tool's input schema is the
spec's JSON Schema, and the SDK validates the arguments. So a bad argument
never ends a run — the model reads what was wrong and corrects it.

The AI SDK catches whatever a tool throws and hands it to the model as a
`tool-error`. Add `raiseSproutsDataErrors` to `stopWhen` and a 401, 403 or 402
rejects `generateText` (or the `streamText` result) with the SDK's error
instead, before the model is called again. Without it, the error is in
`result.steps[n].content` as a `tool-error` part. Errors are matched by name,
so this holds even when your application and this package load different
copies of `sproutsdata`.

## Compatibility

Generated from `package.json`; `tests/readme.test.ts` fails when they differ.

<!-- compat:start -->
| Requirement | Versions |
| --- | --- |
| Node.js | >=22.12.0 |
| `ai` | ^7.0.0 |
| `sproutsdata` | ^0.4.0 |
<!-- compat:end -->

## Cost

Every tool call is billed, and an agent loop can make several per user turn. A
search costs 0.5 credits (`fast`) or 0.595 (`auto`) for its first 10 results,
then 0.08 or 0.085 per extra result; a look-alike 2 credits for the first 10 and
1 per next 10; a lookup 1 credit per record found. Each result's
`meta.credits_charged` says what that call cost. Bound the loop (`stopWhen: stepCountIs(n)`), and prefer `fixed` and
`maxResults` over trusting the prompt. Use a `sk_dsp_test_` key while
developing: the result says `environment: "test"`, and nothing is charged.

## See also

- [`sproutsdata`](../sdk) — the SDK: pagination, typed filters, relationships,
  agent runs, usage.
- [Integrations](../../docs/integrations/README.md) — the same tools in frameworks without a
  package of their own, and the MCP route.

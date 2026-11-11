# @sproutsdata.ai/ai-sdk

The Sprouts tools (search, look-alike search and entity lookup) for the
[Vercel AI SDK](https://ai-sdk.dev). A thin layer over the
[`sproutsdata`](https://github.com/sproutsdata-ai/sproutsdata-js/tree/main/packages/sdk) SDK.

The tools are `sproutsdata/tools`: the same names (`sprouts_search`,
`sprouts_similar`, `sprouts_entity_lookup`), input schemas and result shape as
the Sprouts MCP server, the OpenAI and Anthropic helpers in the SDK, and the
LangChain adapter. This package adds only what the AI SDK needs to call them.

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
  model: 'anthropic/claude-sonnet-5-5',
  tools: sproutsDataTools(), // reads SPROUTSDATA_API_KEY (and SPROUTSDATA_BASE_URL, if set)
  stopWhen: [stepCountIs(5), raiseSproutsDataErrors],
  prompt: 'Find VPs of Marketing at fintech companies in Germany.',
});
console.log(text);
```

`sproutsDataTools()` returns `{ sprouts_search, sprouts_similar,
sprouts_entity_lookup }`, keyed by the names the model sees, sharing one client
and one toolset.

The client is resolved when the tools are made, so a missing key throws there
rather than in the middle of a run. In a framework that imports route modules
at build time (Next.js, for example), call `sproutsDataTools()` inside the
request handler, where the environment is set.

## Connecting

Pass your own `client` (a `SproutsData`), or the settings to build one:
`apiKey`, `baseUrl`, `timeoutMs`, `maxRetries`. A client you pass is used as it
is. Settings beside a client would configure nothing, so they are refused with
a `ClientValidationError`.

```ts
import { SproutsData } from 'sproutsdata';
import { sproutsDataTools } from '@sproutsdata.ai/ai-sdk';

const withClient = sproutsDataTools({ client: new SproutsData({ timeoutMs: 30_000 }) });
const withSettings = sproutsDataTools({ apiKey: process.env.SPROUTSDATA_API_KEY, maxRetries: 3 });
console.log(Object.keys(withClient), Object.keys(withSettings));
```

## Settings the model cannot change

```ts
import { sproutsDataTools } from '@sproutsdata.ai/ai-sdk';

const tools = sproutsDataTools({
  include: ['search', 'lookup'],
  fixed: { sprouts_search: { category: 'person' } },
  defaults: { sprouts_search: { mode: 'auto' } },
  maxResults: 10,
  baselineFilters: { geo: { places: [{ value: 'Germany', level: 'country' }] } },
});
console.log(Object.keys(tools));
```

| Option | Effect |
| --- | --- |
| `include` | The tools to offer: full names, or `search`, `similar`, `lookup`. Default: all three. A description never mentions a tool outside the set. |
| `fixed` | Per tool, arguments the application sets. They are removed from the schema the model sees. |
| `defaults` | Per tool, arguments used when the model leaves them out. |
| `maxResults` | The most rows one call returns, 1 to 25 (the default). A call that names no `limit` gets 10. A model asking for more than the cap gets this many, and a caveat says so. |
| `baselineFilters` | Filters merged into every search and look-alike call, per filter key. Where the model set the same key, the application's value wins, and a caveat tells the model. |

Every option is checked when the tools are made: a missing key, a refused base
URL, settings beside a client or an invalid option throw there.

The search tool's mode is `fast` or `auto`, as on the MCP server; `deep` is not
a tool argument.

The full description of each tool, its arguments and its result is in the
SDK's [Tools for models](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/tools.md).

## What a tool returns

The toolset's result object; the model receives it as JSON.

- `results`: rows trimmed to a compact set of fields, lists cut at 15 entries
  with a final `"… +N more"`, values the request asked for first. A row a
  lookup can take carries `lookup` (a company by domain or LinkedIn page, a
  person by LinkedIn URL, a document by its id), when the lookup tool is
  offered.
- `total` and `total_is_estimate`: when `total_is_estimate` is true, `total` is
  a floor, "at least N".
- `interpreted_as`: the filters the engine applied, and whether it inferred
  them from the words.
- `caveats`: anything the server could not do, and anything your settings
  changed.
- `request_id` and `environment`.
- A lookup answers every id, with up to three `matches` and `ambiguous: true`
  when more than one record matched.

## Errors

| Failure | What happens |
| --- | --- |
| Arguments that break the schema, an unknown argument, a tool rule | Returned to the model: `{ error: { code: 'invalid_arguments', ... } }` with every problem listed |
| 404, 409, 422, 429, 5xx, timeouts | Returned to the model, with the server's code and message |
| 401, 403, 402 | Thrown: `AuthenticationError`, `PermissionDeniedError`, `InsufficientCreditsError` |
| No key, a refused base URL, settings beside a client, an invalid option | Thrown by `sproutsDataTools()` |

The AI SDK does no validation of its own here: each tool's input schema is the
spec's JSON Schema, and the toolset checks the arguments. So a bad argument
does not end a run: the model reads what was wrong and corrects it.

The AI SDK catches whatever a tool throws and hands it to the model as a
`tool-error`. Add `raiseSproutsDataErrors` to `stopWhen`, and a 401, 403 or 402
rejects `generateText` (or the `streamText` result) with the SDK's error
instead, before the model is called again. Without it, the error is in the
step's content as a `tool-error` part. The errors are recognised by class name
(`isApplicationError` from `sproutsdata/tools`), so this holds even when your
application and this package load different copies of `sproutsdata`.

## Compatibility

Generated from `package.json`; `tests/readme.test.ts` fails when they differ.

<!-- compat:start -->
| Requirement | Versions |
| --- | --- |
| Node.js | >=22.12.0 |
| `ai` | ^7.0.0 |
| `sproutsdata` | >=0.0.1 <0.1.0 |
<!-- compat:end -->

## Cost

Every tool call is billed, and an agent loop can make several per user turn.
Each result's `meta.credits_charged` says what that call cost. Bound the loop
(`stopWhen: stepCountIs(n)`), and prefer `fixed` and `maxResults` over trusting
the prompt. A call made with a test key (`sk_dsp_test_...`) is free and writes
no row to the credit ledger; the result says `environment: "test"`.

## See also

- [`sproutsdata`](https://github.com/sproutsdata-ai/sproutsdata-js/tree/main/packages/sdk): the SDK, with pagination, typed filters,
  relationships, research runs and usage.
- [`@sproutsdata.ai/langchain`](https://github.com/sproutsdata-ai/sproutsdata-js/tree/main/packages/langchain): the same tools for LangChain.
- [Integrations](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/integrations/README.md): the same tools in
  frameworks without a package of their own.

## License

The SDK code is released under the [MIT License](LICENSE).

The licence covers this code only. Use of the Sprouts Data API, and of the data
it returns, is governed by the Sprouts
[Terms and Conditions](https://sprouts.ai/terms-and-conditions) and
[Privacy Policy](https://sprouts.ai/privacy-policy), or by your agreement with
Sprouts Inc. if you have one.

# sproutsdata-js

The official JavaScript / TypeScript SDK for the **Sprouts Data API** — search
and enrich companies, people, patents, news, funding rounds, job openings and
market research over Sprouts' GTM index — and its AI-framework adapters.

| Package | Path | What it is |
| --- | --- | --- |
| `sproutsdata` | [`packages/sdk`](packages/sdk) | The SDK. `sproutsdata/tools` gives any function-calling model the three Sprouts tools |
| `@sproutsdata.ai/ai-sdk` | [`packages/ai-sdk`](packages/ai-sdk) | The Sprouts tools for the [Vercel AI SDK](https://ai-sdk.dev) |
| `@sproutsdata.ai/langchain` | [`packages/langchain`](packages/langchain) | The Sprouts tools as [LangChain](https://js.langchain.com) tools, and search as a retriever |

Each package versions independently.

## Install

```sh
npm install sproutsdata
export SPROUTSDATA_API_KEY=sk_dsp_test_<your-key>
```

Node.js 18 or later; no runtime dependencies. Use a `sk_dsp_test_` key while
developing: test keys are metered but charged **zero credits**.

## Quick start

Search, then fetch the full record behind the first result:

```ts
import { SproutsData, lookupRef } from 'sproutsdata';

const client = new SproutsData(); // reads SPROUTSDATA_API_KEY

const page = await client.search({ query: 'fintech companies in Germany', category: 'company', mode: 'auto', limit: 10 });
console.log(page.total, page.total_is_estimate ? 'matches (at least)' : 'matches');

for (const hit of page.results) console.log(hit['account_name'], hit['domain'], hit.score);

const ref = page.results[0] ? lookupRef(page.results[0]) : null; // { by: 'domain', value: '…' }
if (ref) {
  const lookup = await client.entities.companies({ ids: [ref.value], by: ref.by });
  for (const hit of lookup.results) console.log(hit.matches[0]?.account_name, hit.matches[0]?.employee_count);
}
```

A hit's `id` is not a lookup key; `lookupRef(hit)` is how to look the row up —
by domain for a company, by LinkedIn URL for a person.

## What it covers

In the order of the [SDK README](packages/sdk/README.md), which has an example
of each:

| | |
|---|---|
| `search()` | Companies, people and seven document corpora; `fast`, `auto` (parses the query into filters) or `deep` (agentic, one page). [Filters](docs/filters.md), [pagination](docs/pagination.md) |
| `similar()` | Look-alike companies from one or more anchors |
| `filterValues()`, `sorts()` | The live filter vocabulary and sort catalogue, free. [Sorting](docs/sorting.md) |
| `coverage()` | What the index holds, per segment, free |
| `entities.*` | Typed full records, one method per category; misses are returned, never dropped |
| `relationships.*` | Warm paths into an account — who is connected, and **why**. [Relationships](docs/relationships.md) |
| `orgChart.*` | A company's people counted by department, seniority and place. [Org charts](docs/org-chart.md) |
| `runs.*` | Asynchronous research: candidates verified against criteria you state in words. [Agent runs](docs/runs.md) |
| `credits.*` | The balance and this key's spend, free |
| `history.*` | What this key has done — per call, with the request body, free. [Usage](docs/usage.md) |
| `feedback.*` | Report a wrong answer or a product problem, and like, dislike or flag an answer. [Feedback](docs/feedback.md) |
| `lists.*`, `searchExport()` | The workspace's saved lists, and CSV export of lists and search results. [Saved lists](docs/lists.md) |
| `members.resolve()` | Whether an email belongs to a member of the key's organisation |

## Tools for models

`sproutsdata/tools` gives a model `sprouts_search`, `sprouts_similar` and
`sprouts_entity_lookup` — the Sprouts MCP server's names, schemas and results —
for OpenAI, Anthropic or any function-calling model, without importing a
provider SDK:

```ts
import { Toolset } from 'sproutsdata/tools';

const tools = new Toolset(new SproutsData(), { maxResults: 10 });
tools.openai();    // Chat Completions tool definitions; tools.anthropic() for Claude
await tools.handleOpenAIToolCalls(message); // answers every call in the message
```

See [Tools for models](docs/tools.md) and the runnable
[OpenAI](examples/tools-openai.ts) and [Anthropic](examples/tools-anthropic.ts)
examples.

## Adapters

The [Vercel AI SDK](packages/ai-sdk) and [LangChain](packages/langchain)
packages are thin layers over `sproutsdata/tools`, with `sproutsdata` as a peer
dependency. Frameworks without a package of their own — the OpenAI Agents SDK
among them — are covered by short [recipes](docs/integrations/README.md).

## Errors

Every error is a `SproutsDataError`, classed by the API's `code` first: branch on
`err.code`, and quote `err.requestId` to support. `402` (no credits) and `429`
(rate limited) are opposites — waiting never fixes the first. A `422` names the
offending fields on `err.fieldErrors` and in the message. See
[Errors and retries](docs/errors.md).

## Retries

Up to `maxRetries` (default 2), by what a repeat costs: a billed call (search,
look-alikes, lookups, relationships, org charts) that may have reached the
server is raised with `reachedServer: true` rather than repeated, because it may
already have been charged. `runs.create` is retried safely under its
`Idempotency-Key`. Redirects are never followed.

## Configuration

`apiKey` / `SPROUTSDATA_API_KEY`, and `baseUrl` / `SPROUTSDATA_BASE_URL`
(default `https://api.sproutsdata.ai`, `https://` only), `timeoutMs` (default
60 s) and `maxRetries`. See [Authentication](docs/authentication.md#configuration).

## API keys are server-side credentials

The API rejects any request carrying both an `Origin` header and an
`X-API-Key` (`403 auth.browser_origin`), and the client throws if constructed in
a browser. Call from a server you control; the client never prints the key.

## Links

- The guide: [`docs/`](docs/README.md) — start with the
  [quickstart](docs/quickstart.md)
- Runnable programs, type-checked by `npm test`: [`examples/`](examples/)
- What changed, and how to migrate: [`packages/sdk/CHANGELOG.md`](packages/sdk/CHANGELOG.md)
- The API contract, vendored from sproutsdata-py: [`spec/`](spec/)
- Contributing, and the design rules: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Reporting a vulnerability: [`SECURITY.md`](SECURITY.md)

## Development

```bash
npm install        # installs all workspaces
npm run build      # builds every workspace (sdk first)
npm run typecheck  # tsc --noEmit per workspace, and over examples/
npm test           # every workspace's tests, the examples' type-check, the link check
npm run lint       # ESLint over every workspace
npm run check:generated  # the vendored spec and generated files are current
```

The SDK is always built first: the adapters resolve `sproutsdata` through the
workspace symlink to its `dist/`.

## License

MIT

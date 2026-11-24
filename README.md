# sproutsdata-js

The official JavaScript and TypeScript SDK for the **Sprouts Data API**, and its
AI-framework adapters. Search and look up companies, people, patents, news,
funding rounds, job openings and market research; map who knows whom; count a
company's people; start agent runs; keep saved lists; and read credits, history and
feedback.

| Package | Path | What it is |
| --- | --- | --- |
| `sproutsdata` | [`packages/sdk`](packages/sdk) | The SDK. `sproutsdata/tools` gives any function-calling model the three Sprouts tools |
| `@sproutsdata.ai/ai-sdk` | [`packages/ai-sdk`](packages/ai-sdk) | The Sprouts tools for the [Vercel AI SDK](https://ai-sdk.dev) |
| `@sproutsdata.ai/langchain` | [`packages/langchain`](packages/langchain) | The Sprouts tools as [LangChain](https://js.langchain.com) tools, and search as a retriever |

Each package versions independently. Upgrading from `sproutsdata@0.0.1`? Read
the [migration guide](packages/sdk/MIGRATION.md).

## Install

```sh
npm install sproutsdata
export SPROUTSDATA_API_KEY=sk_dsp_live_<your-key>
```

Node.js 22.12.0 or newer (or Deno, Bun or an edge runtime); no runtime
dependencies. The SDK runs on servers only: it refuses to run in a browser.
Every key is a live key: each billed call is charged to the workspace's credits,
and a new workspace starts with sign-up credits for evaluation.

## Quick start

Search, then fetch the full record behind the first row:

```ts
import { SproutsData, entityHit, lookupRef, recordsOf } from 'sproutsdata';

const client = new SproutsData(); // reads SPROUTSDATA_API_KEY

const page = await client.search({ query: 'fintech companies in Germany', mode: 'auto', limit: 10 });
console.log(page.total, page.total_is_estimate ? 'matches (at least)' : 'matches');
for (const hit of page.results) console.log(hit['account_name'], hit['domain'], hit.score);

const first = page.results[0];
const ref = first === undefined ? undefined : lookupRef(first);
if (ref !== undefined && (ref.by === 'domain' || ref.by === 'li_url')) {
  const answer = await client.entities.companies({ ids: [ref.value], by: ref.by });
  const hit = entityHit(answer, ref.value);
  for (const record of hit === undefined ? [] : recordsOf(hit)) console.log(record);
}
```

`lookupRef(hit)` says how to look a search row up: a company by its domain,
else its LinkedIn page; a person by their LinkedIn URL; a document by its
`d1_...` id.

## What it covers

| | |
|---|---|
| `search`, `iterSearch` | Companies, people and seven document corpora; `fast` or `auto`. [Quickstart](docs/quickstart.md), [Filters](docs/filters.md), [Pagination](docs/pagination.md) |
| `similar`, `iterSimilar` | Look-alike companies from one or more anchors |
| `filterValues`, `documentFilterValues`, `sorts`, `coverage` | The filter vocabularies, the sort catalogue and what the index holds; free. [Sorting](docs/sorting.md) |
| `entities.*` | Full records, one method per category; values that matched nothing are reported, not dropped |
| `relationships.*` | Who is connected to whom, and why. [Relationships](docs/relationships.md) |
| `orgChart.*` | A company's people counted by department, seniority and place, and the people one count holds. [Org charts](docs/org-chart.md) |
| `enrichment.*` | Emails and phones for people, domains, phones and LinkedIn pages for companies: a lookup in the call, or a job. [Enrichment](docs/enrichment.md) |
| `runs.*` | Agents: start an agent run, follow it, read it. [Agent runs](docs/runs.md) |
| `lists.*`, `searchExport`, `exports.*` | Saved lists, and CSV export as a file or a job. [Saved lists](docs/lists.md) |
| `credits.*`, `history.*` | The balance, the ledger, the call history and daily totals; free. [Credits and usage](docs/usage.md) |
| `feedback.*` | Reports and votes on answers; free. [Feedback](docs/feedback.md) |

## Tools for models

`sproutsdata/tools` gives a model `sprouts_search`, `sprouts_similar` and
`sprouts_entity_lookup` (the Sprouts MCP server's names, schemas and results)
for OpenAI, Anthropic or any function-calling model, without importing a
provider SDK:

```ts
import { SproutsData } from 'sproutsdata';
import { Toolset } from 'sproutsdata/tools';

const tools = new Toolset(new SproutsData(), { maxResults: 10 });
console.log(tools.openai(), tools.anthropic()); // tool definitions for each provider
console.log(await tools.run('sprouts_search', { query: 'payments companies in Germany' }));
```

See [Tools for models](docs/tools.md) and the runnable
[OpenAI](examples/tools-openai.ts) and [Anthropic](examples/tools-anthropic.ts)
examples.

## Adapters

The [Vercel AI SDK](packages/ai-sdk) and [LangChain](packages/langchain)
packages are thin layers over `sproutsdata/tools`, with `sproutsdata` as a peer
dependency; a client given to either is used as it is. Frameworks without a
package of their own, such as the OpenAI Agents SDK, use the toolset directly:
see [Integrations](docs/integrations/README.md).

## Errors and retries

Everything the SDK throws is a `SproutsDataError`. Branch on the class or on
`err.code`, and quote `err.requestId` to support. A 402 (no credits) and a 429
(rate limited) are different: waiting never fixes the first. A request the
server would refuse is refused locally with a `ClientValidationError`, before
anything is sent.

Up to `maxRetries` (default 2) retries, by what a repeat costs: a billed call
(search, look-alikes, lookups, relationships, org charts), `runs.create`, the
enrichment calls and `feedback.create` are retried under their `Idempotency-Key`,
so a repeat is charged once and starts nothing twice. `lists.create` and
`lists.delete` that may have reached the server are raised with
`reachedServer: true` rather than repeated.
Redirects are never followed. See [Errors and retries](docs/errors.md).

## Configuration

`apiKey` / `SPROUTSDATA_API_KEY`, `baseUrl` / `SPROUTSDATA_BASE_URL` (default
`https://api.sproutsdata.ai`, `https://` only), `timeoutMs` (default 60
seconds), `maxRetries`, `defaultHeaders`, `fetch` and `onResponse`. See
[Authentication](docs/authentication.md#configuration).

## API keys are server-side credentials

The API refuses any key sent with an `Origin` header (a plain 401), and the
client throws if constructed in a browser. Call from a server you control; the
client never prints the key.

## Links

- The guide: [`docs/`](docs/README.md); start with the
  [quickstart](docs/quickstart.md)
- Upgrading from 0.0.1: [`packages/sdk/MIGRATION.md`](packages/sdk/MIGRATION.md)
- Runnable programs: [`examples/`](examples/)
- What changed in each release: [`packages/sdk/CHANGELOG.md`](packages/sdk/CHANGELOG.md)
- The API contract, vendored from sproutsdata-py: [`spec/`](spec/)
- Contributing, the gate and the design rules: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Reporting a vulnerability: [`SECURITY.md`](SECURITY.md)

## Development

```bash
npm install        # installs all workspaces
npm run check      # the whole gate: lint, layers, generated code, build, types, tests,
                   # package checks, size, smoke tests, doc snippets, links, audit
npm run build      # builds every workspace (the SDK first)
npm test           # every workspace's tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md#the-gate) for each step.

## License

The SDK code is released under the [MIT License](LICENSE).

The licence covers this code only. Use of the Sprouts Data API, and of the data
it returns, is governed by the Sprouts
[Terms and Conditions](https://sprouts.ai/terms-and-conditions) and
[Privacy Policy](https://sprouts.ai/privacy-policy), or by your agreement with
Sprouts Inc. if you have one.

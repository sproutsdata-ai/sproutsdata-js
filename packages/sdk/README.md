# sproutsdata

The official JavaScript and TypeScript SDK for the **Sprouts Data API**: search
and look up companies, people, patents, news, funding rounds, job openings and
market research; map who knows whom; count a company's people; start agent
runs; keep saved lists and export them; and read credits, history and feedback.

No runtime dependencies. Node.js 22.12.0 or newer, or Deno, Bun or an edge
runtime, on a server: the client refuses to run in a browser. ESM and CommonJS,
with TypeScript types generated from the API's own models.

Upgrading from `sproutsdata@0.0.1`? Every renamed, removed or reshaped call is
in the [migration guide](MIGRATION.md).

## Install

```sh
npm install sproutsdata
export SPROUTSDATA_API_KEY=sk_dsp_live_<your-key>
```

Keys are created in the Sprouts Data dashboard. Every key is a live key: each
billed call is charged to the workspace's credits, and a new workspace starts
with sign-up credits for evaluation.

## Quick start

Search, then fetch the full record behind the first row:

```ts
import { SproutsData, entityHit, lookupRef, recordsOf } from 'sproutsdata';

const client = new SproutsData(); // reads SPROUTSDATA_API_KEY

const page = await client.search({ query: 'fintech companies in Germany', mode: 'auto', limit: 10 });
console.log(`${page.total}${page.total_is_estimate ? '+' : ''} matches, ${page.meta.credits_charged ?? 0} credits`);
for (const hit of page.results) console.log(hit['account_name'], hit['domain'], hit.score);

const first = page.results[0];
const ref = first === undefined ? undefined : lookupRef(first);
if (ref !== undefined && (ref.by === 'domain' || ref.by === 'li_url')) {
  const answer = await client.entities.companies({ ids: [ref.value], by: ref.by });
  const hit = entityHit(answer, ref.value);
  for (const record of hit === undefined ? [] : recordsOf(hit)) console.log(record);
}
```

A row always has `id`, `category` and `score`; the rest is the record's own
fields. `lookupRef(hit)` says how to look a row up: a company by its domain,
else its LinkedIn page; a person by their LinkedIn URL; a document by its
`d1_...` id. A person row's `id` is a hash no lookup resolves.

## What it covers

| Call | What it does | Guide |
|---|---|---|
| `search`, `iterSearch` | Companies, people and seven document corpora; `fast` or `auto` | [Quickstart](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/quickstart.md), [Pagination](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/pagination.md) |
| `similar`, `iterSimilar` | Look-alike companies from one or more anchors | [Quickstart](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/quickstart.md#look-alikes) |
| `filterValues`, `documentFilterValues`, `sorts`, `coverage` | The filter vocabularies, the sort catalogue, what the index holds; free | [Filters](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/filters.md), [Sorting](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/sorting.md) |
| `entities.*` | Full records, one method per category | [Quickstart](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/quickstart.md#full-records) |
| `relationships.find`, `reach`, `institutions`, `ask` | Who knows whom, and why | [Relationships](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/relationships.md) |
| `orgChart.retrieve`, `departments`, `locations`, `taxonomy` | A company's people, counted | [Org charts](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/org-chart.md) |
| `runs.*` | Agents: start an agent run, follow it, read it | [Agent runs](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/runs.md) |
| `lists.*`, `searchExport`, `exports.*` | Saved lists, and CSV export as a file or a job | [Saved lists](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/lists.md) |
| `credits.retrieve`, `credits.transactions` | The balance and the ledger; free | [Credits and usage](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/usage.md) |
| `history.list`, `retrieve`, `metrics` | The workspace's calls and daily totals; free | [Credits and usage](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/usage.md) |
| `feedback.create`, `list`, `tags`, `votes.*` | Reports and votes on answers; free | [Feedback](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/feedback.md) |

## Search

```ts
const page = await client.search({
  query: 'payments companies in Germany with 500 to 5000 staff',
  category: 'company', // the default; or person, patent, news_article, funding_round, ...
  mode: 'auto', // 'fast' (the default) does not turn the words into filters
  limit: 10,
});
console.log(page.resolved_search?.filters);
```

- `fast` and `auto` both read the words into filters (the filters you send win)
  and report them in `resolved_search`; `auto` is billed as an AI search. `deep`
  is no longer offered: start an agent run (`runs.create`) instead.
- `category: 'auto'` lets the question pick the category; it takes only
  `query`, `mode`, `limit` and `cursor`.
- Company and person searches take the typed `DiscoverFilters`; each document
  category takes its own filter type and refuses `DiscoverFilters`.
- The SDK checks every request against the server's models before sending it,
  and throws `ClientValidationError` for what the server would refuse.

Billing is per search session: page 1 costs the price list's base, which covers
its first rows; a later page costs only the rows it adds beyond those; a page
already paid for is free; asking for page 1 again opens a new session.
`meta.credits_charged` is what a page cost. A cursor expires after 24 hours and
must be sent with the same arguments.

```ts
for await (const hit of client.iterSearch({ query: 'fintech companies in Germany', maxResults: 200 })) {
  console.log(hit.id);
}
```

## Exports

`lists.export` and `searchExport` answer with the CSV at once, or with a job to
wait for:

```ts
const lists = await client.lists.list();
const first = lists.lists[0];
if (first !== undefined) {
  const result = await client.lists.export(first.id);
  const csv = result.kind === 'file' ? result.csv : await client.exports.download((await client.exports.wait(result.job.job_id)).job_id);
  console.log(csv.split('\n')[0]);
}
```

## Credits

```ts
import { canAfford } from 'sproutsdata';

const credits = await client.credits.retrieve();
console.log(credits.balance, credits.reserved, credits.available, credits.debt, credits.status);
if (!canAfford(credits, 10)) console.warn('Low on credits');

for await (const row of client.credits.iterTransactions({ maxResults: 20 })) console.log(row.kind, row.credits, row.action);
```

## Tools for models

`sproutsdata/tools` gives a model three tools, `sprouts_search`,
`sprouts_similar` and `sprouts_entity_lookup`, with the same names, schemas and
results as the Sprouts MCP server and the Python SDK. It builds the definitions
and runs the calls for OpenAI or Anthropic, without importing either SDK:

```ts
import { SproutsData } from 'sproutsdata';
import { Toolset } from 'sproutsdata/tools';

const tools = new Toolset(new SproutsData(), { maxResults: 10 });
console.log(tools.openai(), tools.anthropic());
const result = await tools.run('sprouts_search', { query: 'payments companies in Germany' });
console.log(result);
```

Errors a model can act on come back as `{ error: {...} }`; a rejected key, a
missing scope or too few credits is thrown. See
[Tools for models](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/tools.md).

## Adapters

| Package | What it is |
| --- | --- |
| [`@sproutsdata.ai/ai-sdk`](https://github.com/sproutsdata-ai/sproutsdata-js/tree/main/packages/ai-sdk) | The Sprouts tools for the Vercel AI SDK |
| [`@sproutsdata.ai/langchain`](https://github.com/sproutsdata-ai/sproutsdata-js/tree/main/packages/langchain) | The Sprouts tools as LangChain tools, and search as a retriever |

Both are thin layers over `sproutsdata/tools`, with `sproutsdata` as a peer
dependency. A client given to an adapter is used as it is. See
[Integrations](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/integrations/README.md).

## Errors

```ts
import { APIError, InsufficientCreditsError, RateLimitError } from 'sproutsdata';

try {
  await client.search({ query: 'fintech' });
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    console.error(`need ${err.requiredCredits ?? '?'}, have ${err.availableCredits ?? '?'}`); // waiting does not help
  } else if (err instanceof RateLimitError) {
    console.error(`rate limited; retry after ${err.retryAfter ?? '?'} s`); // already retried within maxRetries
  } else if (err instanceof APIError) {
    console.error(err.status, err.code, err.requestId);
  } else {
    throw err;
  }
}
```

Everything the SDK throws is a `SproutsDataError`. Branch on the class or on
`err.code`, never on `title` or `detail`, and log `err.requestId`. See
[Errors and retries](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/errors.md).

## Retries

Up to `maxRetries` (default 2), with full-jitter backoff, and a `Retry-After` of
up to 60 seconds waited out in full. What is retried depends on what repeating
the call costs: a billed call (search, look-alikes, lookups, relationships, org
charts) that may have reached the server without an answer is raised with
`reachedServer: true`, never repeated, because it may already have been
charged. `runs.create` and `feedback.create` are retried under their
`Idempotency-Key`. Redirects are never followed. The default rate limit is 60
requests a minute per endpoint.

## Configuration

| Option | Environment variable | Default |
|---|---|---|
| `apiKey` | `SPROUTSDATA_API_KEY` | none: required |
| `baseUrl` | `SPROUTSDATA_BASE_URL` | `https://api.sproutsdata.ai` |
| `timeoutMs` | | `60000` |
| `maxRetries` | | `2` |
| `defaultHeaders`, `fetch`, `onResponse` | | none |

Every method takes per-call options as its last argument:

```ts
const controller = new AbortController();
await client.search({ query: 'fintech' }, { timeoutMs: 120_000, maxRetries: 0, signal: controller.signal });
await client.search({ query: 'fintech' }, { requestId: 'job-42', onResponse: (meta) => console.log(meta.rateLimit) });
```

See [Authentication](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/authentication.md#configuration).

## API keys are server-side credentials

The API refuses any key sent with an `Origin` header (a plain 401), and the
client throws if constructed in a browser. Call from a server you control. The
SDK never sends `Origin` or `Referer` and refuses them in `defaultHeaders`, and
`JSON.stringify` or `util.inspect` of the client shows the key redacted.

## Links

- The guide: [`docs/`](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/README.md); start with the
  [quickstart](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/docs/quickstart.md)
- Upgrading from 0.0.1: [`MIGRATION.md`](MIGRATION.md)
- Runnable programs: [`examples/`](https://github.com/sproutsdata-ai/sproutsdata-js/tree/main/examples/)
- What changed in each release: [`CHANGELOG.md`](CHANGELOG.md)
- The API's own changes: [`spec/CHANGELOG.md`](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/spec/CHANGELOG.md)
- Reporting a vulnerability: [`SECURITY.md`](https://github.com/sproutsdata-ai/sproutsdata-js/blob/main/SECURITY.md)

## License

The SDK code is released under the [MIT License](LICENSE).

The licence covers this code only. Use of the Sprouts Data API, and of the data
it returns, is governed by the Sprouts
[Terms and Conditions](https://sprouts.ai/terms-and-conditions) and
[Privacy Policy](https://sprouts.ai/privacy-policy), or by your agreement with
Sprouts Inc. if you have one.

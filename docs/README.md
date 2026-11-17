# sproutsdata docs

The JavaScript and TypeScript SDK for the Sprouts Data API: search and look up
companies, people, patents, news, funding rounds, job openings and market
research, map who knows whom, count a company's people, start agent runs, and
keep saved lists.

```sh
npm install sproutsdata
```

Requires Node.js 22.12.0 or newer (or Deno, Bun or an edge runtime), on a
server: the SDK refuses to run in a browser.

Upgrading from `sproutsdata@0.0.1`? Read the
[migration guide](../packages/sdk/MIGRATION.md).

## Guide

| Page | What it covers |
|---|---|
| [Quickstart](quickstart.md) | Install, configure, search, look-alikes, full records, and how to read an answer |
| [Authentication](authentication.md) | Key format, charging, scopes, rotation, server-side only, configuration |
| [Errors and retries](errors.md) | The error classes, validation, what is retried and why, idempotency, rate limits, response details |
| [Pagination](pagination.md) | Signed cursors, the `iter*` walks, the depth cap, truncated results |
| [Filters](filters.md) | The typed filter vocabularies, domain lists, listing the values a filter accepts |
| [Sorting](sorting.md) | Ordering by a field instead of relevance, and the sort catalogue |
| [Relationships](relationships.md) | Who knows whom: `find`, `reach`, `institutions`, `ask` |
| [Org charts](org-chart.md) | A company's people counted by department, seniority and place |
| [Agent runs](runs.md) | Agents: start a run, follow it, read it |
| [Saved lists and export](lists.md) | The workspace's saved lists, and CSV export of lists and search rows |
| [Feedback](feedback.md) | Reporting on an answer, and voting on one |
| [Credits and usage history](usage.md) | The balance, the ledger, the call history and daily totals |
| [Tools for models](tools.md) | The three Sprouts tools for OpenAI, Anthropic and any function-calling model |
| [Integrations](integrations/README.md) | The Vercel AI SDK and LangChain packages, and other frameworks |

## Elsewhere

- Runnable programs: [`examples/`](../examples/)
- The package README, a one-page tour: [`packages/sdk/README.md`](../packages/sdk/README.md)
- Upgrading from 0.0.1: [`packages/sdk/MIGRATION.md`](../packages/sdk/MIGRATION.md)
- What changed in each release: [`packages/sdk/CHANGELOG.md`](../packages/sdk/CHANGELOG.md)
- The API contract both SDKs keep: [`spec/`](../spec/)

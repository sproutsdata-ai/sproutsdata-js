# sproutsdata docs

The JavaScript / TypeScript SDK for the Sprouts Data API: search and enrich
companies, people, patents, news, funding rounds, job openings and market
research over Sprouts' GTM index.

```sh
npm install sproutsdata
```

## Guide

| Page | What it covers |
|---|---|
| [Quickstart](quickstart.md) | Install, configure, search, look-alikes, full records, and reading a response honestly |
| [Authentication](authentication.md) | Key format, live and test keys, scopes, server-side only, configuration |
| [Errors and retries](errors.md) | The error classes, validation detail, what is retried and why, idempotency, troubleshooting |
| [Pagination](pagination.md) | Signed cursors, the page iterators, the depth cap, truncated results |
| [Filters](filters.md) | The typed filter vocabulary, document filters, domain lists, enumerating filter values |
| [Sorting](sorting.md) | Ordering by a field instead of relevance, and the live sort catalogue |
| [Relationships](relationships.md) | Who knows whom: `find`, `reach`, `institutions`, `ask` |
| [Org charts](org-chart.md) | A company's people counted by department, seniority and place |
| [Agent runs](runs.md) | Asynchronous research: start, watch, read |
| [Saved lists and export](lists.md) | The workspace's saved lists, and CSV export of lists and search results |
| [Feedback](feedback.md) | Reporting a wrong answer or a product problem, and voting on an answer |
| [Credits, usage history and members](usage.md) | Balance, per-key spend, call history and replay, member lookup |
| [Tools for models](tools.md) | The three Sprouts tools for OpenAI, Anthropic and any function-calling model |
| [Integrations](integrations/README.md) | The Vercel AI SDK and LangChain packages, and recipes for other frameworks |

## Elsewhere

- Runnable programs: [`examples/`](../examples/)
- The package README, a one-page tour: [`packages/sdk/README.md`](../packages/sdk/README.md)
- What changed, and how to migrate: [`packages/sdk/CHANGELOG.md`](../packages/sdk/CHANGELOG.md)
- The API contract both SDKs keep: [`spec/`](../spec/)

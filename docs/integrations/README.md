# Integrations

Every integration gives a model the same three tools — `sprouts_search`,
`sprouts_similar` and `sprouts_entity_lookup` — with the same names, input
schemas and results as the Sprouts MCP server, because each one is built on
[`sproutsdata/tools`](../tools.md).

## Packages

Two frameworks have a package of their own:

| Framework | Package | What it adds |
|---|---|---|
| Vercel AI SDK | [`@sproutsdata.ai/ai-sdk`](../../packages/ai-sdk) | `sproutsDataTools()` for `generateText` / `streamText`, and a stop condition that rethrows a 401, 403 or 402 |
| LangChain | [`@sproutsdata.ai/langchain`](../../packages/langchain) | The tools as LangChain tools, and search as a retriever |

`sproutsdata` is a peer dependency of each, so your application and the adapter
share one copy:

```sh
npm install @sproutsdata.ai/ai-sdk sproutsdata ai
npm install @sproutsdata.ai/langchain sproutsdata @langchain/core
```

## Recipes

Frameworks that take a JSON Schema tool need no package — a few lines over
`sproutsdata/tools` cover them, and each recipe shows the Sprouts MCP server
route beside it:

| Framework | Recipe |
|---|---|
| OpenAI Agents SDK (`@openai/agents`) | [openai-agents.md](openai-agents.md) |

Any other framework works the same way: `toolset.definitions()` (or
`toolset.openai()`) for the names, descriptions and schemas, and
`toolset.run(name, args)` for each call. For the OpenAI and Anthropic APIs
directly, the toolset's own helpers build and read the plain objects — see
[Tools for models](../tools.md) and the runnable
[examples](../../examples/).

# OpenAI Agents SDK

There is no OpenAI Agents package: the Agents SDK accepts a tool defined by a
JSON Schema, so [`sproutsdata/tools`](../tools.md)
covers it in a few lines. Two routes, both giving the model `sprouts_search`,
`sprouts_similar` and `sprouts_entity_lookup` with the same schemas and results
as every other surface. Written against `@openai/agents` 0.17.0.

```sh
npm install sproutsdata @openai/agents
```

## With the SDK's tools

```ts
import { Agent, run, tool, type JsonSchemaDefinition } from '@openai/agents';
import { SproutsData } from 'sproutsdata';
import { Toolset, toJson, type OpenAIResponsesTool } from 'sproutsdata/tools';

// The strict-mode JSON Schema shape `tool()` takes.
type StrictSchema = Extract<JsonSchemaDefinition['schema'], { additionalProperties: false }>;

const toolset = new Toolset(new SproutsData()); // reads SPROUTSDATA_API_KEY

const tools = (toolset.openai({ api: 'responses' }) as OpenAIResponsesTool[]).map((definition) =>
  tool({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters as StrictSchema,
    strict: true,
    execute: async (input) => toJson(await toolset.run(definition.name, input as Record<string, unknown>)),
    errorFunction: null, // a rejected key, a missing scope or no credits stops the run
  }),
);

const agent = new Agent({ name: 'Prospector', tools });
const result = await run(agent, 'Find VPs of Marketing at fintech companies in Germany.');
console.log(result.finalOutput);
```

`toolset.openai({ api: 'responses' })` gives the strict-mode schema, which the
Agents SDK sends unchanged; a model in strict mode sends `null` for an argument
it does not use, and the toolset reads that as "not set". The Agents SDK passes
a JSON Schema tool's arguments through without checking them, so the toolset
does: a bad argument comes back to the model as an `{"error": {...}}` result it
can correct, and so do 404, 409, 422, 429, 5xx and timeouts. Arguments that are
not valid JSON never reach `execute`; the Agents SDK answers the model itself.

`errorFunction: null` matters. By default the Agents SDK turns anything a tool
throws into a message for the model, and the toolset throws only what the model
cannot fix. With it, a rejected key (401), a missing scope (403) or exhausted
credits (402) stop the run: `run()` rejects with a `ToolCallError` whose
`error` is the SDK's `AuthenticationError`, `PermissionDeniedError` or
`InsufficientCreditsError`.

The toolset's settings — `include`, `fixed`, `defaults`, `maxResults` (1–25)
and `baselineFilters` — are described in
[Settings the model cannot change](../tools.md#settings-the-model-cannot-change).

## With the Sprouts MCP server

```ts
import { Agent, MCPServerStreamableHttp, run } from '@openai/agents';

const sprouts = new MCPServerStreamableHttp({
  name: 'sprouts',
  url: 'https://dashboard.sproutsdata.ai/mcp?client=direct&tools=sprouts_search,sprouts_similar,sprouts_entity_lookup',
  requestInit: { headers: { 'X-API-Key': process.env.SPROUTSDATA_API_KEY ?? '' } },
});

await sprouts.connect();
try {
  const agent = new Agent({ name: 'Prospector', mcpServers: [sprouts] });
  const result = await run(agent, 'Find VPs of Marketing at fintech companies in Germany.');
  console.log(result.finalOutput);
} finally {
  await sprouts.close();
}
```

The Agents SDK's MCP client needs its optional peer, `@modelcontextprotocol/client`
(`npm install @modelcontextprotocol/client`). `tools=` narrows the server's
tools to these three; leave it out for all of them. `client=direct` attributes
the usage, so keep it as written. The key travels in the `X-API-Key` header; a
`sk_dsp_test_<your-key>` key queries the same records and costs nothing.

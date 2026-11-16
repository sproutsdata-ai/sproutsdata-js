# OpenAI Agents SDK

There is no OpenAI Agents package. The Agents SDK accepts a tool defined by a
JSON Schema, so the core [`sproutsdata/tools`](../tools.md) toolset covers it
directly, giving the model `sprouts_search`, `sprouts_similar` and
`sprouts_entity_lookup` with the same schemas and results as every other
surface. Written against `@openai/agents` 0.21.0.

```sh
npm install sproutsdata @openai/agents
```

<!-- snippet: skip -->
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
    parameters: definition.parameters as unknown as StrictSchema,
    strict: true,
    execute: async (input) => toJson(await toolset.run(definition.name, input as Record<string, unknown>)),
    errorFunction: null, // a rejected key, a missing scope or no credits stops the run
  }),
);

const agent = new Agent({ name: 'Prospector', tools });
const result = await run(agent, 'Find VPs of Marketing at fintech companies in Germany.');
console.log(result.finalOutput);
```

`toolset.openai({ api: 'responses' })` gives the strict-mode schema. A model in
strict mode sends `null` for an argument it does not use, and the toolset reads
that as "not set". The toolset checks the arguments itself: a bad argument comes
back to the model as an `{"error": {...}}` result it can correct, and so do
404, 409, 422, 429, 5xx and timeouts.

`errorFunction: null` matters. By default the Agents SDK turns anything a tool
throws into a message for the model, and the toolset throws only what the model
cannot fix. With `null`, a rejected key (401), a missing scope (403) or too few
credits (402) stop the run: `run()` rejects with a `ToolCallError` whose
`error` is the SDK's `AuthenticationError`, `PermissionDeniedError` or
`InsufficientCreditsError`.

The toolset's settings (`include`, `fixed`, `defaults`, `maxResults` and
`baselineFilters`) are described in
[Settings the model cannot change](../tools.md#settings-the-model-cannot-change).

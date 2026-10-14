/**
 * Give an OpenAI model the Sprouts tools and answer its tool calls until it is
 * done.
 *
 * `sproutsdata/tools` imports no provider SDK: `tools.openai()` builds the
 * plain Chat Completions tool definitions (strict mode), and
 * `tools.handleOpenAIToolCalls(message)` runs every call in an assistant
 * message and returns the `tool` messages to send back. So this example talks
 * to the API over plain HTTP; with the official `openai` package, pass the same
 * objects to `client.chat.completions.create`.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_test_<your-key>
 *   export OPENAI_API_KEY=<your-openai-key>
 *   export OPENAI_MODEL=<a model that calls tools>
 *   npx tsx examples/tools-openai.ts "Companies like Adyen and Checkout.com in the Nordics"
 */

import { SproutsData } from 'sproutsdata';
import { Toolset } from 'sproutsdata/tools';

/** The parts of a Chat Completions response this loop reads. */
interface ChatResponse {
  choices: Array<{ message: { content: string | null; tool_calls?: unknown[] } }>;
}

const model = process.env.OPENAI_MODEL;
if (!model) throw new Error('Set OPENAI_MODEL to a model that supports tool calls.');

const prompt = process.argv.slice(2).join(' ') || 'Companies like Adyen and Checkout.com in the Nordics';
const tools = new Toolset(new SproutsData(), { maxResults: 10 });

const messages: unknown[] = [{ role: 'user', content: prompt }];

async function complete(): Promise<ChatResponse> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
    },
    body: JSON.stringify({ model, messages, tools: tools.openai() }),
  });
  if (!response.ok) throw new Error(`Chat Completions ${response.status}: ${await response.text()}`);
  return (await response.json()) as ChatResponse;
}

for (let turn = 0; turn < 8; turn += 1) {
  const message = (await complete()).choices[0]?.message;
  if (message === undefined) break;
  messages.push(message);

  if (!message.tool_calls?.length) {
    console.log(message.content);
    break;
  }

  // One `tool` message per call, in order — an unknown tool or arguments that
  // are not valid JSON included — so the next request is always valid. Strict
  // mode sends `null` for an argument the model does not use, which the
  // toolset reads as "not set".
  messages.push(...(await tools.handleOpenAIToolCalls(message)));
}

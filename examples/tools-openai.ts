/**
 * Give an OpenAI model the Sprouts tools and answer its tool calls until it is done.
 *
 * `sproutsdata/tools` imports no provider SDK: `tools.openai()` builds the plain Chat Completions
 * tool definitions (strict mode), and `tools.handleOpenAIToolCalls(message)` runs every call in an
 * assistant message and returns the `tool` messages to send back. This example talks to the API
 * over plain HTTP; with the official `openai` package, pass the same objects to
 * `client.chat.completions.create`. Without `OPENAI_API_KEY` it replays one scripted tool call,
 * so you can see what the model would receive.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_live_<your-key>
 *   export OPENAI_API_KEY=<your-openai-key> OPENAI_MODEL=<a model that calls tools>
 *   node examples/tools-openai.ts "Companies like Adyen and Checkout.com in the Nordics"
 */

import { SproutsData } from 'sproutsdata';
import { Toolset } from 'sproutsdata/tools';

/** The part of a Chat Completions response this loop reads. */
interface Message {
  readonly content: string | null;
  readonly tool_calls?: readonly unknown[];
}

const prompt = process.argv.slice(2).join(' ') || 'Companies like Adyen and Checkout.com in the Nordics';
const tools = new Toolset(new SproutsData(), { maxResults: 10 });
const messages: unknown[] = [{ role: 'user', content: prompt }];
const { OPENAI_API_KEY: apiKey, OPENAI_MODEL: model = 'gpt-4.1-mini' } = process.env;

async function complete(): Promise<Message | undefined> {
  if (apiKey === undefined) {
    // No model to ask: the call a model would make for this prompt, once.
    return messages.length > 1
      ? undefined
      : { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'sprouts_similar', arguments: '{"anchors":[{"value":"adyen.com"}],"limit":3}' } }] };
  }
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, tools: tools.openai() }),
  });
  if (!response.ok) throw new Error(`Chat Completions ${String(response.status)}: ${await response.text()}`);
  return ((await response.json()) as { choices: { message: Message }[] }).choices[0]?.message;
}

for (let turn = 0; turn < 8; turn += 1) {
  const message = await complete();
  if (message === undefined) break;
  messages.push(message);
  if (message.tool_calls === undefined || message.tool_calls.length === 0) {
    console.log(message.content);
    break;
  }
  // One `tool` message per call, in order (an unknown tool or invalid arguments included), so the
  // next request is always valid. Strict mode sends `null` for an unused argument, which the
  // toolset reads as "not set".
  const answers = await tools.handleOpenAIToolCalls(message);
  for (const answer of answers) console.log(JSON.stringify(answer).slice(0, 300));
  messages.push(...answers);
}

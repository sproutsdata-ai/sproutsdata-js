/**
 * Give Claude the Sprouts tools and answer its tool calls until it is done.
 *
 * `sproutsdata/tools` imports no provider SDK: `tools.anthropic()` builds the
 * plain tool definitions the Messages API takes, and
 * `tools.handleAnthropicToolUse(response)` runs every `tool_use` block in a
 * response and returns the `tool_result` blocks for the next user message. So
 * this example talks to the Messages API over plain HTTP; with the official
 * `@anthropic-ai/sdk`, pass the same objects to `client.messages.create`.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_test_<your-key>
 *   export ANTHROPIC_API_KEY=<your-anthropic-key>
 *   npx tsx examples/tools-anthropic.ts "Find VPs of Marketing at fintech companies in Germany."
 */

import { SproutsData } from 'sproutsdata';
import { Toolset } from 'sproutsdata/tools';

/** The parts of a Messages API response this loop reads. */
interface MessagesResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason: string | null;
}

const prompt = process.argv.slice(2).join(' ') || 'Find VPs of Marketing at fintech companies in Germany.';
const tools = new Toolset(new SproutsData(), { maxResults: 10 });

const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [{ role: 'user', content: prompt }];

async function create(): Promise<MessagesResponse> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
      // On a policy decline, the API re-runs the request on a fallback model.
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 16000,
      fallbacks: 'default',
      tools: tools.anthropic(),
      messages,
    }),
  });
  if (!response.ok) throw new Error(`Messages API ${response.status}: ${await response.text()}`);
  return (await response.json()) as MessagesResponse;
}

for (let turn = 0; turn < 8; turn += 1) {
  const response = await create();
  // The whole content goes back, thinking and tool_use blocks included.
  messages.push({ role: 'assistant', content: response.content });

  if (response.stop_reason === 'refusal') {
    console.log('The model declined this request.');
    break;
  }
  if (response.stop_reason !== 'tool_use') {
    for (const block of response.content) if (block.type === 'text') console.log(block.text);
    break;
  }

  // One answer per tool_use block, in order — an unknown tool or bad arguments
  // included, with `is_error: true` — so the next request is always valid.
  // A rejected key, a missing scope or no credits is thrown instead: only the
  // application can fix those.
  messages.push({ role: 'user', content: await tools.handleAnthropicToolUse(response) });
}

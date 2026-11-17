/**
 * Give Claude the Sprouts tools and answer its tool calls until it is done.
 *
 * `sproutsdata/tools` imports no provider SDK: `tools.anthropic()` builds the Messages API tool
 * definitions, and `tools.handleAnthropicToolUse(message)` runs every `tool_use` block and returns
 * the `tool_result` blocks to send back (a failed call carries `is_error: true`). This example
 * talks to the API over plain HTTP; with `@anthropic-ai/sdk`, pass the same objects to
 * `client.messages.create`. Without `ANTHROPIC_API_KEY` it replays one scripted tool call, so you
 * can see what the model would receive.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_live_<your-key>
 *   export ANTHROPIC_API_KEY=<your-anthropic-key> ANTHROPIC_MODEL=<a Claude model>
 *   node examples/tools-anthropic.ts "Payments companies in Germany with 200 to 2,000 people"
 */

import { SproutsData } from 'sproutsdata';
import { Toolset } from 'sproutsdata/tools';

/** The part of a Messages API response this loop reads. */
interface Reply {
  readonly content: readonly { readonly type: string; readonly text?: string; readonly id?: string; readonly name?: string; readonly input?: unknown }[];
  readonly stop_reason: string;
}

const prompt = process.argv.slice(2).join(' ') || 'Payments companies in Germany with 200 to 2,000 people';
const tools = new Toolset(new SproutsData(), { maxResults: 10 });
const messages: unknown[] = [{ role: 'user', content: prompt }];
const { ANTHROPIC_API_KEY: apiKey, ANTHROPIC_MODEL: model = 'claude-sonnet-5-5' } = process.env;

async function complete(): Promise<Reply | undefined> {
  if (apiKey === undefined) {
    // No model to ask: the call a model would make for this prompt, once.
    const input = { query: 'payments companies in Germany', filters: { employee_count: { gte: 200, lte: 2000 } }, limit: 3 };
    return messages.length > 1 ? undefined : { content: [{ type: 'tool_use', id: 'toolu_1', name: 'sprouts_search', input }], stop_reason: 'tool_use' };
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 2048, messages, tools: tools.anthropic() }),
  });
  if (!response.ok) throw new Error(`Messages ${String(response.status)}: ${await response.text()}`);
  return (await response.json()) as Reply;
}

for (let turn = 0; turn < 8; turn += 1) {
  const reply = await complete();
  if (reply === undefined) break;
  messages.push({ role: 'assistant', content: reply.content });
  if (reply.stop_reason !== 'tool_use') {
    console.log(reply.content.map((block) => block.text ?? '').join(''));
    break;
  }
  const results = await tools.handleAnthropicToolUse(reply);
  for (const result of results) console.log(JSON.stringify(result).slice(0, 300));
  messages.push({ role: 'user', content: results });
}

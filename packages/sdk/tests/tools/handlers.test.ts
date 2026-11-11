/** Answering a model's tool calls: every call in a message, in the shape its API expects. */

import { describe, expect, it } from 'vitest';

import { toJson, type ToolError } from '../../src/tools/index.js';
import { companyRow, searchOk, toolset } from './support.js';

const acme = () => searchOk([companyRow({ account_name: 'Acme' })], { total: 1 });
const chatCall = (id: string, name: string, args: string) => ({ id, type: 'function', function: { name, arguments: args } });
interface Payload {
  readonly results: readonly Readonly<Record<string, unknown>>[];
  readonly total: number;
  readonly error: ToolError['error'];
}
const parse = (text: string): Payload => JSON.parse(text) as Payload;

describe('handleOpenAIToolCalls', () => {
  it('answers every call in order, in canonical JSON', async () => {
    const { tools, sent } = toolset([acme()]);
    const answers = await tools.handleOpenAIToolCalls({
      role: 'assistant',
      tool_calls: [
        chatCall('c1', 'sprouts_search', '{"query":"acme"}'),
        chatCall('c2', 'sprouts_search', '{"limit":"many"}'),
        chatCall('c3', 'sprouts_weather', '{}'),
        chatCall('c4', 'sprouts_search', '{not json'),
      ],
    });
    expect(answers.map((a) => ('tool_call_id' in a ? a.tool_call_id : ''))).toEqual(['c1', 'c2', 'c3', 'c4']);
    const payloads = answers.map((a) => parse('content' in a ? a.content : ''));
    expect(payloads[0]?.results[0]?.['account_name']).toBe('Acme');
    expect(payloads[1]?.error.field_errors).toEqual(['limit: expected integer.']);
    expect(payloads[2]?.error.code).toBe('unknown_tool');
    expect(payloads[3]?.error.message).toBe('Arguments are not valid JSON. Send a JSON object.');
    expect(sent).toHaveLength(1);
    for (const answer of answers) if ('content' in answer) expect(answer.content).toBe(toJson(parse(answer.content)));
  });

  it('takes a bare list of calls, skipping what is not one', async () => {
    const { tools } = toolset([acme()]);
    const answers = await tools.handleOpenAIToolCalls([chatCall('c1', 'nope', '{}'), 'not a call']);
    expect(answers).toHaveLength(1);
  });

  it('takes a message without calls', async () => {
    const { tools } = toolset([acme()]);
    expect(await tools.handleOpenAIToolCalls({ role: 'assistant', tool_calls: null })).toEqual([]);
    expect(await tools.handleOpenAIToolCalls({ output: null })).toEqual([]);
  });

  it('reads a Responses API response', async () => {
    const { tools } = toolset([acme()]);
    const answers = await tools.handleOpenAIToolCalls({
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [] },
        { type: 'function_call', call_id: 'call_9', name: 'sprouts_search', arguments: '{"query":"acme"}' },
        { type: 'message', role: 'assistant', content: [] },
      ],
    });
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ type: 'function_call_output', call_id: 'call_9' });
    const [output] = answers;
    expect(parse(output !== undefined && 'output' in output ? output.output : '').total).toBe(1);
  });

  it('reads a single call, and hands on arguments of any kind for the parser to judge', async () => {
    const { tools } = toolset([acme()]);
    const [answer] = await tools.handleOpenAIToolCalls({ id: 'c1', type: 'function', function: { name: 'sprouts_search', arguments: 42 } });
    expect(parse(answer !== undefined && 'content' in answer ? answer.content : '').error.message).toBe('Arguments must be a JSON object.');
  });

  it('refuses what is not a message', async () => {
    const { tools } = toolset([acme()]);
    await expect(tools.handleOpenAIToolCalls(42)).rejects.toThrow(/OpenAI assistant message/);
  });
});

describe('handleAnthropicToolUse', () => {
  it('answers every block, marking the failures', async () => {
    const { tools } = toolset([acme()]);
    const blocks = await tools.handleAnthropicToolUse({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', id: 'tu_1', name: 'sprouts_search', input: { query: 'acme' } },
        { type: 'tool_use', id: 'tu_2', name: 'sprouts_unknown', input: {} },
      ],
    });
    expect(blocks.map((b) => b.tool_use_id)).toEqual(['tu_1', 'tu_2']);
    expect(blocks[0]).not.toHaveProperty('is_error');
    expect(blocks[1]?.is_error).toBe(true);
    expect(parse(blocks[1]?.content ?? '').error.code).toBe('unknown_tool');
  });

  it('takes a list of blocks, and a message whose content is text', async () => {
    const { tools } = toolset([acme()]);
    const [answer] = await tools.handleAnthropicToolUse([{ type: 'tool_use', id: 'tu_1', name: 'nope', input: {} }]);
    expect(answer?.tool_use_id).toBe('tu_1');
    expect(await tools.handleAnthropicToolUse({ content: 'text only' })).toEqual([]);
  });

  it('refuses what is not a message', async () => {
    const { tools } = toolset([acme()]);
    await expect(tools.handleAnthropicToolUse('hello')).rejects.toThrow(/Anthropic message/);
  });
});

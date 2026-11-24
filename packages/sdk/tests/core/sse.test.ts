import { describe, expect, it } from 'vitest';

import { APIConnectionError, APITimeoutError, APIUserAbortError } from '../../src/core/errors.js';
import { readEvents, SSEDecoder, type ServerSentEvent } from '../../src/core/sse.js';

function bytes(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function all(stream: AsyncIterable<ServerSentEvent>): Promise<ServerSentEvent[]> {
  const out: ServerSentEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

describe('the event decoder', () => {
  it('joins a frame split across chunks and line endings', () => {
    const decoder = new SSEDecoder();
    const events = [...decoder.feed('id: 1\r'), ...decoder.feed('\nevent: run.progress\ndata: {"a"'), ...decoder.feed(': 1}\n\n')];
    expect(events).toEqual([{ id: '1', event: 'run.progress', data: { a: 1 }, raw: '{"a": 1}' }]);
  });

  it('skips comments, joins data lines and keeps the id', () => {
    const decoder = new SSEDecoder();
    const events = decoder.feed(': ping\nid: 7\ndata: line one\ndata:line two\n\ndata: [1, 2]\n\nevent:\ndata: x\n\n');
    expect(events.map((e) => [e.id, e.raw, e.data, e.event])).toEqual([
      ['7', 'line one\nline two', {}, null],
      ['7', '[1, 2]', { value: [1, 2] }, null],
      ['7', 'x', {}, null],
    ]);
  });

  it('ignores an id with NUL, unknown fields and empty frames', () => {
    expect(new SSEDecoder().feed('id: bad\0id\nretry: 10\nnovalue\n\n\ndata: x\n\n').map((e) => e.id)).toEqual([null]);
  });

  it('holds back a lone CR until the stream ends, and drops a half frame', () => {
    const decoder = new SSEDecoder();
    expect(decoder.feed('data: done\n\r')).toEqual([]);
    expect(decoder.close().map((e) => e.raw)).toEqual(['done']);
    decoder.feed('data: half');
    expect(decoder.close()).toEqual([]);
  });
});

describe('reading a stream', () => {
  it('yields the events, including one the end of the stream completes', async () => {
    const events = await all(readEvents(bytes('id: 1\ndata: {"n":1}\n\n', 'data: {"n":2}\n\r'), { idleTimeoutMs: 1_000 }));
    expect(events.map((e) => e.data)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('times out a silent stream, carrying the last event id', async () => {
    const silent = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('id: 5\ndata: {}\n\n'));
      },
    });
    const error = await all(readEvents(silent, { idleTimeoutMs: 10 })).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(APITimeoutError);
    expect((error as APITimeoutError).lastEventId).toBe('5');
    const quiet = await all(readEvents(new ReadableStream<Uint8Array>(), { idleTimeoutMs: 10 })).catch((err: unknown) => err);
    expect((quiet as APITimeoutError).lastEventId).toBeUndefined();
  });

  it('reports a broken stream, and the caller\'s abort', async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('reset'));
      },
    });
    await expect(all(readEvents(broken, { idleTimeoutMs: 1_000 }))).rejects.toBeInstanceOf(APIConnectionError);
    const brokenAfter = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('id: 3\ndata: {}\n\n'));
      },
      pull(controller) {
        controller.error(new Error('reset'));
      },
    });
    const error = await all(readEvents(brokenAfter, { idleTimeoutMs: 1_000 })).catch((err: unknown) => err);
    expect((error as APIConnectionError).lastEventId).toBe('3');
    const controller = new AbortController();
    controller.abort();
    await expect(all(readEvents(bytes('data: x\n\n'), { idleTimeoutMs: 1_000, signal: controller.signal }))).rejects.toBeInstanceOf(APIUserAbortError);
    const during = new AbortController();
    const hanging = new ReadableStream<Uint8Array>({
      pull(stream) {
        during.abort();
        stream.error(new Error('aborted'));
      },
    });
    await expect(all(readEvents(hanging, { idleTimeoutMs: 1_000, signal: during.signal }))).rejects.toBeInstanceOf(APIUserAbortError);
  });
});

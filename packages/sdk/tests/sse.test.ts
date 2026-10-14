import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  APITimeoutError,
  APIUserAbortError,
  SproutsData,
  NotFoundError,
  parseSseStream,
  type AgentRunEvent,
  type SseMessage,
} from '../src/index';
import { TEST_KEY, fetchQueue, problemResponse, sseResponse } from './helpers';

function makeClient(fetchImpl: typeof globalThis.fetch, maxRetries = 0, timeoutMs?: number) {
  return new SproutsData({
    apiKey: TEST_KEY,
    baseUrl: 'https://dsp.example.test/backend',
    fetch: fetchImpl,
    maxRetries,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

async function collect<T>(stream: AsyncGenerator<T, void, undefined>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of stream) out.push(item);
  return out;
}

describe('parseSseStream', () => {
  it('parses a simple frame', async () => {
    const { body } = sseResponse('id: 1\nevent: run.started\ndata: {}\n\n');
    const messages = await collect(parseSseStream(body!));
    expect(messages).toEqual<SseMessage[]>([{ id: '1', event: 'run.started', data: '{}' }]);
  });

  it('reassembles frames split across chunk boundaries', async () => {
    const { body } = sseResponse('id: 2\nev', 'ent: plan\ndata: {"steps"', ': 3}\n', '\n');
    const messages = await collect(parseSseStream(body!));
    expect(messages).toEqual([{ id: '2', event: 'plan', data: '{"steps": 3}' }]);
  });

  it('joins multi-line data with newlines', async () => {
    const { body } = sseResponse('data: line one\ndata: line two\n\n');
    const messages = await collect(parseSseStream(body!));
    expect(messages).toEqual([{ id: null, event: 'message', data: 'line one\nline two' }]);
  });

  it('skips heartbeat comments and dispatches nothing for dataless frames', async () => {
    const { body } = sseResponse(': ping\n\n', 'id: 5\n\n', 'event: run.done\ndata: {}\n\n');
    const messages = await collect(parseSseStream(body!));
    // The id-only frame dispatches nothing but its id sticks to the next frame.
    expect(messages).toEqual([{ id: '5', event: 'run.done', data: '{}' }]);
  });

  it('handles CRLF line endings', async () => {
    const { body } = sseResponse('id: 9\r\nevent: answer\r\ndata: {"ok":true}\r\n\r\n');
    const messages = await collect(parseSseStream(body!));
    expect(messages).toEqual([{ id: '9', event: 'answer', data: '{"ok":true}' }]);
  });

  it('defaults a missing event name to "message" and drops a trailing partial frame', async () => {
    const { body } = sseResponse('data: hello\n\n', 'event: run.done\ndata: {"tr');
    const messages = await collect(parseSseStream(body!));
    expect(messages).toEqual([{ id: null, event: 'message', data: 'hello' }]);
  });
});

describe('runs.events', () => {
  it('streams typed events with numeric seq and forwards Last-Event-ID', async () => {
    const fetchMock = fetchQueue(
      sseResponse(
        'id: 7\nevent: coverage\ndata: {"universe": 12}\n\n',
        ': ping\n\n',
        'id: 8\nevent: run.done\ndata: {"status": "completed"}\n\n',
      ),
    );
    const client = makeClient(fetchMock);

    const events = await collect(client.runs.events('run_1', { lastEventId: '6' }));

    expect(events).toEqual<AgentRunEvent[]>([
      { seq: 7, type: 'coverage', data: { universe: 12 }, raw: '{"universe": 12}' },
      { seq: 8, type: 'run.done', data: { status: 'completed' }, raw: '{"status": "completed"}' },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://dsp.example.test/backend/v1/agents/runs/run_1/events');
    const headers = init!.headers as Record<string, string>;
    expect(headers['Accept']).toBe('text/event-stream');
    expect(headers['Last-Event-ID']).toBe('6');
    expect(headers['X-API-Key']).toBe(TEST_KEY);
  });

  it('keeps non-JSON data in raw with an empty data object', async () => {
    const fetchMock = fetchQueue(sseResponse('event: budget\ndata: not json\n\n'));
    const client = makeClient(fetchMock);
    const events = await collect(client.runs.events('run_1'));
    expect(events).toEqual([{ seq: null, type: 'budget', data: {}, raw: 'not json' }]);
  });

  it('an error before the stream throws the typed error, yielding nothing', async () => {
    const fetchMock = fetchQueue(problemResponse(404, { title: 'No such run' }));
    const client = makeClient(fetchMock);
    await expect(collect(client.runs.events('run_x'))).rejects.toThrow(NotFoundError);
  });

  it('retries a retryable status before the stream opens', async () => {
    const fetchMock = fetchQueue(
      new Response(JSON.stringify({ status: 503 }), {
        status: 503,
        headers: { 'content-type': 'application/problem+json', 'retry-after': '0' },
      }),
      sseResponse('id: 1\nevent: run.done\ndata: {}\n\n'),
    );
    const client = makeClient(fetchMock, 1);
    const events = await collect(client.runs.events('run_1'));
    expect(events).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborting mid-stream throws APIUserAbortError', async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    // A body that emits one frame and then stays open until cancelled.
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encoder.encode('id: 1\nevent: plan\ndata: {}\n\n'));
      },
    });
    const fetchMock = fetchQueue(
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    const client = makeClient(fetchMock);

    const seen: AgentRunEvent[] = [];
    const consume = (async () => {
      for await (const event of client.runs.events('run_1', {}, { signal: controller.signal })) {
        seen.push(event);
        controller.abort();
      }
    })();

    await expect(consume).rejects.toThrow(APIUserAbortError);
    expect(seen).toHaveLength(1);
  });

  it('the connection timeout does not fire after headers arrive', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        // Heartbeat immediately; the real event lands after the 20ms client
        // timeout would have fired, then the stream closes.
        streamController.enqueue(encoder.encode(': ping\n\n'));
        setTimeout(() => {
          streamController.enqueue(encoder.encode('id: 1\nevent: run.done\ndata: {}\n\n'));
          streamController.close();
        }, 60);
      },
    });
    const fetchMock = fetchQueue(
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    const client = makeClient(fetchMock, 0, 20);
    const events = await collect(client.runs.events('run_1'));
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('run.done');
  });

  describe('idle timeout', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** A body that sends `frames` and then goes silent without closing. */
    function silentAfter(...frames: string[]): Response {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          for (const frame of frames) streamController.enqueue(encoder.encode(frame));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }

    it('throws APITimeoutError carrying the last event id after 60 s of silence', async () => {
      vi.useFakeTimers();
      const client = makeClient(fetchQueue(silentAfter('id: 7\nevent: plan\ndata: {}\n\n')));
      const seen: AgentRunEvent[] = [];
      const consume = (async () => {
        for await (const event of client.runs.events('run_1')) seen.push(event);
      })().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(seen).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      const failure = (await consume) as APITimeoutError;
      expect(failure).toBeInstanceOf(APITimeoutError);
      expect(failure.lastEventId).toBe('7');
      expect(failure.timeoutMs).toBe(60_000);
    });

    it('heartbeats keep the stream alive', async () => {
      vi.useFakeTimers();
      const encoder = new TextEncoder();
      let push: ((chunk: string) => void) | undefined;
      let close: (() => void) | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          push = (chunk) => streamController.enqueue(encoder.encode(chunk));
          close = () => streamController.close();
        },
      });
      const client = makeClient(
        fetchQueue(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })),
      );
      const events = collect(client.runs.events('run_1'));
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(15_000);
        push!(': ping\n\n');
      }
      push!('id: 1\nevent: run.done\ndata: {}\n\n');
      close!();
      await expect(events).resolves.toHaveLength(1);
    });
  });

  it('lets go of the caller signal once the stream ends', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const client = makeClient(fetchQueue(sseResponse('id: 1\nevent: run.done\ndata: {}\n\n')));
    await collect(client.runs.events('run_1', {}, { signal: controller.signal }));
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('parseSseStream idle timeout', () => {
  it('cancels the stream and reports the last id seen', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode('id: 3\ndata: x\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const seen: SseMessage[] = [];
    const failure = await (async () => {
      for await (const message of parseSseStream(body, { idleTimeoutMs: 10 })) seen.push(message);
    })().catch((e: unknown) => e);
    expect(seen).toHaveLength(1);
    expect(failure).toBeInstanceOf(APITimeoutError);
    expect((failure as APITimeoutError).lastEventId).toBe('3');
    expect(cancelled).toBe(true);
  });
});

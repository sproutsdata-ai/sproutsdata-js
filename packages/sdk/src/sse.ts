/**
 * A minimal server-sent-events parser over a fetch body stream.
 *
 * Domain-free on purpose: this module knows the SSE wire format and nothing
 * about agent runs. Frames are parsed per the SSE spec — `id:` / `event:` /
 * `data:` fields, `:` comment lines (which silently absorb the server's
 * periodic `: ping` heartbeat), multi-line `data:` joined with `\n`, and no
 * dispatch for frames that carry no data.
 */

import { APIConnectionError, APITimeoutError, APIUserAbortError } from './errors';

/** One dispatched SSE frame. */
export interface SseMessage {
  /**
   * The last seen `id:` — the stream's durable sequence. Sticky across
   * frames per the SSE spec, so reconnect logic can resume from it.
   */
  id: string | null;
  /** The frame's `event:` name; `message` when the frame carried none. */
  event: string;
  /** The frame's `data:` line(s), joined with `\n`. */
  data: string;
}

const FRAME_DELIMITER = /\r\n\r\n|\n\n|\r\r/;
const LINE_DELIMITER = /\r\n|\n|\r/;

function parseFrame(frame: string, lastId: string | null): SseMessage {
  let id = lastId;
  let event = '';
  const data: string[] = [];

  for (const line of frame.split(LINE_DELIMITER)) {
    if (line === '' || line.startsWith(':')) continue; // blank or comment (heartbeat)
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'id') {
      // Per spec an id containing NUL is ignored.
      if (!value.includes('\0')) id = value;
    } else if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      data.push(value);
    }
    // Unknown fields (incl. `retry`) are ignored — reconnect policy is the
    // caller's, not this parser's.
  }

  // Per spec: a frame with an empty data buffer dispatches nothing (but a
  // seen id still sticks) — this is what keeps heartbeats invisible.
  if (data.length === 0) return { id, event: '', data: '' };
  return { id, event: event === '' ? 'message' : event, data: data.join('\n') };
}

/** Options for {@link parseSseStream}. */
export interface ParseSseOptions {
  /** Aborting it mid-stream throws {@link APIUserAbortError}. */
  signal?: AbortSignal;
  /**
   * Longest wait for the next chunk, in milliseconds. When it passes, the
   * stream is cancelled and {@link APITimeoutError} is thrown carrying the
   * last event id, so the caller can resume. Unset: wait indefinitely.
   */
  idleTimeoutMs?: number;
}

/** One `reader.read()` outcome. */
type ReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>;

/** Why a read gave up waiting. A sentinel, never surfaced. */
const IDLE = Symbol('idle');

/** The next chunk, or {@link IDLE} when none arrives within `ms`. */
async function readWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number | undefined,
): Promise<ReadResult | typeof IDLE> {
  const pending = reader.read();
  if (ms === undefined) return pending;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<typeof IDLE>((resolve) => {
    timer = setTimeout(() => resolve(IDLE), ms);
  });
  try {
    const result = await Promise.race([pending, idle]);
    // The losing read settles when the stream is cancelled; nothing awaits it.
    if (result === IDLE) pending.catch(() => undefined);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse an SSE byte stream into dispatched messages.
 *
 * Ends when the stream ends; a trailing partial frame is dropped (a
 * conforming server never delivers one). Aborting `signal` mid-stream throws
 * {@link APIUserAbortError}; silence longer than `idleTimeoutMs` throws
 * {@link APITimeoutError}; any other mid-stream read failure throws
 * {@link APIConnectionError}.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  options: ParseSseOptions = {},
): AsyncGenerator<SseMessage, void, undefined> {
  const { signal, idleTimeoutMs } = options;
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let buffer = '';
  let lastId: string | null = null;

  try {
    for (;;) {
      if (signal?.aborted) throw new APIUserAbortError();

      let chunk: ReadResult | typeof IDLE;
      try {
        chunk = await readWithin(reader, idleTimeoutMs);
      } catch (err) {
        if (signal?.aborted) throw new APIUserAbortError();
        throw new APIConnectionError('SSE stream failed mid-read', { cause: err });
      }
      if (chunk === IDLE) {
        throw new APITimeoutError(
          `The event stream sent nothing for ${idleTimeoutMs}ms (the server's heartbeat ` +
            'is every 15s). Resume with the last event id.',
          { timeoutMs: idleTimeoutMs ?? 0, lastEventId: lastId ?? undefined },
        );
      }
      if (chunk.done) return;

      buffer += decoder.decode(chunk.value, { stream: true });

      for (;;) {
        const match = FRAME_DELIMITER.exec(buffer);
        if (match === null) break;
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const message = parseFrame(frame, lastId);
        lastId = message.id;
        if (message.data !== '') yield message;
      }
    }
  } finally {
    reader.cancel().catch(() => {
      // Already errored or closed — nothing to release.
    });
  }
}

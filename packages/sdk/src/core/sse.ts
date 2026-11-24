/**
 * Server-sent events, parsed as the WHATWG specification says (the same rules, in the
 * same order, as the Python SDK's decoder).
 *
 * - lines end in LF, CRLF or a lone CR, and a CRLF split across two chunks is one ending;
 * - a line starting with `:` is a comment (the server's `: ping` heartbeat);
 * - several `data:` lines in one frame are joined with a newline;
 * - `id:` is sticky across frames until replaced, and an id containing NUL is ignored;
 * - a frame with no `data` dispatches nothing, and one the stream ended in the middle of is dropped.
 *
 * A `data` payload that is not JSON is kept on `raw` rather than dropped.
 */

import { APIConnectionError, APITimeoutError, APIUserAbortError } from './errors.js';

/** One event: its sticky id, its name, its data as JSON (when it is), and the raw text. */
export interface ServerSentEvent {
  readonly id: string | null;
  readonly event: string | null;
  readonly data: Readonly<Record<string, unknown>>;
  readonly raw: string;
}

const LINE_END = /\r\n|\r|\n/g;

/** Turns chunks of an event stream into events, one frame at a time. */
export class SSEDecoder {
  #pending = '';
  #data: string[] = [];
  #event: string | null = null;
  /** The id the stream last set: what a caller resumes from after it breaks. */
  lastEventId: string | null = null;

  /** The frames `text` completes. */
  feed(text: string): ServerSentEvent[] {
    return this.#consume(text, false);
  }

  /** The frames the end of the stream completes (a frame still open is dropped). */
  close(): ServerSentEvent[] {
    const events = this.#consume('', true);
    this.#pending = '';
    this.#data = [];
    this.#event = null;
    return events;
  }

  #consume(text: string, final: boolean): ServerSentEvent[] {
    this.#pending += text;
    const events: ServerSentEvent[] = [];
    let position = 0;
    for (const match of this.#pending.matchAll(LINE_END)) {
      const end = match.index + match[0].length;
      // Perhaps the first half of a CRLF whose LF is in the next chunk.
      if (!final && match[0] === '\r' && end === this.#pending.length) break;
      const event = this.#line(this.#pending.slice(position, match.index));
      if (event !== undefined) events.push(event);
      position = end;
    }
    this.#pending = this.#pending.slice(position);
    return events;
  }

  #line(line: string): ServerSentEvent | undefined {
    if (line === '') return this.#dispatch();
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const name = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (name === 'data') this.#data.push(value);
    else if (name === 'event') this.#event = value;
    else if (name === 'id' && !value.includes('\0')) this.lastEventId = value;
    // `retry` and unknown fields are ignored: reconnecting is the caller's decision.
    return undefined;
  }

  #dispatch(): ServerSentEvent | undefined {
    const data = this.#data;
    const event = this.#event;
    this.#data = [];
    this.#event = null;
    if (data.length === 0) return undefined;
    const raw = data.join('\n');
    return { id: this.lastEventId, event: event === '' ? null : event, data: parsed(raw), raw };
  }
}

function parsed(raw: string): Readonly<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
  } catch {
    return {};
  }
}

/** Why a read gave up waiting. A sentinel, never surfaced. */
const IDLE = Symbol('idle');

/**
 * The events of a byte stream, as they arrive. Silence longer than `idleTimeoutMs` throws
 * `APITimeoutError`, a broken read `APIConnectionError` (both with the last event id, to
 * resume from), and the caller's abort `APIUserAbortError`.
 */
export async function* readEvents(
  body: ReadableStream<Uint8Array>,
  options: { readonly idleTimeoutMs: number; readonly signal?: AbortSignal | undefined },
): AsyncGenerator<ServerSentEvent, void, undefined> {
  const reader = body.getReader();
  const text = new TextDecoder('utf-8');
  const decoder = new SSEDecoder();
  try {
    for (;;) {
      if (options.signal?.aborted === true) throw new APIUserAbortError();
      const chunk = await readWithin(reader, options.idleTimeoutMs, decoder, options.signal);
      if (chunk.done) {
        yield* decoder.feed(text.decode());
        yield* decoder.close();
        return;
      }
      yield* decoder.feed(text.decode(chunk.value, { stream: true }));
    }
  } finally {
    reader.cancel().catch(() => undefined); // already closed or errored: nothing to release
  }
}

async function readWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
  decoder: SSEDecoder,
  signal: AbortSignal | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  const lastEventId = decoder.lastEventId ?? undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<typeof IDLE>((resolve) => {
    timer = setTimeout(() => {
      resolve(IDLE);
    }, ms);
  });
  try {
    const result = await Promise.race([reader.read(), idle]);
    if (result === IDLE) {
      throw new APITimeoutError(
        `The event stream sent nothing for ${String(ms)}ms (the server's heartbeat is every 15 s). ` +
          'Resume with the last event id.',
        { timeoutMs: ms, ...(lastEventId === undefined ? {} : { lastEventId }) },
      );
    }
    return result;
  } catch (err) {
    if (err instanceof APITimeoutError) throw err;
    if (signal?.aborted === true) throw new APIUserAbortError();
    throw new APIConnectionError('The event stream broke off.', { cause: err, ...(lastEventId === undefined ? {} : { lastEventId }) });
  } finally {
    clearTimeout(timer);
  }
}

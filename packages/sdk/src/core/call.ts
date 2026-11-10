/**
 * The typed way in: call an operation by its SDK name, with its path parameters, query
 * and body typed from the spec, and get back its typed answer.
 *
 * Everything about the operation (method, path, route class, response kind) comes from the
 * generated table, so no resource spells any of it. This is the one place a response body
 * is given its type, after checking it is the JSON object the operation answers with.
 */

import { OPERATIONS, type OperationMap, type OperationName } from '../generated/operations.js';
import type { Answer, AnswerMeta } from './answer.js';
import { APIResponseValidationError, isRecord } from './errors.js';
import type { ServerSentEvent } from './sse.js';
import type { Operation, RequestOptions, Transport } from './transport.js';

type Responses<K extends OperationName> = OperationMap[K]['responses'];

/** The JSON body types an operation can answer with. */
export type JsonBody<K extends OperationName> = Exclude<
  Responses<K>[keyof Responses<K>],
  'text/csv' | 'text/event-stream' | undefined
>;

/** What a call to operation `K` sends. */
export interface Input<K extends OperationName> {
  readonly path?: OperationMap[K]['path'];
  readonly query?: OperationMap[K]['query'];
  readonly body?: OperationMap[K]['body'];
}

/** A typed JSON answer and what came with it. */
export interface Typed<K extends OperationName> {
  readonly body: JsonBody<K>;
  readonly meta: AnswerMeta;
}

/** Operation `K` as the transport takes it. */
export function operation(name: OperationName): Operation {
  return { ...OPERATIONS[name], name };
}

/** Call an operation that answers with JSON, and get its typed body. */
export async function callJson<K extends OperationName>(
  transport: Transport,
  name: K,
  input: Input<K> = {},
  options?: RequestOptions,
): Promise<Typed<K>> {
  const answer = await transport.send(operation(name), input, options);
  if (answer.kind !== 'json' || !isRecord(answer.json)) {
    throw new APIResponseValidationError(`${name} answered without the JSON object it answers with.`, {
      status: answer.meta.status,
      requestId: answer.meta.requestId,
    });
  }
  // The operation's response schema is what the server serialises for this route; the
  // contract tests validate recorded answers against it.
  return { body: answer.json as JsonBody<K>, meta: answer.meta };
}

/** Call an operation whose answer may not be JSON (a CSV file or an export job, or nothing). */
export function callAnswer<K extends OperationName>(
  transport: Transport,
  name: K,
  input: Input<K> = {},
  options?: RequestOptions,
): Promise<Answer> {
  return transport.send(operation(name), input, options);
}

/** Follow an operation's server-sent event stream. */
export function callStream<K extends OperationName>(
  transport: Transport,
  name: K,
  input: Input<K> = {},
  options?: RequestOptions,
): AsyncGenerator<ServerSentEvent, void, undefined> {
  return transport.stream(operation(name), input, options);
}

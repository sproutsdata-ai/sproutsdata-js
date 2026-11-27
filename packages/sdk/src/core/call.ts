/**
 * The typed way in: call an operation by its SDK name, with its path parameters, query
 * and body typed from the spec, and get back its typed answer.
 *
 * Everything about the operation (method, path, route class, response kind) comes from the
 * generated table, so no resource spells any of it. This is the one place a response body
 * is given its type, after checking it is the JSON object the operation answers with.
 */

import { DEFAULTS } from '../generated/defaults.js';
import { OPERATIONS, type OperationMap, type OperationName, type OperationSpec } from '../generated/operations.js';
import type { ExportJobView } from '../generated/wire.js';
import type { ExportFile, ExportResult } from '../types/index.js';
import type { Answer, AnswerMeta } from './answer.js';
import { APIResponseValidationError, isRecord } from './errors.js';
import { follow, start, type PageInput } from './pagination.js';
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

/**
 * Every page of a paged operation, from `first`, each as it arrives. Each page resends the
 * first page's request with the next cursor (or page number), as the server requires. A
 * caller's request id goes on the first page only: each page is its own request.
 */
export async function* callPages<K extends OperationName>(
  transport: Transport,
  name: K,
  first: PageInput & { readonly path?: OperationMap[K]['path'] },
  options: RequestOptions = {},
  maxResults?: number,
): AsyncGenerator<Typed<K>, void, undefined> {
  const spec: OperationSpec = OPERATIONS[name];
  const paging = spec.paging;
  if (paging === undefined) throw new TypeError(`${name} does not page`);
  let pager = start(paging, first, maxResults);
  let call = options;
  for (;;) {
    const { body, query } = pager.sent;
    const page = await callJson(transport, name, { path: first.path, body, query } as Input<K>, call);
    yield page;
    const next = follow(pager, page.body, maxResults);
    if (next === undefined) return;
    pager = next;
    call = laterPage(options);
  }
}

/**
 * A later page's options: the caller's, without the first page's request id and idempotency key.
 * Each page is its own call, so it gets its own key (one shared would make a later page read as a
 * repeat of the first), and sharing one id would merge the pages in the server's logs.
 */
function laterPage(options: RequestOptions): RequestOptions {
  const { requestId: _firstId, idempotencyKey: _firstKey, ...rest } = options;
  return rest;
}

/** Call an export: the CSV when the server answers with it (200), else the job it started (202). */
export async function callExport<K extends OperationName>(transport: Transport, name: K, input: Input<K>, options?: RequestOptions): Promise<ExportResult> {
  const answer = await transport.send(operation(name), input, options);
  if (answer.kind === 'csv') return exportFile(answer.text, answer.meta.headers);
  if (answer.kind === 'json' && isRecord(answer.json)) return { kind: 'job', job: answer.json as unknown as ExportJobView };
  throw new APIResponseValidationError(`${name} answered with neither a CSV file nor an export job.`, { status: answer.meta.status, requestId: answer.meta.requestId });
}

/** A plain decimal, as the API writes a charge (`2`, `2.5`, `1e+06`); both SDKs read the same header the same way. */
const DECIMAL = /^[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const COUNT = /^[0-9]+$/;

/**
 * A CSV answered at once, with what its headers say about it. A header that is missing or unreadable reads as
 * unknown (`undefined`), never as an error: the file is made, and charged, by the time it arrives.
 */
export function exportFile(csv: string, headers: Readonly<Record<string, string>>): ExportFile {
  const names = DEFAULTS.exportHeaders;
  const charged = headers[names.creditsCharged]?.trim() ?? '';
  const tier = headers[names.fieldTier]?.trim() ?? '';
  return {
    kind: 'file',
    csv,
    creditsCharged: DECIMAL.test(charged) ? Number(charged) : undefined,
    fieldTier: tier === '' ? undefined : tier,
    rows: count(headers[names.rows]),
    skipped: count(headers[names.skipped]),
  };
}

function count(raw: string | undefined): number | undefined {
  const text = raw?.trim() ?? '';
  return COUNT.test(text) ? Number(text) : undefined;
}

/** Call an operation that answers with a CSV file, and get its text. */
export async function callCsv<K extends OperationName>(transport: Transport, name: K, input: Input<K>, options?: RequestOptions): Promise<string> {
  const answer = await transport.send(operation(name), input, options);
  if (answer.kind !== 'csv') throw new APIResponseValidationError(`${name} answered without a CSV file.`, { status: answer.meta.status, requestId: answer.meta.requestId });
  return answer.text;
}

/**
 * A toolset over a recording `fetch`, and answers in the shapes the API really sends: every
 * success body starts from an answer the real backend gave and is served through `respond`.
 */

import { SproutsData } from '../../src/index.js';
import { Toolset, type ToolsetOptions } from '../../src/tools/index.js';
import { recordedBody, respond } from '../support/answers.js';
import { BASE_URL, recordingFetch, type Scripted, type Sent, TEST_KEY } from '../support/fakes.js';

type Json = Record<string, unknown>;

/** A client with retries off, over `script`. */
export function client(script: readonly Scripted[]): { client: SproutsData; sent: Sent[] } {
  const { fetch, sent } = recordingFetch(script);
  return { client: new SproutsData({ apiKey: TEST_KEY, baseUrl: BASE_URL, maxRetries: 0, fetch }), sent };
}

/** A `Toolset` with `options`, over `script`. */
export function toolset(script: readonly Scripted[], options: ToolsetOptions = {}): { tools: Toolset; sent: Sent[] } {
  const made = client(script);
  return { tools: new Toolset(made.client, options), sent: made.sent };
}

function page(operation: string, which: string, results: readonly unknown[] | undefined, changes: Json): Scripted {
  const body = recordedBody(operation, which);
  if (results !== undefined) Object.assign(body, { results, has_more: false, next_cursor: null });
  return respond(operation, 200, { ...body, ...changes });
}

/** A company search page: the recorded one, its rows or fields replaced. */
export const searchOk = (results?: readonly unknown[], changes: Json = {}): Scripted => page('search', 'company', results, changes);
/** A look-alike page: the recorded one, its rows or fields replaced. */
export const similarOk = (results?: readonly unknown[], changes: Json = {}): Scripted => page('similar', 'company', results, changes);
/** A company lookup answer: the recorded one, its hits or fields replaced. */
export const lookupOk = (results?: readonly unknown[], changes: Json = {}): Scripted => page('entities_companies', 'by_domain', results, changes);

/** The recorded search's first company row, fields replaced (`undefined` removes one). */
export function companyRow(fields: Json = {}): Json {
  const rows = recordedBody<{ results: Json[] }>('search', 'company').results;
  const row: Json = { ...rows[0] };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) Reflect.deleteProperty(row, key);
    else row[key] = value;
  }
  return row;
}

/** A scripted problem-document answer. */
export function problem(code: string, status: number, extra: Json = {}, headers: Readonly<Record<string, string>> = {}): Scripted {
  return respond('search', status, { type: 'about:blank', title: code, status, code, ...extra }, headers);
}

/**
 * Serving a feature test's answers: only bodies the API's own schema allows.
 *
 * `respond` is the only way a feature test serves a body: it validates the body against the
 * operation's response schema in `spec/openapi.json` (ajv, JSON Schema 2020-12) first, so a test
 * cannot pass against a shape the server never sends. `recorded` serves an answer the real
 * backend gave, and `assertValidRequest` holds a body the SDK built to the request schema.
 */

import { readFileSync } from 'node:fs';

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import type { Scripted } from './fakes.js';

const SPEC = new URL('../../../../spec/', import.meta.url).pathname;
const FIXTURES = `${SPEC}fixtures/responses/`;

interface Route {
  readonly name: string;
  readonly method: string;
  readonly path: string;
}

type Json = Readonly<Record<string, unknown>>;

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const openapi = read(`${SPEC}openapi.json`) as { readonly paths: Readonly<Record<string, Readonly<Record<string, Json>>>>; readonly components: Json };
const routes = (read(`${SPEC}routes.json`) as { readonly routes: readonly Route[] }).routes;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const cache = new Map<string, ValidateFunction>();

function operation(name: string): Json {
  const route = routes.find((r) => r.name === name);
  if (route === undefined) throw new Error(`no route named ${name}`);
  const op = openapi.paths[route.path]?.[route.method.toLowerCase()];
  if (op === undefined) throw new Error(`no operation for ${name}`);
  return op;
}

function check(key: string, schema: Json, body: unknown, what: string): void {
  let validate = cache.get(key);
  if (validate === undefined) {
    // Each `$ref` is `#/components/schemas/...`: resolved against a root that carries them.
    validate = ajv.compile({ ...schema, components: openapi.components });
    cache.set(key, validate);
  }
  if (!validate(body)) {
    const detail = (validate.errors ?? []).slice(0, 5).map((e) => `${e.instancePath} ${e.message ?? ''}`).join('; ');
    throw new Error(`${what} does not match spec/openapi.json: ${detail}`);
  }
}

const schemaOf = (content: unknown): Json => ((content as { 'application/json': { schema: Json } })['application/json']).schema;

/** A scripted answer valid against the operation's schema (an error: a problem document). */
export function respond(name: string, status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): Scripted {
  if (status >= 200 && status < 300) {
    const responses = operation(name)['responses'] as Readonly<Record<string, { readonly content: unknown }>>;
    const content = responses[String(status)]?.content;
    if (content === undefined) throw new Error(`${name} does not answer ${String(status)}`);
    check(`${name}:${String(status)}`, schemaOf(content), body, `${name} ${String(status)}`);
  } else {
    const problem = body as Json;
    if (!['code', 'status', 'title'].every((key) => key in problem)) throw new Error(`${name} ${String(status)}: not a problem document`);
  }
  return { status, headers, body };
}

interface Fixture {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** The body of the answer the real backend gave (to change in a test, then serve with `respond`). */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the body's type, as a recorded fixture is untyped JSON
export function recordedBody<T = Record<string, unknown>>(name: string, which: string): T {
  return structuredClone((read(`${FIXTURES}${name}/${which}.json`) as Fixture).body) as T;
}

/** The answer the real backend gave for `name` (`spec/fixtures/responses/`). */
export function recorded(name: string, which: string): Scripted {
  const fixture = read(`${FIXTURES}${name}/${which}.json`) as Fixture;
  if (fixture.status === 204) return { status: 204, headers: fixture.headers };
  if (typeof fixture.body === 'string') {
    const { 'content-type': contentType, ...headers } = fixture.headers;
    return { status: fixture.status, headers, raw_body: fixture.body, content_type: contentType ?? 'text/plain' };
  }
  return respond(name, fixture.status, fixture.body, fixture.headers);
}

/** The body the SDK sent is one the operation's request schema accepts. */
export function assertValidRequest(name: string, body: unknown): void {
  const requestBody = operation(name)['requestBody'] as { readonly content: unknown } | undefined;
  if (requestBody === undefined) throw new Error(`${name} takes no body`);
  check(`${name}:request`, schemaOf(requestBody.content), body, `${name} request`);
}

/**
 * The core reads every answer the real backend gave (`spec/fixtures/responses/`).
 *
 * sproutsdata-py's `python -m e2e.record` recorded them from the local stack, and its spec
 * gate holds each to the OpenAPI. Here a success decodes as its operation's kind, with its
 * body intact, and an error becomes its concept's class.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readAnswer } from '../../src/core/answer.js';
import { type APIError, ListNameTakenError, OrgChartCompanyAmbiguousError } from '../../src/core/errors.js';
import { errorFromAnswer, decodeErrorBody } from '../../src/core/problem.js';
import { SSEDecoder } from '../../src/core/sse.js';
import { OPERATIONS, type OperationName } from '../../src/generated/operations.js';

const FIXTURES_DIR = new URL('../../../../spec/fixtures/responses/', import.meta.url).pathname;
const NOW = Date.UTC(2026, 10, 11, 12);
const ERROR_CLASSES: Readonly<Record<string, abstract new (...args: never[]) => APIError>> = {
  'lists_create/name_taken': ListNameTakenError,
  'org_chart/ambiguous': OrgChartCompanyAmbiguousError,
};

interface Fixture {
  readonly name: string;
  readonly operation: OperationName;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

const camel = (name: string): string => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

function load(): Fixture[] {
  return readdirSync(FIXTURES_DIR)
    .sort()
    .flatMap((folder) =>
      readdirSync(join(FIXTURES_DIR, folder))
        .sort()
        .map((file) => {
          const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, folder, file), 'utf8')) as Record<string, unknown>;
          return {
            name: `${folder}/${file.replace(/\.json$/, '')}`,
            operation: camel(String(raw['operation'])) as OperationName,
            status: raw['status'] as number,
            headers: raw['headers'] as Record<string, string>,
            body: raw['body'],
          };
        }),
    );
}

const text = (body: unknown): string => {
  if (body === null) return '';
  return typeof body === 'string' ? body : JSON.stringify(body);
};

const RECORDED = load();
const SUCCESSES = RECORDED.filter((f) => f.status < 400 && OPERATIONS[f.operation].response !== 'sse');

describe('every recorded answer', () => {
  it('names an operation', () => {
    for (const fixture of RECORDED) expect(OPERATIONS[fixture.operation], fixture.name).toBeDefined();
  });

  it.each(SUCCESSES.map((f) => [f.name, f] as const))('%s reads as its operation says', (_name, fixture) => {
    const answer = readAnswer(fixture.name, OPERATIONS[fixture.operation].response, fixture.status, fixture.headers, text(fixture.body));

    expect(answer.meta.requestId).toBe(fixture.headers['x-request-id']);
    if (fixture.headers['content-type']?.startsWith('text/csv')) {
      expect(answer).toMatchObject({ kind: 'csv', text: String(fixture.body).replace(/^\uFEFF/, '') });
    } else if (fixture.status === 204) {
      expect(answer.kind).toBe('empty');
    } else {
      expect(answer).toMatchObject({ kind: 'json', json: fixture.body });
    }
  });

  it('decodes the run event stream as named events with ids', () => {
    const streams = RECORDED.filter((f) => OPERATIONS[f.operation].response === 'sse');
    expect(streams).not.toHaveLength(0);
    for (const fixture of streams) {
      const events = new SSEDecoder().feed(String(fixture.body));
      expect(events.length, fixture.name).toBeGreaterThan(0);
      for (const event of events) expect(event.event !== null && event.id !== null, fixture.name).toBe(true);
    }
  });

  it('becomes its concept class when it is an error, and every one has a class here', () => {
    const errors = RECORDED.filter((f) => f.status >= 400);
    expect(errors.map((f) => f.name).sort()).toEqual(Object.keys(ERROR_CLASSES).sort());
    for (const fixture of errors) {
      const error = errorFromAnswer(fixture.status, fixture.headers, decodeErrorBody(text(fixture.body)), NOW);
      const problem = fixture.body as Record<string, unknown>;
      expect(error, fixture.name).toBeInstanceOf(ERROR_CLASSES[fixture.name]);
      expect([error.code, error.requestId]).toEqual([problem['code'], problem['request_id']]);
    }
  });
});

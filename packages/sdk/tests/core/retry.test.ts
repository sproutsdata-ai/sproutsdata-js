import { describe, expect, it } from 'vitest';

import type { RouteClass } from '../../src/generated/operations.js';
import { APIConnectionError, APIError, ClientValidationError, type SproutsDataError } from '../../src/core/errors.js';
import { backoffMs, consequence, decide, outcomeFor, provablyNotSent } from '../../src/core/retry.js';
import { networkError } from '../support/fakes.js';

const status = (code: number, retryAfter?: number): APIError => new APIError({ status: code, headers: {}, body: undefined, retryAfter });
const coded = (code: number, problem: string, retryAfter?: number): APIError =>
  new APIError({ status: code, headers: {}, body: { status: code, code: problem }, retryAfter });

describe('retry', () => {
  it.each<[string, SproutsDataError, RouteClass, string]>([
    ['unsent', new APIConnectionError('x', { reachedServer: false }), 'billed', 'retry'],
    ['maybe sent, billed', new APIConnectionError('x'), 'billed', 'raise'],
    ['maybe sent, keyed', new APIConnectionError('x'), 'keyed', 'retry'],
    ['429 within the cap', status(429, 5), 'billed', 'retry'],
    ['429 beyond the cap', status(429, 3600), 'safe', 'raise'],
    ['402', status(402), 'safe', 'raise'],
    ['500 once', status(500), 'once', 'raise'],
    ['500 billed', status(500), 'billed', 'retry'],
    ['503 once', status(503, 30), 'once', 'retry'],
    ['418', status(418), 'safe', 'raise'],
    ['503 service.unavailable, billed', coded(503, 'service.unavailable'), 'billed', 'retry'],
    ['503 credits.refused, billed', coded(503, 'credits.refused'), 'billed', 'raise'],
    ['503 credits.refused, safe', coded(503, 'credits.refused'), 'safe', 'raise'],
    ['429 quota.concurrency_exceeded within the cap, keyed', coded(429, 'quota.concurrency_exceeded', 30), 'keyed', 'raise'],
    ['429 quota.burst_exceeded within the cap, keyed', coded(429, 'quota.burst_exceeded', 5), 'keyed', 'retry'],
    ['410 agents.results_expired', coded(410, 'agents.results_expired'), 'safe', 'raise'],
    ['local', new ClientValidationError('x'), 'safe', 'raise'],
  ])('decides as the policy says: %s', (_, error, routeClass, decision) => {
    expect(decide(error, routeClass)).toBe(decision);
  });

  it('decides a code the policy names by its own row, whatever its status', () => {
    expect(outcomeFor(coded(429, 'quota.concurrency_exceeded'))?.name).toBe('never_retried_code');
    expect(outcomeFor(coded(429, 'quota.something_invented_later'))?.name).toBe('rate_limited');
  });

  it('matches no row for a failure outside the policy', () => {
    expect(outcomeFor(new ClientValidationError('x'))).toBeUndefined();
  });

  it('waits a Retry-After within the cap in full, else jitters', () => {
    expect(backoffMs(1, 30, () => 0.5)).toBe(30_000);
    expect(backoffMs(1, undefined, () => 0.5)).toBe(250);
    expect(backoffMs(5, 3600, () => 1)).toBe(8_000);
  });

  it('notes a consequence only where a repeat would do harm', () => {
    expect(consequence(new APIConnectionError('x'), 'billed')).toMatch(/may have been charged/);
    expect(consequence(new APIConnectionError('x'), 'once')).toMatch(/may already be done/);
    expect(consequence(new APIConnectionError('x'), 'keyed')).toBeUndefined();
    expect(consequence(new APIConnectionError('x', { reachedServer: false }), 'billed')).toBeUndefined();
    expect(consequence(status(500), 'billed')).toBeUndefined();
  });

  it('finds proof a request was never sent anywhere in the cause chain', () => {
    expect(provablyNotSent(networkError('ECONNREFUSED'))).toBe(true);
    expect(provablyNotSent(networkError('ECONNRESET'))).toBe(false);
    expect(provablyNotSent(new AggregateError([networkError('ENOTFOUND'), networkError('EAI_AGAIN')]))).toBe(true);
    expect(provablyNotSent(new AggregateError([networkError('ENOTFOUND'), networkError('ECONNRESET')]))).toBe(false);
    const looped: { cause?: unknown } = {};
    looped.cause = looped;
    expect(provablyNotSent(looped)).toBe(false);
    expect(provablyNotSent('a string')).toBe(false);
  });
});

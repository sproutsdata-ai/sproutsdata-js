import { describe, expect, it } from 'vitest';

import type { RouteClass } from '../../src/generated/operations.js';
import { APIConnectionError, APIError, ClientValidationError, type SproutsDataError } from '../../src/core/errors.js';
import { backoffMs, consequence, decide, outcomeFor, provablyNotSent } from '../../src/core/retry.js';
import { networkError } from '../support/fakes.js';

const status = (code: number, retryAfter?: number): APIError => new APIError({ status: code, headers: {}, body: undefined, retryAfter });

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
    ['local', new ClientValidationError('x'), 'safe', 'raise'],
  ])('decides as the policy says: %s', (_, error, routeClass, decision) => {
    expect(decide(error, routeClass)).toBe(decision);
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

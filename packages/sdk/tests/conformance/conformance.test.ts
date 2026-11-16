/** Every conformance case, on the transport. */

import { describe, expect, it } from 'vitest';

import { check, checkKeys, loadCases, run } from './runner.js';

const CASES = loadCases();

describe('conformance', () => {
  it('found the cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(54);
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s', async (_, test) => {
    checkKeys(test);
    check(test, await run(test));
  });
});

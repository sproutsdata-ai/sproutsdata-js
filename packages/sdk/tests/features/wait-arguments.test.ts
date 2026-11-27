/**
 * Every `wait` refuses a pacing that could never work, before its first poll: a poll interval
 * of zero or less would poll without pause, and a limit that is not a finite number of
 * milliseconds would never be reached.
 */

import { describe, expect, it } from 'vitest';

import { ClientValidationError } from '../../src/core/errors.js';
import { Enrichment } from '../../src/resources/enrichment.js';
import { Exports } from '../../src/resources/exports.js';
import { Runs } from '../../src/resources/runs.js';
import type { WaitOptions } from '../../src/types/index.js';
import { rig } from '../support/rig.js';

const WAITERS = {
  exports: (r: ReturnType<typeof rig>, wait: WaitOptions) => new Exports(r.transport).wait('id-1', wait),
  runs: (r: ReturnType<typeof rig>, wait: WaitOptions) => new Runs(r.transport).wait('id-1', wait),
  enrichment: (r: ReturnType<typeof rig>, wait: WaitOptions) => new Enrichment(r.transport).wait('id-1', wait),
};

const PACINGS: WaitOptions[] = [
  { pollIntervalMs: 0 },
  { pollIntervalMs: -1 },
  { pollIntervalMs: Number.NaN },
  { pollIntervalMs: Number.POSITIVE_INFINITY },
  { maxWaitMs: -1 },
  { maxWaitMs: Number.NaN },
  { maxWaitMs: Number.POSITIVE_INFINITY },
];

describe('wait', () => {
  for (const [name, wait] of Object.entries(WAITERS)) {
    it.each(PACINGS)(`${name}: refuses %o before any poll`, async (pacing) => {
      const r = rig([]);
      await expect(wait(r, pacing)).rejects.toBeInstanceOf(ClientValidationError);
      expect(r.sent).toHaveLength(0);
    });
  }
});

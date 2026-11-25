/**
 * The `sproutsdata` versions this adapter accepts. It imports what only the current core has
 * (`resolveClient`, `isApplicationError`), so its range must take the core in this repository and
 * refuse the published 0.0.1: an adapter that installs beside an older core fails at import, not
 * at `npm install`.
 */

import { readFileSync } from 'node:fs';

import { expect, it } from 'vitest';

interface Manifest {
  readonly version: string;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}

type Version = readonly [number, number, number];

function manifest(path: string): Manifest {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Manifest;
}

function parse(version: string): Version {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (parts === null) throw new Error(`not a plain version: ${version}`);
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Whether `range`, which must be `>=a.b.c <x.y.z` (the only form the adapters use), takes `version`. */
function admits(range: string, version: string): boolean {
  const bounds = /^>=(\S+) <(\S+)$/.exec(range);
  if (bounds?.[1] === undefined || bounds[2] === undefined) throw new Error(`not a >=low <high range: ${range}`);
  const wanted = parse(version);
  return compare(wanted, parse(bounds[1])) >= 0 && compare(wanted, parse(bounds[2])) < 0;
}

const adapter = manifest('../package.json');
const core = manifest('../../sdk/package.json');

it('takes this core, and neither the published 0.0.1 nor the next minor', () => {
  const range = adapter.peerDependencies['sproutsdata'] ?? '';
  const [major, minor] = parse(core.version);
  expect(adapter.devDependencies['sproutsdata']).toBe(range);
  expect(admits(range, core.version)).toBe(true);
  expect(admits(range, '0.0.1')).toBe(false);
  expect(admits(range, `${String(major)}.${String(minor + 1)}.0`)).toBe(false);
});

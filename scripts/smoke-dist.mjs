#!/usr/bin/env node
// Loads the BUILT sdk through both of its published formats, on the Node running this
// script (CI runs it on the 22.12.0 floor and on current releases).
//
// The unit tests import the sources; this proves what `npm install sproutsdata` hands
// a caller: the ESM and CommonJS entry points of both `sproutsdata` and
// `sproutsdata/tools` load, and report the same version as package.json.
//
//   npm run build -w packages/sdk && node scripts/smoke-dist.mjs

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('../packages/sdk/package.json', import.meta.url), 'utf8'));

const entries = {
  'sproutsdata (esm)': () => import('../packages/sdk/dist/index.js'),
  'sproutsdata (cjs)': () => require('../packages/sdk/dist/index.cjs'),
  'sproutsdata/tools (esm)': () => import('../packages/sdk/dist/tools.js'),
  'sproutsdata/tools (cjs)': () => require('../packages/sdk/dist/tools.cjs'),
};

let failed = false;
for (const [name, load] of Object.entries(entries)) {
  try {
    const sdk = await load();
    if (name.startsWith('sproutsdata (') && sdk.VERSION !== manifest.version) {
      throw new Error(`VERSION is ${sdk.VERSION}, package.json says ${manifest.version}`);
    }
    console.log(`ok   ${name} on Node.js ${process.versions.node}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
process.exitCode = failed ? 1 : 0;

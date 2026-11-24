#!/usr/bin/env node
// Runs every example in examples/ against the local stack sproutsdata-py runs (`make e2e-up`
// there), each with the seeded workspace's full-scope key; every one must exit 0.
//
//   npm run e2e:examples            # every example
//   npm run e2e:examples -- NAME... # these (file names in examples/)
//
// Run after `npm run build`: the examples import the built packages.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = join(ROOT, 'examples');
const ENV_FILE = resolve(ROOT, '..', 'sproutsdata-py', 'e2e', '.state', 'env');

function main(argv) {
  if (!existsSync(ENV_FILE)) {
    console.error('no seeded stack: run `make e2e-up` in sproutsdata-py first');
    return 1;
  }
  const stack = Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8')
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  const env = { ...process.env, SPROUTSDATA_API_KEY: stack.SPROUTSDATA_E2E_KEY, SPROUTSDATA_BASE_URL: stack.SPROUTSDATA_E2E_BASE_URL };
  // The provider examples replay a scripted call when no provider key is set.
  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  const names = argv.length > 0 ? argv : readdirSync(EXAMPLES).filter((name) => name.endsWith('.ts')).sort();
  let failed = 0;
  for (const name of names) {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(EXAMPLES, name)], { env, encoding: 'utf8' });
    console.log(`${result.status === 0 ? 'ok  ' : 'FAIL'} ${name}`);
    if (result.status !== 0) {
      failed += 1;
      console.log(`${result.stdout.slice(-2000)}${result.stderr.slice(-2000)}`);
    }
  }
  console.log(`${String(names.length - failed)} of ${String(names.length)} examples ran`);
  return failed > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));

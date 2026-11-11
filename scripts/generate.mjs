#!/usr/bin/env node
// Generates every file under packages/sdk/src/generated/ from the vendored spec.
//
//   node scripts/generate.mjs            # write every file
//   node scripts/generate.mjs --check    # fail if any is out of date
//
// | File | From |
// |---|---|
// | wire.ts | spec/models.json: every request and response type |
// | record-shapes.ts | spec/models.json: how to normalise a raw record |
// | request-shapes.ts | spec/models.json: every request type's fields, limits and closed values |
// | operations.ts | spec/routes.json + spec/models.json: every operation, as data and types |
// | error-codes.ts | spec/error-codes.json |
// | defaults.ts | spec/defaults.json |
// | retry-policy.ts | spec/retry-policy.json |
// | ../tools/specs.gen.ts | spec/tools/: the tool specs, shaping, messages and argument types |
//
// spec/models.json is the model IR sproutsdata-py builds (scripts/gen_ir.py), so both
// SDKs name and shape every type the same way. Nothing here reads JSON at run time.

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderOperations } from './lib/emit-operations.mjs';
import { renderDefaults, renderErrorCodes, renderRetryPolicy } from './lib/emit-tables.mjs';
import { renderToolSpecs } from './lib/emit-tools.mjs';
import { renderRecordShapes, renderRequestShapes, renderWire } from './lib/emit-wire.mjs';
import { writeOrCheck } from './lib/generated.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = join(ROOT, 'spec');
const TARGET = join(ROOT, 'packages', 'sdk', 'src', 'generated');

const spec = (name) => JSON.parse(readFileSync(join(SPEC, name), 'utf8'));

function main(argv) {
  const ir = spec('models.json');
  const files = {
    'wire.ts': renderWire(ir),
    'record-shapes.ts': renderRecordShapes(ir),
    'request-shapes.ts': renderRequestShapes(ir),
    'operations.ts': renderOperations(spec('routes.json'), ir),
    'error-codes.ts': renderErrorCodes(spec('error-codes.json')),
    'defaults.ts': renderDefaults(spec('defaults.json')),
    'retry-policy.ts': renderRetryPolicy(spec('retry-policy.json')),
  };
  mkdirSync(TARGET, { recursive: true });
  const options = { root: ROOT, regenerate: 'node scripts/generate.mjs' };
  let status = 0;
  for (const [name, content] of Object.entries(files)) {
    status |= writeOrCheck(join(TARGET, name), content, argv, options);
  }
  const tools = join(ROOT, 'packages', 'sdk', 'src', 'tools', 'specs.gen.ts');
  status |= writeOrCheck(tools, renderToolSpecs(join(SPEC, 'tools')), argv, options);
  return status;
}

process.exitCode = main(process.argv.slice(2));

#!/usr/bin/env node
// Vendors the shared SDK spec (sprouts-py's `spec/` directory) into `spec/`
// and pins every file's SHA-256 in `spec/PIN.json`.
//
//   node scripts/sync-spec.mjs                 # copy from ../sprouts-py/spec
//   node scripts/sync-spec.mjs --from <dir>    # copy from another checkout
//   node scripts/sync-spec.mjs --check         # verify spec/ against PIN.json
//
// The vendored copy is never edited by hand: a case that looks wrong is fixed
// in sprouts-py first and re-synced here (contract 02 §14). `--check` is what
// catches a hand edit — any file whose hash differs from its pin, any file
// added, and any pinned file removed.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = join(ROOT, 'spec');
const PIN_FILE = join(SPEC_DIR, 'PIN.json');
const PIN_NAME = 'PIN.json';
const DEFAULT_SOURCE = '../sprouts-py/spec';
/** Recorded in PIN.json so a reader knows where the files came from. */
const SOURCE_LABEL = 'sprouts-py/spec';

/** Every regular file under `dir`, as sorted POSIX paths relative to it. Dotfiles are skipped. */
function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      if (name.startsWith('.') || name === '__pycache__') continue;
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(dir, path).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function vendoredFiles() {
  return listFiles(SPEC_DIR).filter((path) => path !== PIN_NAME);
}

function check() {
  if (!existsSync(PIN_FILE)) {
    console.error(`${relative(ROOT, PIN_FILE)} is missing; run node scripts/sync-spec.mjs`);
    return 1;
  }
  const pinned = JSON.parse(readFileSync(PIN_FILE, 'utf8')).files ?? {};
  const problems = [];
  const present = vendoredFiles();
  for (const path of present) {
    if (!(path in pinned)) problems.push(`not pinned: spec/${path}`);
    else if (sha256(join(SPEC_DIR, path)) !== pinned[path]) problems.push(`changed: spec/${path}`);
  }
  for (const path of Object.keys(pinned)) {
    if (!present.includes(path)) problems.push(`missing: spec/${path}`);
  }
  if (problems.length > 0) {
    console.error(
      `spec/ does not match spec/PIN.json:\n  ${problems.join('\n  ')}\n` +
        'The vendored spec is changed only by re-syncing from sprouts-py (node scripts/sync-spec.mjs).',
    );
    return 1;
  }
  console.log(`spec/ matches spec/PIN.json (${present.length} files).`);
  return 0;
}

function sync(sourceArg) {
  const source = resolve(ROOT, sourceArg);
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    console.error(`No spec directory at ${source}. Pass --from <path to sprouts-py/spec>.`);
    return 1;
  }
  rmSync(SPEC_DIR, { recursive: true, force: true });
  mkdirSync(SPEC_DIR, { recursive: true });
  const files = listFiles(source);
  for (const path of files) {
    const target = join(SPEC_DIR, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(source, path), target);
  }
  const pins = Object.fromEntries(files.map((path) => [path, sha256(join(SPEC_DIR, path))]));
  writeFileSync(PIN_FILE, `${JSON.stringify({ source: SOURCE_LABEL, files: pins }, null, 2)}\n`);
  console.log(`Synced ${files.length} files from ${relative(ROOT, source) || source} into spec/.`);
  return 0;
}

function main(argv) {
  if (argv.includes('--check')) return check();
  const fromIndex = argv.indexOf('--from');
  if (fromIndex !== -1 && argv[fromIndex + 1] === undefined) {
    console.error('--from needs a path');
    return 1;
  }
  return sync(fromIndex === -1 ? DEFAULT_SOURCE : argv[fromIndex + 1]);
}

process.exitCode = main(process.argv.slice(2));

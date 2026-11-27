#!/usr/bin/env node
// Checks that nothing this repository publishes names a service behind the API, a ticket or
// a backend source path: every file git tracks, and every new one it does not ignore (the
// repository is public), and every file the three packages pack (the npm tarballs, `.d.ts`
// and source maps included).
//
//   node scripts/check-public-text.mjs                   # the denied words if given, else the patterns
//   node scripts/check-public-text.mjs --require-words   # a release: fail without the denied words
//
// Two kinds of rule, as sproutsdata-py's `scripts/check_public_text.py` reads them:
// - the patterns in `spec/public-text.json` (vendored from sproutsdata-py): a ticket key, a
//   backend source path. They name no service, so they live in the repository;
// - the denied words, the services' own names, kept out of the repository: the
//   SPROUTSDATA_DENIED_WORDS secret in CI (one per line, optionally `word = replacement`), or
//   `denied_words` in the stack profile SPROUTSDATA_STACK_PROFILE points to. A word matches
//   anywhere in a line, inside longer words too, ignoring case. This script never prints them.
//
// Exit codes: 0 clean, 1 findings (each printed), 2 the denied words were required and not given.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_FILE = 'spec/public-text.json';
const PACKAGES = ['packages/sdk', 'packages/langchain', 'packages/ai-sdk'];
const ENV_WORDS = 'SPROUTSDATA_DENIED_WORDS';
const ENV_PROFILE = 'SPROUTSDATA_STACK_PROFILE';

/** `word` or `word = replacement` lines, lower-cased words (blank lines and `#` comments skipped). */
function parseWords(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split('=')[0].trim().toLowerCase())
    .filter((word) => word !== '');
}

/** The denied words: from the environment, else from the stack profile, else none. */
function deniedWords() {
  const given = process.env[ENV_WORDS];
  if (given !== undefined && given.trim() !== '') return parseWords(given);
  const profile = process.env[ENV_PROFILE];
  if (profile === undefined || profile === '' || !existsSync(profile)) return [];
  const held = JSON.parse(readFileSync(profile, 'utf8')).denied_words ?? {};
  return Object.keys(held).map((word) => word.toLowerCase());
}

/** Every finding in `text`, as `where:line: what`. The denied words are never echoed. */
function findings(text, where, words, patterns) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    const at = `${where}:${String(index + 1)}`;
    const lowered = line.toLowerCase();
    if (words.some((word) => lowered.includes(word))) found.push(`${at}: names a service behind the API`);
    for (const [name, pattern] of patterns) if (pattern.test(line)) found.push(`${at}: contains a ${name}`);
  });
  return found;
}

/** The text of a file, or `undefined` for a binary one (which says nothing a reader sees). */
function textOf(path) {
  const data = readFileSync(path);
  return data.includes(0) ? undefined : data.toString('utf8');
}

/** Every file git tracks, and every new one it does not ignore; a deleted one is gone. */
function tracked() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '' && path !== POLICY_FILE && existsSync(join(ROOT, path)))
    .map((path) => [path, join(ROOT, path)]);
}

function packed(pkg) {
  const [listing] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: join(ROOT, pkg), encoding: 'utf8' }));
  return listing.files.map((file) => [`${listing.filename}!${file.path}`, join(ROOT, pkg, file.path)]);
}

function main() {
  const words = deniedWords();
  if (words.length === 0) {
    if (process.argv.includes('--require-words')) {
      console.error(`error: this check needs the denied words: set ${ENV_WORDS} (one per line), or ${ENV_PROFILE}.`);
      return 2;
    }
    console.error('warning: the denied words are not given, so only the patterns were checked');
  }
  const policy = JSON.parse(readFileSync(join(ROOT, POLICY_FILE), 'utf8'));
  const patterns = Object.entries(policy.denied_patterns).map(([name, source]) => [name, new RegExp(source)]);
  const files = [...tracked(), ...PACKAGES.flatMap(packed)];
  const found = files.flatMap(([where, path]) => {
    const text = textOf(path);
    return text === undefined ? [] : findings(text, where, words, patterns);
  });
  for (const finding of found) console.error(finding);
  console.log(found.length > 0 ? `${String(found.length)} finding(s) in ${String(files.length)} files.` : `${String(files.length)} files: clean.`);
  return found.length > 0 ? 1 : 0;
}

process.exitCode = main();

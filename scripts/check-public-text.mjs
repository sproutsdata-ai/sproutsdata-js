#!/usr/bin/env node
// Checks that nothing this repository publishes names a service behind the API, a ticket or
// a backend source path: every file git tracks (the repository is public) and every file the
// three packages pack (the npm tarballs, `.d.ts` and source maps included).
//
//   node scripts/check-public-text.mjs
//
// What may not appear is `spec/public-text.json`, vendored from sproutsdata-py, which checks
// its own tree the same way (`scripts/check_public_text.py`). The denied words are hashed, so
// the file does not publish them, and this script never prints them.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_FILE = 'spec/public-text.json';
const PACKAGES = ['packages/sdk', 'packages/langchain', 'packages/ai-sdk'];
const WORD = /[a-z0-9]+(?:-[a-z0-9]+)*/g;

const policy = JSON.parse(readFileSync(join(ROOT, POLICY_FILE), 'utf8'));
const deniedWords = new Set(policy.denied_words_sha256);
const deniedPatterns = Object.entries(policy.denied_patterns).map(([name, source]) => [name, new RegExp(source)]);

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Every finding in `text`, as `where:line: what`. The denied words are never echoed. */
function findings(text, where) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    const at = `${where}:${String(index + 1)}`;
    if ((line.toLowerCase().match(WORD) ?? []).some((word) => deniedWords.has(sha256(word)))) found.push(`${at}: names a service behind the API`);
    for (const [name, pattern] of deniedPatterns) if (pattern.test(line)) found.push(`${at}: contains a ${name}`);
  });
  return found;
}

/** The text of a file, or `undefined` for a binary one (which says nothing a reader sees). */
function textOf(path) {
  const data = readFileSync(path);
  return data.includes(0) ? undefined : data.toString('utf8');
}

function tracked() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '' && path !== POLICY_FILE)
    .map((path) => [path, join(ROOT, path)]);
}

function packed(pkg) {
  const [listing] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: join(ROOT, pkg), encoding: 'utf8' }));
  return listing.files.map((file) => [`${listing.filename}!${file.path}`, join(ROOT, pkg, file.path)]);
}

const files = [...tracked(), ...PACKAGES.flatMap(packed)];
const found = files.flatMap(([where, path]) => {
  const text = textOf(path);
  return text === undefined ? [] : findings(text, where);
});
for (const finding of found) console.error(finding);
console.log(found.length > 0 ? `${String(found.length)} finding(s) in ${String(files.length)} files.` : `${String(files.length)} files: clean.`);
process.exitCode = found.length > 0 ? 1 : 0;

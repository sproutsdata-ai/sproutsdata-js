#!/usr/bin/env node
// Checks every relative link in the repo's Markdown: the target file or
// directory must exist and, when the link names a `#fragment` in a Markdown
// file, that file must have a heading with that GitHub slug.
//
//   node scripts/check-links.mjs
//
// `spec/` is vendored from sproutsdata-py and checked there; external links
// (`http:`, `https:`, `mailto:`) are not fetched.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', 'coverage', 'spec']);

function markdownFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith('.') || SKIP.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

/** The file's lines outside fenced code blocks. */
function prose(text) {
  let fenced = false;
  return text.split('\n').filter((line) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    return !fenced && !/^\s*(```|~~~)/.test(line);
  });
}

/** GitHub's heading anchors: lower-cased, punctuation dropped, spaces to `-`, repeats numbered. */
function anchors(path) {
  const seen = new Map();
  const out = new Set();
  for (const line of prose(readFileSync(path, 'utf8'))) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const text = heading[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    out.add(count === 0 ? base : `${base}-${count}`);
  }
  return out;
}

const problems = [];
for (const file of markdownFiles(ROOT)) {
  for (const line of prose(readFileSync(file, 'utf8'))) {
    const withoutCode = line.replace(/`[^`]*`/g, '');
    for (const [, target] of withoutCode.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue;
      const [pathPart, fragment] = target.split('#');
      const resolved = pathPart === '' ? file : resolve(dirname(file), pathPart);
      const where = relative(ROOT, file);
      if (!existsSync(resolved)) {
        problems.push(`${where}: ${target} — no such file`);
      } else if (fragment && resolved.endsWith('.md') && !anchors(resolved).has(fragment)) {
        problems.push(`${where}: ${target} — no heading #${fragment}`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('Every relative Markdown link resolves.');

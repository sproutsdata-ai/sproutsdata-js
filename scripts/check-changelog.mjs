#!/usr/bin/env node
// Checks that a package's changelog dates the version being released.
//
// A version's notes are written under `## 0.1.0 — Unreleased` while it is built, and the release
// pull request dates them: `## 0.1.0 — 2026-12-01`. A release whose heading is not dated would
// publish notes that say it has not happened, so the release workflow runs this on the tag's
// version first. sproutsdata-py's `scripts/check_changelog.py` checks its changelogs the same way.
//
//   node scripts/check-changelog.mjs 0.1.0 packages/sdk/CHANGELOG.md
//
// Exit codes: 0 the version's heading is dated, 1 it is missing or not dated, 2 bad arguments or
// an unreadable file.

import { readFileSync } from 'node:fs';

const [version, changelog] = process.argv.slice(2);

function main() {
  if (version === undefined || changelog === undefined) {
    console.error('usage: node scripts/check-changelog.mjs <version> <CHANGELOG.md>');
    return 2;
  }
  let text;
  try {
    text = readFileSync(changelog, 'utf8');
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## \\[?${escaped}\\]? — (.+)$`, 'm').exec(text);
  if (heading === null) {
    console.error(`${changelog}: no \`## ${version} — <date>\` heading`);
    return 1;
  }
  const when = heading[1].trim();
  // A real calendar day: 2026-02-30 parses, as 2026-03-02, and is refused.
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(when) && new Date(`${when}T00:00:00Z`).toISOString().startsWith(when);
  if (!valid) {
    console.error(`${changelog}: the ${version} heading says '${when}', not a date (YYYY-MM-DD)`);
    return 1;
  }
  console.log(`${changelog}: ${version} is dated`);
  return 0;
}

process.exitCode = main();

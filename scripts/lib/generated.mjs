// Shared by the code generators: write a generated file, or with `--check`
// fail when the file on disk is not what the generator would write.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';

/**
 * Write `content` to `path`, or — when `argv` holds `--check` — compare it
 * with what is there and return a non-zero exit code on any difference.
 */
export function writeOrCheck(path, content, argv, { root, regenerate }) {
  const shown = relative(root, path);
  if (argv.includes('--check')) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    if (current !== content) {
      console.error(`${shown} is out of date with the spec. Regenerate it: ${regenerate}`);
      return 1;
    }
    console.log(`${shown} is current.`);
    return 0;
  }
  writeFileSync(path, content);
  console.log(`Wrote ${shown}.`);
  return 0;
}

/** Wrap prose into `* `-prefixed TSDoc lines of at most `width` characters. */
export function docLines(text, indent, width = 80) {
  const prefix = `${indent} * `;
  const lines = [];
  let line = '';
  for (const word of text.replaceAll('*/', '*\\/').split(/\s+/).filter(Boolean)) {
    if (line !== '' && prefix.length + line.length + 1 + word.length > width) {
      lines.push(prefix + line);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') lines.push(prefix + line);
  return [`${indent}/**`, ...lines, `${indent} */`];
}

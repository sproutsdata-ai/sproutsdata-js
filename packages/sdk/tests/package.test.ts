import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { VERSION } from '../src/index.js';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  engines: { node: string };
};

describe('the package', () => {
  it('reports the version package.json declares', () => {
    expect(VERSION).toBe(manifest.version);
  });

  it('supports Node.js 22.12 and later, the floor CI tests', () => {
    expect(manifest.engines.node).toBe('>=22.12.0');
  });
});

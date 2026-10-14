/** The README's compatibility table is generated from package.json: this keeps the two in step. */

import { readFileSync } from 'node:fs';

import { expect, it } from 'vitest';

interface Manifest {
  engines: { node: string };
  peerDependencies: Record<string, string>;
}

function read(name: string): string {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

it('the README compatibility table matches package.json', () => {
  const manifest = JSON.parse(read('package.json')) as Manifest;
  const rows = [
    ['Node.js', manifest.engines.node],
    ...Object.entries(manifest.peerDependencies).map(([name, range]) => [`\`${name}\``, range]),
  ];
  const table = ['| Requirement | Versions |', '| --- | --- |', ...rows.map(([name, range]) => `| ${name} | ${range} |`)];
  const readme = read('README.md');
  const block = readme.slice(readme.indexOf('<!-- compat:start -->'), readme.indexOf('<!-- compat:end -->'));
  expect(block.split('\n').slice(1).filter(Boolean)).toEqual(table);
});

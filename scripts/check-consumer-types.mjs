#!/usr/bin/env node
// Compiles a small consumer of `sproutsdata` and `sproutsdata/tools` against the BUILT
// declarations, with `skipLibCheck: false`, once with `exactOptionalPropertyTypes` on and once
// off: the declarations must type-check in a strict consumer and in a lenient one, under
// both ES module and CommonJS resolution.
//
//   npm run build && node scripts/check-consumer-types.mjs

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONSUMER = join(ROOT, '.consumer-types', 'consumer.ts');

const SOURCE = `
import { SproutsData, AuthenticationError, lookupRef, type SearchEnvelope, type SearchParams } from 'sproutsdata';
import { Toolset, definitions, resolveClient, toJson, type ToolResult } from 'sproutsdata/tools';

export async function consume(): Promise<string> {
  const client: SproutsData = resolveClient({ apiKey: 'sk_dsp_live_x' });
  const params: SearchParams = { query: 'robotics', limit: 5 };
  const page: SearchEnvelope = await client.search(params);
  const ref = page.results[0] === undefined ? undefined : lookupRef(page.results[0]);
  const tools = new Toolset(client, { include: ['search'], maxResults: 10 });
  const result: ToolResult = await tools.run('sprouts_search', { query: 'robotics' });
  if (result instanceof AuthenticationError) throw result;
  return toJson({ ref, count: definitions().length, result });
}
`;

const VARIANTS = [
  { name: 'strict, ES modules', moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, exactOptionalPropertyTypes: true },
  { name: 'lenient, ES modules', moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, exactOptionalPropertyTypes: false },
  { name: 'strict, Node 16 CommonJS', moduleResolution: ts.ModuleResolutionKind.Node16, module: ts.ModuleKind.Node16, exactOptionalPropertyTypes: true },
];

let failed = 0;
for (const variant of VARIANTS) {
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: variant.module,
    moduleResolution: variant.moduleResolution,
    strict: true,
    exactOptionalPropertyTypes: variant.exactOptionalPropertyTypes,
    skipLibCheck: false,
    noEmit: true,
    types: [],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (name) => name === CONSUMER || fileExists.call(host, name);
  host.readFile = (name) => (name === CONSUMER ? SOURCE : readFile.call(host, name));
  host.getSourceFile = (name, version, onError) =>
    name === CONSUMER ? ts.createSourceFile(name, SOURCE, version, true) : getSourceFile.call(host, name, version, onError);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([CONSUMER], options, host));
  for (const diagnostic of diagnostics) {
    const where = diagnostic.file === undefined ? '' : `${diagnostic.file.fileName}: `;
    console.error(`${variant.name}: ${where}${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
  }
  failed += diagnostics.length;
  console.log(`${variant.name}: ${diagnostics.length === 0 ? 'clean' : `${String(diagnostics.length)} errors`}`);
}
process.exitCode = failed > 0 ? 1 : 0;

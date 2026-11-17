#!/usr/bin/env node
// Type-checks every TypeScript code block in the docs and READMEs against the built packages,
// with the TypeScript compiler API.
//
//   node scripts/check-doc-snippets.mjs           # every page
//   node scripts/check-doc-snippets.mjs FILE...   # these pages
//
// Each ```ts block is compiled as its own module (top-level `await` allowed), so a reader can
// copy any one of them. A block may use `client`, a `SproutsData`, without making one; any
// other name it uses, it imports or declares. A block the checker should not read (a
// deliberate mistake, a signature) is preceded by the line `<!-- snippet: skip -->`. Imports of
// the provider SDKs a reader installs alongside (`openai`, `@anthropic-ai/sdk`) are typed `any`.
//
// Run after `npm run build`: `sproutsdata` resolves to packages/sdk/dist.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['docs', 'README.md', 'packages/sdk/README.md', 'packages/sdk/MIGRATION.md', 'packages/langchain/README.md', 'packages/ai-sdk/README.md'];
const SKIP = '<!-- snippet: skip -->';
const LANGUAGES = new Set(['ts', 'typescript']);
const VIRTUAL = join(ROOT, '.doc-snippets');
const UNTYPED = ['openai', '@anthropic-ai/sdk'];

const OPTIONS = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
  types: ['node'],
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  moduleDetection: ts.ModuleDetectionKind.Force,
  typeRoots: [join(ROOT, 'node_modules', '@types')],
};

function markdownFiles(path) {
  if (!statSync(path, { throwIfNoEntry: false })) return [];
  if (!statSync(path).isDirectory()) return path.endsWith('.md') ? [path] : [];
  return readdirSync(path).flatMap((name) => markdownFiles(join(path, name)));
}

/** The page's TypeScript blocks: `{ line, code }`, the line being the block's first. */
function blocks(page) {
  const lines = readFileSync(page, 'utf8').split('\n');
  const found = [];
  for (let index = 0; index < lines.length; index++) {
    const fence = /^(\s*)```(\S*)/.exec(lines[index]);
    if (fence === null) continue;
    const [, indent, language] = fence;
    const skipped = index > 0 && lines[index - 1].trim() === SKIP;
    const start = index + 1;
    for (index = start; index < lines.length && !lines[index].trim().startsWith('```'); index++);
    if (LANGUAGES.has(language) && !skipped) {
      found.push({ line: start + 1, code: lines.slice(start, index).map((line) => line.slice(indent.length)).join('\n') });
    }
  }
  return found;
}

/** A block as a module: the declared `client` unless the block makes its own. */
function source(code) {
  const prelude = /\b(?:const|let|var|function|class)\s+client\b|\bimport\b[^;]*\bclient\b/.test(code)
    ? ''
    : "import type { SproutsData as SnippetClient } from 'sproutsdata';\ndeclare const client: SnippetClient;\n";
  return { text: `${prelude}${code}\nexport {};\n`, offset: prelude === '' ? 0 : 2 };
}

const SHIMS = `${UNTYPED.map((name) => `declare module '${name}' { const value: any; export default value; export = value; }`).join('\n')}\n`;

function main(argv) {
  const pages = argv.length > 0 ? argv.map((name) => resolve(name)) : PAGES.flatMap((name) => markdownFiles(join(ROOT, name)));
  const files = new Map([[join(VIRTUAL, 'shims.d.ts'), { text: SHIMS, page: undefined }]]);
  for (const [number, page] of pages.entries()) {
    for (const [index, block] of blocks(page).entries()) {
      const { text, offset } = source(block.code);
      files.set(join(VIRTUAL, `page${String(number)}-block${String(index)}.ts`), { text, page, line: block.line, offset });
    }
  }
  const host = ts.createCompilerHost(OPTIONS);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (name) => files.has(name) || fileExists.call(host, name);
  host.readFile = (name) => files.get(name)?.text ?? readFile.call(host, name);
  host.getSourceFile = (name, version, onError) =>
    files.has(name) ? ts.createSourceFile(name, files.get(name).text, version, true) : getSourceFile.call(host, name, version, onError);
  const program = ts.createProgram([...files.keys()], OPTIONS, host);
  let errors = 0;
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    const file = diagnostic.file === undefined ? undefined : files.get(diagnostic.file.fileName);
    if (file?.page === undefined) {
      console.error(`error: ${message}`);
    } else {
      const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      console.error(`${relative(ROOT, file.page)}:${String(file.line + line - file.offset)}: error TS${String(diagnostic.code)}: ${message}`);
    }
    errors += 1;
  }
  console.log(`${String(files.size - 1)} code blocks in ${String(pages.length)} pages; ${String(errors)} errors`);
  return errors > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));

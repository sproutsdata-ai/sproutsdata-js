/**
 * The SDK's layer rules, checked by `npm run lint:layers` (dependency-cruiser).
 *
 * From the outside in: tools -> client -> resources -> requests -> core -> types -> generated.
 * Each layer imports only the layers after it. The adapters reach the SDK only through
 * its published entry points, never its sources.
 */
const SRC = '^packages/sdk/src/';

/** A rule that `from` may not import anything matching `to`. */
const forbid = (name, comment, from, to) => ({ name, comment, severity: 'error', from: { path: from }, to: { path: to } });

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'A cycle makes two modules one module in two files.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-node-builtins',
      comment: 'The SDK runs on Node, Deno, Bun and edge runtimes: no Node built-in modules.',
      severity: 'error',
      from: { path: SRC },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'no-runtime-dependencies',
      comment: 'The SDK ships with zero runtime dependencies.',
      severity: 'error',
      from: { path: SRC },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown'] },
    },
    forbid('generated-is-a-leaf', 'Generated code is derived from spec/ alone.', `${SRC}generated/`, `${SRC}(?!generated/)`),
    forbid('types-name-generated-only', 'Public type names alias generated types.', `${SRC}types/`, `${SRC}(core|requests|resources|tools|client|index)`),
    forbid('core-stays-low', 'The core knows nothing of features or wiring.', `${SRC}core/`, `${SRC}(requests|resources|tools|client|index)`),
    forbid('requests-stay-low', 'Request builders are pure.', `${SRC}requests/`, `${SRC}(resources|tools|client|index)`),
    forbid('resources-below-client', 'A resource never reaches the client or the tools.', `${SRC}resources/`, `${SRC}(tools|client|index)`),
    forbid('tools-use-the-public-surface', 'Tools are built on the public client only.', `${SRC}tools/`, `${SRC}(?!tools/|index\\.ts$)`),
    forbid('adapters-use-the-package', 'Adapters import `sproutsdata` and `sproutsdata/tools`, never its sources.', '^packages/(langchain|ai-sdk)/', '^packages/sdk/src/'),
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|node_modules)/' },
    tsConfig: { fileName: 'packages/sdk/tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'types', 'default'] },
  },
};

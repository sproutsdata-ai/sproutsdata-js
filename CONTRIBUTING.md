# Contributing

## Layout

An npm-workspaces monorepo: the core SDK plus two AI-framework adapter
packages, each versioned separately.

```
spec/             the shared SDK spec, vendored from sproutsdata-py; never edited here
scripts/          spec sync, the code generator, and the checks and smoke tests below
packages/
  sdk/            sproutsdata: the core SDK (no runtime dependencies)
    src/          tools -> client.ts -> resources -> requests -> core -> types -> generated
    tests/        vitest suites; tests/e2e/ runs against the local stack
  ai-sdk/         @sproutsdata.ai/ai-sdk: Vercel AI SDK tools
  langchain/      @sproutsdata.ai/langchain: LangChain tools and a retriever
docs/             the guide, one page per area; docs/integrations/ covers frameworks
                  without a package (OpenAI Agents SDK)
examples/         runnable programs, type-checked by `npm run typecheck`
```

The SDK's source is layered from the outside in: `tools` (the API as tools a
model can call, on the public surface only), `client.ts` (wiring), `resources`
(one file per API feature), `requests` (request bodies and the checks the
server would otherwise refuse), `core` (transport, retries, pagination,
server-sent events, errors), `types` (the public names) and `generated`
(everything derived from the spec). Each layer imports only those after it;
`npm run lint:layers` checks it.

The adapters resolve `sproutsdata` through the workspace symlink to
`packages/sdk/dist/`, so build the SDK before testing an adapter. They are thin
layers over `sproutsdata/tools`: tool names, descriptions, input schemas,
validation, result shaping, the connection options (`resolveClient`,
`ConnectionOptions`) and the error policy all live in the SDK, generated from
`spec/tools/`. An adapter holds framework glue only. `sproutsdata` is a peer
dependency of each adapter, so an application and its adapters share one copy.
A change to a tool's behaviour belongs in the SDK and the shared spec, never in
an adapter.

## The gate

```bash
npm install
npm run check
```

`npm run check` is the whole gate CI runs. It runs, in order:

| Script | What it checks |
|---|---|
| `lint` | ESLint (flat config, `eslint.config.js`) over every workspace |
| `lint:layers` | The layer rules and runtime rules in `.dependency-cruiser.cjs` (no cycles, no Node built-ins, no runtime dependencies in the SDK) |
| `check:generated` | `spec/` matches `spec/PIN.json`, and `src/generated/` matches the spec |
| `build` | tsup builds each package (the SDK first) |
| `typecheck` | `tsc` per package (sources and tests), and over `examples/` |
| `test` | Each package's vitest suite (the SDK with coverage) |
| `check:package` | `publint` and `attw` on each package |
| `check:consumer` | A consumer of `sproutsdata` and `sproutsdata/tools` compiled against the built declarations, `skipLibCheck` off, strict and lenient |
| `check:size` | `size-limit` on the built SDK (`.size-limit.json`) |
| `smoke:dist` | The built SDK loads through its ESM and CommonJS entry points |
| `smoke:edge` | The built SDK runs in workerd (Miniflare), with no Node globals |
| `check:docs` | `scripts/check-doc-snippets.mjs` (below) |
| `check:links` | `scripts/check-links.mjs`: every relative Markdown link, and every `#heading` it names, resolves |
| `audit` | `npm audit --omit=dev` |

To work on one package: `npm test -w packages/sdk`, or `npx vitest` inside the
package directory.

### Doc snippets

`scripts/check-doc-snippets.mjs` type-checks every TypeScript code block in
`docs/`, the root `README.md`, and the READMEs and `MIGRATION.md` of the
packages, with the TypeScript compiler API, against the built packages. Run
`npm run build` first.

```bash
node scripts/check-doc-snippets.mjs                 # every page
node scripts/check-doc-snippets.mjs docs/lists.md   # these pages
```

Each ` ```ts ` block is compiled as its own module, under `strict`, with
top-level `await` allowed, so a reader can copy any one of them. A block may use
`client`, a `SproutsData`, without making one; any other name it uses, it
imports or declares. Imports of `openai` and `@anthropic-ai/sdk` are typed
`any`. A block the checker should not read (a deliberate mistake, a signature,
code for a package this repository does not install) is preceded by the line
`<!-- snippet: skip -->`; use it rarely.

### Live checks

The live suites need the local stack (sproutsdata-py's `make e2e-up`) or a
deployment, so they are not part of `npm run check`:

```bash
npm run e2e            # each package's tests/e2e against the local stack
npm run e2e:examples   # every example in examples/ against the local stack
npm run smoke:live     # scripts/smoke-live.mjs: the checks in spec/smoke/checks.json
```

`smoke:live` reads `SPROUTSDATA_API_KEY` (and `SPROUTSDATA_BASE_URL`, if set).
Use a test key: its calls are free. A live key is refused unless `--allow-live`
is given, since several checks are billed.

## Design rules

Each exists because the API's contract requires it, and each is covered by a
test.

1. **No runtime dependencies in the core SDK.** It runs wherever a WHATWG
   `fetch` does: Node.js, Deno, Bun and edge runtimes.
2. **Response types tolerate unknown fields and enum members.** Vocabularies
   the server may grow are open unions (`... | (string & {})`).
3. **Unknown error codes must not crash.** An unknown code falls back to the
   class for the HTTP status.
4. **Refuse locally what the server would refuse.** Request bodies are checked
   against the spec's request models (`src/generated/request-shapes.ts`) and the
   server's cross-field rules (`src/requests/`), each citing the backend
   validator it mirrors, so a refused call costs no round trip and no credits.
5. **Pagination resends the same request.** A cursor is signed against the
   request; only `cursor` (and `limit`, where the cursor does not bind it) may
   change between pages.
6. **Never send `Origin` or `Referer`, never follow a redirect, never run in a
   browser.** The API refuses a key sent with an `Origin`; a followed redirect
   would send the key to another origin.
7. **Never retry a `402`.** Insufficient credits is commercial, not transient.
8. **Retry by route class.** Every operation names what a repeat costs (`safe`,
   `billed`, `keyed`, `once`, from `spec/routes.json`). A billed or `once` call
   that may have reached the server is never repeated.
9. **Surface `request_id` on every answer and every error.**
10. **Never print an API key.** The key lives in `#private` fields; objects that
    hold it redact it in `toJSON`. Never put it in an error message or a URL.
11. **Encode every path segment** with `encodeURIComponent`. A value must never
    be able to add a path segment or a query string.

## No key-shaped strings in the repository

Tests and docs must not contain anything that matches the key pattern, so a
secret scanner can run with push protection and never raise a false alarm:

- In tests, build fixture keys at run time: `'sk_dsp_test_' + '...'` (see
  `packages/sdk/tests/support/fakes.ts`).
- In docs, write `sk_dsp_test_<your-key>`, or an elided `sk_dsp_live_…`.

## Keeping up with the API

The backend is the source of truth, described for the SDKs by the shared spec in
sproutsdata-py's `spec/` directory: `openapi.json`, `models.json`,
`routes.json` (each operation's retry class and paging), `retry-policy.json`,
`error-codes.json`, `defaults.json`, `surface-map.json`, `tools/`, `smoke/` and
the behavioural `conformance/` cases. This repository vendors an exact copy in
`spec/`, with every file's SHA-256 in `spec/PIN.json`. A case that looks wrong
is fixed in sproutsdata-py first, then synced again; never edited here.

```bash
npm run spec:sync        # copy ../sproutsdata-py/spec (or: node scripts/sync-spec.mjs --from <dir>)
npm run generate         # regenerate packages/sdk/src/generated/
npm run check:generated  # the spec matches PIN.json, and the generated files match the spec
```

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `feat!:` for a
breaking change). One logical change per pull request. Every behavioural change
needs a test and a `CHANGELOG.md` entry in the package it touches.

## Releases

Each package versions independently and releases from its own tag: `v0.0.1` for
`sproutsdata`, `langchain-v0.0.1` and `ai-sdk-v0.0.1` for the adapters. An
adapter's peer range on `sproutsdata` must be satisfiable from npm, so the SDK
always publishes first.

1. Open a pull request that bumps `version` in the package's `package.json` and
   `src/version.ts`, and adds its `CHANGELOG.md` entry. Merge it after review.
2. Tag the merge commit on `main` and push the tag:
   `git tag v0.0.2 && git push origin v0.0.2`.
3. The release workflow runs the gate again and waits for approval in the `npm`
   environment. A required reviewer approves it in the Actions tab.
4. The package is published to npm with provenance, then the GitHub Release is
   created.

To rehearse, run the release workflow by hand. It runs `npm publish --dry-run`
and shows what would be uploaded.

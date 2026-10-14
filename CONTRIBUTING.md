# Contributing

## Layout

An npm-workspaces monorepo: the core SDK plus AI-framework adapter packages,
each a separately versioned package.

```
spec/             the shared SDK spec, vendored from sprouts-py — never edited here
scripts/          spec sync and the code generators
packages/
  sdk/            sproutsdata — the core SDK (zero runtime dependencies)
    src/          the library; src/constants.ts holds every name and default
    tests/        vitest suites
  ai-sdk/         @sproutsdata.ai/ai-sdk — Vercel AI SDK tools
  langchain/      @sproutsdata.ai/langchain — LangChain tools and a retriever
docs/             the guide, one page per area; docs/integrations/ holds recipes
                  for frameworks without a package (OpenAI Agents SDK)
examples/         runnable programs, type-checked by `npm test` (never run there)
```

The adapters resolve `sproutsdata` through the workspace symlink to
`packages/sdk/dist/`, which is why every root script builds the SDK first.
They are **thin layers over `sproutsdata/tools`**: tool names, descriptions,
input schemas, validation, result shaping and the error policy all live in the
SDK, generated from `spec/tools/`, and an adapter holds framework glue only —
no JSON Schema literals, no shaping code. `sproutsdata` is a peer dependency
of each adapter, so an application and its adapters share one copy. A
behaviour change to a tool belongs in the SDK (and the shared spec), never in
an adapter.

## Working on it

```bash
npm install
npm run build
npm run typecheck
npm run lint
npm test
```

All of these are the gate. `typecheck` runs `tsc --noEmit` per package and
over `examples/` under `strict` and `noUncheckedIndexedAccess`; `lint` runs
ESLint (flat config, `eslint.config.js`) over every workspace; `test` also
type-checks the examples and runs `scripts/check-links.mjs`, which fails on a
relative Markdown link (or `#heading`) that does not resolve.

To work on one package: `npm test -w packages/sdk`, or `npx vitest` inside the
package directory. An adapter change needs `npm run build -w packages/sdk`
first if the SDK changed too.

Live smoke tests against the API are opt-in and never part of `npm test`. Use
a **test** key — test keys are metered but charged zero:

```bash
export SPROUTSDATA_API_KEY=sk_dsp_test_<your-key>
```

## Design rules

Not style preferences. Each exists because the API's contract requires it, and
each is covered by a test.

1. **Zero runtime dependencies in the core SDK.** It runs wherever a WHATWG
   `fetch` does. Anything that would need a dependency belongs in an adapter.
2. **Response types tolerate unknown fields and enum members.** Adding a
   response field or an enum member is not a breaking change on the server,
   so vocabularies the server may grow are open unions (`… | (string & {})`).
3. **Unknown error codes must not crash.** Fall back to the class for the HTTP
   status.
4. **Validate structure, not vocabulary.** Refuse locally only what the server
   cannot tell the caller better: missing or mutually exclusive arguments,
   `Origin` / `Referer` headers, an `http://` base URL, a request certain to
   fail and billed. Leave vocabularies and bounds to the server's 422.
5. **Pagination re-sends the same request.** The cursor is signed against a
   fingerprint of the request; only `cursor` and `limit` may change between
   pages.
6. **Never send `Origin` or `Referer`, and never follow a redirect.** Either
   header alongside an API key is a `403` before routing; a followed redirect
   would re-send the key to another origin.
7. **Never retry a `402`.** Insufficient credits is commercial, not transient.
8. **Never sum `allocated` and `shared` credits.** `shared` is reported but not
   spendable. `spendable` is the only number to spend against.
9. **Surface `request_id` on every response and every error.** It is the only
   handle support can act on.
10. **Never print an API key.** The key lives in `#private` fields; objects
    that hold it redact it in `toJSON` and Node's inspect hook. Never put it in
    an error message or a URL.
11. **Encode every path segment** with `encodeURIComponent`. A value must never
    be able to add a path segment or a query string.
12. **Retry by route class.** Every transport call names what a repeat costs
    (`safe`, `billed`, `keyed`, `once`, from `spec/routes.json`); a `POST`
    cannot be sent without one. A billed or `once` call that may have reached
    the server is never repeated.

## No key-shaped strings in the repository

Tests and docs must not contain anything that matches the key pattern, so a
secret scanner can run with push protection and never cry wolf:

- In tests, build fixture keys at run time: `'sk_dsp_test_' + 'x'.repeat(22)`
  (see `tests/helpers.ts`).
- In docs, write `sk_dsp_test_<your-key>`, or an elided `sk_dsp_live_…`.

## Keeping up with the API

The backend (`dsp-backend`) is the source of truth, described for the SDKs by
the shared spec in sprouts-py's `spec/` directory: `openapi.json`,
`error-codes.json`, `routes.json` (each route's retry class),
`retry-policy.json`, `defaults.json`, `surface-map.json` and the behavioural
`conformance/` cases. This repo vendors an exact copy in `spec/`, with every
file's SHA-256 in `spec/PIN.json`. A case that looks wrong is fixed in
sprouts-py first, then re-synced — never edited here.

```bash
npm run spec:sync        # copy ../sprouts-py/spec (or: node scripts/sync-spec.mjs --from <dir>)
npm run generate         # regenerate src/openapi.gen.ts and src/error-codes.gen.ts
npm run check:generated  # spec matches PIN.json, generated files match the spec
```

`tests/spec.test.ts` holds the SDK to the vendored files (defaults, retry
table, error taxonomy, records, surface map), `tests/conformance.test.ts` runs
every case, and `tests/route-classes.test.ts` checks each wrapped route's
retry class. Hand-written request and response types live in
`packages/sdk/src/`; when the backend changes one, change it and add a test,
and do not mirror new server-side bounds locally (rule 4).

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `feat!:` for a
breaking change). One logical change per PR. Every behavioural change needs a
test and a `CHANGELOG.md` entry in the package it touches.

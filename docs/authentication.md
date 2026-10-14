# Authentication

## The header

The API authenticates with a custom header, not `Authorization: Bearer`:

```http
POST /v1/search HTTP/1.1
Host: api.sproutsdata.ai
X-API-Key: sk_dsp_live_…
Content-Type: application/json
```

The SDK sends the key in `X-API-Key` and nowhere else. The API also accepts a
dashboard-issued delegation token as `Authorization: Bearer …` on `/v1`; that is
a browser-side credential with a different lifetime and consent model, and this
SDK authenticates a key and only a key.

## Key format

```
sk_<platform>_<environment>_<secret>

sk_dsp_live_<secret>
sk_dsp_test_<your-key>
```

Issued keys use the `dsp` platform. The client checks the shape of the whole
key — `sk_`, a platform, `live` or `test`, then the secret — so a new platform
prefix works without a new release, and a key with a trailing newline (a common
copy-paste accident) is refused. The secret is base64url, so it contains `_`
and `-`: if you parse a key at all, split on the first three underscores only.

## Live and test keys

A key's environment is chosen when it is created and is part of the credential.
There is no environment parameter on requests: the key decides, and live and
test never mix. A **test** key is authenticated, metered and written to the
ledger exactly like a live one, but charged **zero credits**, against the same
records.

The prefix decides live or test only — not which deployment answers. The SDK
talks to the production API (`https://api.sproutsdata.ai`) for live and test
keys alike; to point it elsewhere, set `SPROUTSDATA_BASE_URL` or `baseUrl`.

Every response echoes which environment answered:

```ts
const page = await client.search({ query: 'fintech' });
page.meta.environment; // 'live' | 'test'
```

Use a test key in development and CI, and assert on `meta.environment` in
integration tests if mixing them up would be expensive for you.

## Scopes

Scopes are chosen per key at creation. An endpoint the key is not scoped for
returns `403 auth.insufficient_scope` (`PermissionDeniedError`): the key exists
and is valid, it was not granted that capability. Create a key with the scope
you need — scopes cannot be added to an existing key.

| Scope | Unlocks |
|---|---|
| `dsp.search.read` | `search()`, `similar()`, `filterValues()`, `documentFilterValues()` (and their `iter*` forms), `sorts()`, `coverage()`, `relationships.*()`, `orgChart.*()`, `members.resolve()` |
| `dsp.entities.read` | `entities.*()` |
| `dsp.usage.read` | `credits.retrieve()`, `credits.usage()`, `history.*()` |
| `dsp.agents.write` | `runs.create()`, `runs.cancel()` (and `members.resolve()`) |
| `dsp.agents.read` | `runs.retrieve()`, `wait()`, `list()`, `results()` and `events()` (also unlocked by `dsp.agents.write`) |
| `dsp.search.read` or `dsp.entities.read` | `lists.*()`, `searchExport()` |
| `dsp.search.read` or `dsp.usage.read` | `feedback.create()`, `feedback.list()`, `feedback.votes.*()` |
| *(any key, or none)* | `feedback.tags()` |

A key cannot create another key — key management is done from the dashboard by
a signed-in person, not over the API — so an integration has no way to
escalate.

## Lifecycle

- Keys **expire**: 365 days by default, 730 at most.
- The secret is shown **once**, at creation, and cannot be retrieved again.
- **Revocation is immediate** and permanent.
- **Rotate** by creating the new key, deploying it, then revoking the old one.

Key hygiene:

- Keep keys in a secrets manager and inject them as `SPROUTSDATA_API_KEY`. Never
  commit them.
- One key per integration or service, named for it — so revoking one does not
  take down another, and usage stays attributable.
- Grant each key only the scopes it needs.
- If a key may have leaked, revoke it in the dashboard first, then check
  `client.credits.usage()` on the replacement and the dashboard's per-key report
  for spend you do not recognise.

## Authentication failures are deliberately vague

No key, an unknown key and an expired session are answered identically — `401
auth.unauthorized` — so an anonymous caller cannot map the authentication model.
A caller who presented a malformed, unknown or revoked key is told
`auth.invalid_key`; an expired key is `auth.expired`. The real reason is logged
against the response's request id: quote `err.requestId` and support can answer
precisely.

## Keys are server-side credentials

An API key carries the tenant's whole credit balance, and a key shipped in
frontend JavaScript is a key in every visitor's developer tools. So:

- **The API** refuses any request that carries both an `Origin` header and an
  `X-API-Key` — `403 auth.browser_origin`, before the request reaches a route.
  There is no CORS allowlist and no browser-safe key format.
- **The SDK** throws at construction in a browser-like environment, with
  `dangerouslyAllowBrowser: true` as the explicit escape hatch for non-browser
  environments that look like one (an Electron main process, for example).

The architecture for a web app:

```
browser  ──(your auth)──▶  your server  ──(X-API-Key)──▶  Sprouts Data API
```

Your server holds the key and exposes only the operations your product needs.
If you see `auth.browser_origin` from a server-side call, something between you
and the API — a proxy, or a runtime shim — is adding the header.

What the SDK does to keep the key where it belongs:

- It is sent only in `X-API-Key`, which neither `defaultHeaders` nor per-call
  `headers` can override (nor `User-Agent`, nor an SDK-set `Idempotency-Key`),
  in any casing.
- `Origin` and `Referer` are refused in `defaultHeaders` and per-call `headers`
  with a `ClientValidationError`, since the API would answer 403.
- Redirects are never followed, so the key is never re-sent to wherever a
  redirect points; plain `http://` is refused except for `localhost` and
  `127.0.0.1`.
- `console.log(client)`, `util.inspect(client)` and `JSON.stringify(client)`
  show the key redacted (`sk_dsp_test_***`), never the secret.

## Configuration

```ts
const client = new SproutsData({
  apiKey: 'sk_dsp_test_<your-key>', // default: SPROUTSDATA_API_KEY
  baseUrl: 'https://…',             // default: SPROUTSDATA_BASE_URL, then https://api.sproutsdata.ai
  timeoutMs: 60_000,                // per attempt, to the last byte of the body
  maxRetries: 2,                    // see Errors and retries
  fetch: customFetch,               // bring your own fetch (proxies, tests)
  defaultHeaders: {},               // sent on every request; cannot override X-API-Key or User-Agent
  integration: 'my-agent/1.2.0',    // for a framework built on the SDK: sent as X-SproutsData-Client
  dangerouslyAllowBrowser: false,   // leave this alone
});
```

| Option | Environment variable | Default |
|---|---|---|
| `apiKey` | `SPROUTSDATA_API_KEY` | — (required) |
| `baseUrl` | `SPROUTSDATA_BASE_URL` | `https://api.sproutsdata.ai` |
| `timeoutMs` | — | `60000` |
| `maxRetries` | — | `2` |

An option wins over the environment. The pre-0.4 environment variable names
are still read when the new ones are unset, with a deprecation warning, until
1.0; the [changelog](../packages/sdk/CHANGELOG.md) lists them. The path prefix
is part of the base URL: `/v1` does not sit at the host root on every
deployment.

`timeoutMs` defaults to 60 seconds because `mode: 'auto'` runs a model in the
request path and takes tens of seconds on page 1.

The constructor fails fast — `ClientValidationError`, no network call — when
the key is missing or not key-shaped, when `baseUrl` is not `https://` (plain
`http://` is accepted only for `localhost` and `127.0.0.1`), when
`defaultHeaders` carries `Origin`, `Referer` or `X-SproutsData-Client` (set
that one with `integration`), when `integration` is not `<name>/<version>`, or
when the environment looks like a browser.

`client.withOptions({ timeoutMs, maxRetries, defaultHeaders, integration })`
returns a copy with those settings changed — same key, base URL and `fetch` —
and leaves the original as it is:

```ts
await client.withOptions({ maxRetries: 0 }).search({ query: '…' });
```

Every method also takes per-call options as its last argument; see
[Errors and retries](errors.md#retries-timeouts-and-cancellation).

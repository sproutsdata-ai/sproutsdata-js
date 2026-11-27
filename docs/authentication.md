# Authentication

## The header

The API authenticates each request with an API key in the `X-API-Key` header:

```http
POST /v1/search HTTP/1.1
Host: api.sproutsdata.ai
X-API-Key: sk_dsp_live_…
Content-Type: application/json
```

The SDK sends the key in `X-API-Key` and nowhere else.

## Key format

```
sk_dsp_live_<secret>
```

Keys are created in the Sprouts Data dashboard. The client checks the shape of
the key before it sends anything: `sk_dsp_live_`, then the secret, at most 200
characters. A key with a trailing newline (a common
copy-paste accident) is refused with a `ClientValidationError`. The secret may
contain `_` and `-`, so if you parse a key at all, split on the first three
underscores only.

## Every key is charged

Every key spends the workspace's credits; a new workspace starts with sign-up
credits for evaluation. Test keys (`sk_dsp_test_…`) were retired, and the server
no longer accepts them. The client refuses one when it is constructed, with a
`ClientValidationError` that says so, rather than letting the call fail with a
bare `401`.

Use a separate key for development and CI, so that it can be revoked without
affecting production. Every response says what it cost:

```ts
const page = await client.search({ query: 'fintech' });
console.log(page.meta.credits_charged);
```

The key does not decide which deployment answers. The SDK talks to
`https://api.sproutsdata.ai`; to point it elsewhere, set `SPROUTSDATA_BASE_URL`
or `baseUrl`.

## Scopes

Scopes are chosen per key when it is created. A call the key is not scoped for
throws `PermissionDeniedError` (403): the key is valid, but it was not granted
that capability.

| Scope | Calls |
|---|---|
| `dsp.search.read` | `search`, `similar` (and their `iter*` forms), `filterValues`, `documentFilterValues`, `sorts`, `coverage`, `relationships.*`, `orgChart.*` |
| `dsp.entities.read` | `entities.*` |
| `dsp.usage.read` | `credits.*`, `history.*` |
| `dsp.agents.write` | `runs.create`, `runs.cancel` |
| `dsp.agents.read` or `dsp.agents.write` | `runs.retrieve`, `runs.wait`, `runs.list`, `runs.results`, `runs.events` |
| `dsp.enrichment.write` | `enrichment.create`, `enrichment.cancel`, `enrichment.lookup` |
| `dsp.enrichment.read` or `dsp.enrichment.write` | `enrichment.retrieve`, `enrichment.wait`, `enrichment.list`, `enrichment.results` |
| `dsp.lists.read` | `lists.list`, `lists.items`, `lists.iterItems`, `lists.export` |
| `dsp.lists.write` | `lists.create`, `lists.rename`, `lists.delete`, `lists.addItems`, `lists.removeItems` |
| `dsp.search.read` or `dsp.entities.read` | `searchExport` |
| `dsp.search.read`, `dsp.entities.read` or `dsp.lists.read` | `exports.*` |
| `dsp.search.read` or `dsp.usage.read` | `feedback.*`, including `feedback.tags` and `feedback.votes.*` |

A key made with the default scopes has `dsp.search.read`, `dsp.entities.read`,
`dsp.lists.read`, `dsp.lists.write` and `dsp.usage.read`; keys made before the list
scopes existed were granted both. Whole records (in a lookup, a saved list or an
export) need `dsp.entities.read` and a workspace that has bought credits: any other
key or workspace sees the fields a search row has.

A key made with the default scopes has no `dsp.agents.*` or
`dsp.enrichment.*` scope. [Agent runs](runs.md) and
[enrichment](enrichment.md) need a key created with them.

A call that needs a workspace throws `WorkspaceRequiredError`, a subclass of
`PermissionDeniedError`.

## Lifecycle

- The secret is shown once, when the key is created. Store it in a secrets
  manager and inject it as `SPROUTSDATA_API_KEY`. Never commit it.
- Revoking a key takes up to about five minutes to apply everywhere.
- Keys can be rotated. Rotating a key issues a new key with the same name,
  scopes, environment and lifetime, and revokes the old one at the same
  moment. There is no overlap period: deploy the new key as soon as you rotate,
  because the old one stops working within the revocation window.
- Use one key per integration or service, named for it, so revoking one does
  not stop another, and grant each key only the scopes it needs.

## Authentication failures

Every key failure is the same answer: a missing, unknown, revoked or expired
key is a 401, thrown as `AuthenticationError`. The answer does not say which,
so a caller without a valid key cannot learn anything about the keys that
exist. Quote `err.requestId` to support for the reason.

```ts
import { AuthenticationError, PermissionDeniedError } from 'sproutsdata';

try {
  await client.credits.retrieve();
} catch (err) {
  if (err instanceof AuthenticationError) console.error('Check SPROUTSDATA_API_KEY', err.requestId);
  else if (err instanceof PermissionDeniedError) console.error('This key lacks dsp.usage.read', err.requestId);
  else throw err;
}
```

## Keys are server-side credentials

A key spends the workspace's credits, and a key shipped in frontend code is
readable by every visitor. A key is therefore never sent from a browser:

- **The API** refuses any key sent with an `Origin` header, with a plain 401
  (`AuthenticationError`).
- **The SDK** throws a `ClientValidationError` when it is constructed in a
  browser. There is no option to turn this off. It runs on servers: Node.js,
  Deno, Bun or an edge runtime.

For a web application, your server holds the key and calls the API; the browser
calls your server:

```
browser  --(your auth)-->  your server  --(X-API-Key)-->  Sprouts Data API
```

If a server-side call fails with 401 although the key is valid, check whether
something between your code and the API (a proxy, a runtime shim) adds an
`Origin` header.

What the SDK does to keep the key safe:

- It sends the key only in `X-API-Key`. `defaultHeaders` cannot replace it, nor
  any other header the SDK sets (`Accept`, `Content-Type`, `User-Agent`,
  `X-Request-Id`, `Idempotency-Key`, `Last-Event-ID`), in any casing.
- `Origin` and `Referer` are refused in `defaultHeaders` with a
  `ClientValidationError`.
- Redirects are never followed, so the key is never re-sent to wherever a
  redirect points (`RedirectRefusedError`). Plain `http://` is refused except
  for `localhost` and `127.0.0.1`.
- The key is held in a private field. `JSON.stringify(client)` and
  `util.inspect(client)` show it redacted (`sk_dsp_live_***`), never the
  secret.

## Configuration

```ts
import { SproutsData } from 'sproutsdata';

const client = new SproutsData({
  apiKey: 'sk_dsp_live_<your-key>', // default: SPROUTSDATA_API_KEY
  baseUrl: 'https://api.sproutsdata.ai', // default: SPROUTSDATA_BASE_URL, then this
  timeoutMs: 60_000, // per attempt
  maxRetries: 2, // see Errors and retries
  defaultHeaders: { 'X-Team': 'growth' }, // added to every request
  fetch: globalThis.fetch, // your own fetch (a proxy agent, a test double)
  onResponse: (meta) => console.log(meta.status, meta.requestId, meta.rateLimit.remaining),
});
```

| Option | Environment variable | Default |
|---|---|---|
| `apiKey` | `SPROUTSDATA_API_KEY` | none: required |
| `baseUrl` | `SPROUTSDATA_BASE_URL` | `https://api.sproutsdata.ai` |
| `timeoutMs` | | `60000` |
| `maxRetries` | | `2` |
| `defaultHeaders` | | none |
| `fetch` | | the global `fetch` |
| `onResponse` | | none |

An option wins over the environment. The older `DSP_API_KEY` and `DSP_BASE_URL`
are still read when the new names are unset, with a deprecation warning; they
stop being read at 1.0.

The constructor sends nothing. It throws `ClientValidationError` when the key
is missing or not a Sprouts Data key, when `baseUrl` is not an absolute
`https://` URL (plain `http://` only for `localhost` and `127.0.0.1`), when
`timeoutMs` is not a positive number, when `maxRetries` is negative or not a
whole number, when `defaultHeaders` sets `Origin`, `Referer` or a header the
SDK sets itself, or when it runs in a browser.

`onResponse` is called with the status, the request id, the headers (lower-case
names) and the rate limit of every successful answer. See
[Errors and retries](errors.md#response-details).

Every method also takes per-call options as its last argument (`signal`,
`timeoutMs`, `maxRetries`, `requestId`, `idempotencyKey`, `onResponse`); see
[Errors and retries](errors.md#retries-timeouts-and-cancellation).

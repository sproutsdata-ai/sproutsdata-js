# Security

## Reporting a vulnerability

Email **security@sprouts.ai** with a description, reproduction steps, and the
`request_id` of any relevant API call. Do not open a public issue.

Never paste an API key into an issue, a pull request, a discussion, or a log
excerpt. If you believe a key has been exposed, revoke it from the dashboard
first — revocation is effective immediately — then report.

## How these packages handle your API key

- The key is read from the `apiKey` option or the `SPROUTSDATA_API_KEY`
  environment variable, and is sent only in the `X-API-Key` request header.
  Neither `defaultHeaders` nor per-call `headers` can override that header, in
  any casing.
- It is held in an ECMAScript `#private` field. `util.inspect`,
  `console.log` and `JSON.stringify` of the client show it redacted
  (`sk_dsp_live_***`), and it is never included in an error message.
- Redirects are never followed (`redirect: 'error'`), so the key is never
  re-sent to wherever a redirect points. A redirect throws `RedirectRefusedError`
  (or, from a custom `fetch` that hands it back, an `APIError` with its 3xx status).
- `baseUrl` must be `https://`. Plain `http://` is accepted only for
  `localhost` and `127.0.0.1`, for local development.
- The SDK checks only the key's *shape* locally (`sk_dsp_live_<secret>`; a
  retired `sk_dsp_test_` key is refused before anything is sent); it never
  transmits the key anywhere except to the configured `baseUrl`.

## API keys are server-side credentials

The Sprouts Data API rejects any request that carries both an `Origin` header
and an `X-API-Key`, with `403 auth.browser_origin`, before the request reaches a
route. There is no CORS allowlist and no browser-safe key format.

This is deliberate. A key in a browser is a key in every visitor's devtools.
Call the API from a server you control, and expose only the results to your
frontend. The packages enforce it on their side too:

- `new SproutsData()` throws in a browser-like environment unless you pass
  `dangerouslyAllowBrowser: true` (for environments that only look like a
  browser, such as an Electron main process). The LangChain and AI SDK
  adapters build their client when the tools are made, so they refuse a
  browser at construction too.
- `Origin` and `Referer` are refused in `defaultHeaders` and per-call
  `headers` with a `ClientValidationError`, and the SDK never sets either.

## Key hygiene

- Every key is a live key, and its calls are charged. Use a separate key for
  development and CI, so that it can be revoked without affecting production.
- Keys expire — 365 days by default, 730 maximum. There is no non-expiring key.
- The secret is shown once, at creation, and is unrecoverable afterwards. Store
  it in your secret manager, not in the repository. `.env` files are ignored
  by this repository's `.gitignore`; keep it that way.
- Rotate by creating a new key, deploying it, then revoking the old one.
- Scope keys to what they need: `dsp.search.read`, `dsp.entities.read`,
  `dsp.usage.read`, `dsp.agents.read` / `dsp.agents.write`. A key cannot create
  another key.

## Secret scanning

Sprouts API keys match `sk_dsp_live_[A-Za-z0-9_-]+`. Keys issued before test keys
were retired may read `sk_dsp_test_…`; scan for `sk_dsp_(live|test)_[A-Za-z0-9_-]+`
to catch both. If you operate a fork or a mirror, enable push protection
with that pattern so a key cannot be committed.

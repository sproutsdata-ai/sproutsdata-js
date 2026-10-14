# Errors and retries

## The hierarchy

Everything the SDK throws is a `SproutsDataError`. The families:

1. **`ClientValidationError`** — the SDK refused the call locally; nothing was
   sent, nothing was billed. Fix the call.
2. **`APIConnectionError` / `APITimeoutError` / `APIUserAbortError`** — no
   response was received. `reachedServer` is `false` only when the request
   provably never left your process; `true` means it may have arrived.
3. **`APIResponseValidationError`** — a success status with a body the SDK
   cannot read. The request was processed (and, if billed, charged).
4. **`RunWaitTimeoutError`** — `runs.wait` passed its deadline; `.run` is the
   last polled state.
5. **`APIError` subclasses** — the server answered with an RFC 9457 problem.
   Every instance carries `.status`, `.code` (a stable machine-readable string),
   `.title`, `.detail`, `.requestId` (the `X-Request-Id` header, else the
   body's), `.fieldErrors` (from `extra.errors`), `.retryAfter`, and the raw
   `.problem` body.

The class is chosen by `code` first, then by HTTP status, then `APIError` — so a
code or status this release has never seen still maps, and mapping never throws,
even on a proxy's HTML page.

## Handling

```ts
import {
  APIConnectionError,
  AuthenticationError,
  ErrorCode,
  InsufficientCreditsError,
  InvalidRequestError,
  PermissionDeniedError,
  RateLimitError,
} from 'sproutsdata';

try {
  await client.search({ query: 'fintech' });
} catch (err) {
  if (err instanceof RateLimitError) {
    // 429 quota.* — already retried within maxRetries; err.retryAfter is in seconds
  } else if (err instanceof InsufficientCreditsError) {
    // 402 — commercial, not transient: waiting does not help, buying does
    console.error(`need ${err.required}, have ${err.available}`);
  } else if (err instanceof PermissionDeniedError) {
    if (err.code === ErrorCode.AUTH_INSUFFICIENT_SCOPE) {
      // the key is valid but lacks the scope — create a key with it
    }
  } else if (err instanceof AuthenticationError) {
    // 401 — key missing, unknown, revoked or expired: rotate the credential
  } else if (err instanceof InvalidRequestError) {
    console.error(err.message, err.fieldErrors); // the message names the fields
  } else if (err instanceof APIConnectionError) {
    // no response. If err.reachedServer is true on a billed call, it may have
    // been charged, which is why it was not retried
  } else {
    throw err;
  }
}
```

Two rules worth keeping:

- **`code` is the contract, `detail` is prose.** Branch on `err.code` (the full
  closed set is exported as `ErrorCode`); log `detail` for people.
- **Always log `err.requestId`.** It is the only handle support can start from,
  and it is on successes too (`page.meta.request_id`).

To correlate a call with your own logs, give it your id: `{ requestId: 'job-42' }`
in its options is sent as `X-Request-Id`, and the server answers with it in
`meta.request_id` and on any error. It must be 1–128 characters of letters,
digits, `_`, `.`, `:` and `-` — the server silently replaces anything else with
its own id — so the SDK refuses any other value, and a raw `X-Request-Id`
header, with a `ClientValidationError`. A page iterator sends it with the first
page only, since every request needs its own id.

## Validation detail

An `InvalidRequestError` names each offending field in its message, as the
server located it, so a refused parameter is identifiable from the stack trace
alone:

```
Invalid request (request.invalid) — One or more fields failed validation. — body.limt: Extra inputs are not permitted
```

The same detail is on `err.fieldErrors`, the problem document's `extra.errors`
as the server sent it (`{ loc, msg, … }` entries):

```ts
for (const error of err.fieldErrors) console.log(error.loc, error.msg);
```

Where the field path appears depends on the rule:

- **A field the schema checks** is located at its own path: `loc` is
  `['body', 'limt']`.
- **A rule that spans the request** — `company` and `person` filter names and
  shapes, sort fields — is located at `['body']` and names the field in `msg`:
  `body: Value error, filters.employee_count.gt: Extra inputs are not permitted`.
- **Document-category filters and sorts** are checked by the retrieval engine
  rather than the API. Its refusal is a `422 request.invalid` with the engine's
  text as `detail` and an empty `fieldErrors`, so it may not say which key was
  wrong.

## What each error means, and what to do

| You caught | Status / `code` | What happened | What to do |
|---|---|---|---|
| `ClientValidationError` | — | Bad call shape; never sent | Fix the parameters |
| `AuthenticationError` | 401 `auth.unauthorized`, `auth.invalid_key`, `auth.expired` | Key missing, unknown, revoked or expired | Check the environment variable; rotate the key in the dashboard |
| `PermissionDeniedError` | 403 `auth.insufficient_scope` | Valid key, missing scope | Create a key with the scope |
| `PermissionDeniedError` | 403 `auth.browser_origin` | The request carried a browser `Origin` | Move the call server-side — see [Authentication](authentication.md#keys-are-server-side-credentials) |
| `InsufficientCreditsError` | 402 `credits.insufficient` | Credit allocation exhausted; has `available`, `required`, `actionType` | Waiting does not help. Buy or reallocate credits |
| `InvalidRequestError` | 400 / 415 / 422 `request.invalid`, `request.unsupported` | Invalid parameters — see [Validation detail](#validation-detail) | Fix the request |
| `CursorInvalidError` / `CursorExpiredError` | 422 `pagination.cursor_invalid` / `pagination.cursor_expired` | The request changed between pages, or the cursor is too old | Restart from page one |
| `PaginationDepthExceededError` | 422 `pagination.depth_exceeded` | Paged past 10,000 rows | Narrow the search |
| `InvalidRequestError` | 422 `relationship.anchor_ambiguous` | A relationship anchor names something the corpus holds more than one of | Pick one of the options in `err.problem` and send it with an explicit `kind` / `by` |
| `InvalidRequestError` | 404 `request.invalid` | An unknown agent run id (this route has no dedicated not-found code) | Branch on `err.status === 404` |
| `NotFoundError` | 404 `history.not_found` | Unknown or foreign history id | The id is wrong, or belongs to another credential |
| `NotFoundError` | 404 `feedback.subject_not_found` | A feedback report's subject is not one of this caller's requests or runs | Use the `meta.request_id` (or `run_id`) of a call this key made |
| `NotFoundError` | 404 `lists.not_found` | The list does not exist, was deleted, or belongs to another workspace | Check `client.lists.list()` |
| `NotFoundError` | 404 `export.not_enabled` | CSV export is switched off on this deployment | Not transient — do not retry |
| `ConflictError` | 409 `lists.item_cap_reached` | A free workspace's saved-items cap would be exceeded; nothing was added. `err.problem.extra` has `cap`, `saved`, `adding` | Save fewer records, or remove some first |
| `IdempotencyConflictError` (a `ConflictError`) | 409 `idempotency.in_flight`, or a 409 with no code | A request with the same `Idempotency-Key` is still being processed | Wait for the original |
| `RequestTooLargeError` | 413 `request.too_large` | The body is over the server's size limit | Send fewer ids or a smaller list |
| `RateLimitError` | 429 `quota.burst_exceeded` | Too many calls to one operation from this workspace this minute; `err.problem.extra` has `limit`, `window`, `operation` | Back off `retryAfter` seconds (the SDK already did, up to `maxRetries`, for waits of 60 s or less) |
| `RateLimitError` | 429 `quota.concurrency_exceeded` | Too many agent runs live at once | Wait for one to finish |
| `RateLimitError` | 429 `quota.daily_exhausted` / `quota.monthly_exhausted` | A hard quota for the period | Stop until the period resets; the SDK raises at once rather than sleep past 60 s |
| `InternalServerError` | 500 `internal` | The platform failed | Already retried (except on `feedback.create`). If it persists, contact support with the `requestId` |
| `InternalServerError` | 500 `credits.unknown_action` | The server has no price for the action — a misconfiguration | Never retried; contact support with the `requestId` |
| `FeatureNotAvailableError` | 501 `not_implemented` | Not available for this request: a cursor on a `deep` search, or an org chart on a deployment without one | Not transient — do not retry |
| `ServiceUnavailableError` | 503 `upstream.unavailable`, `auth.unavailable`, `credits.unavailable`, `feedback.unavailable`, `lists.unavailable` | A dependency is down; a billed call answered before its charge (for `credits.unavailable`, the charge may or may not have landed) | Already retried; try again later |
| `UpstreamTimeoutError` | 504 `upstream.timeout` | An upstream timed out; the work was abandoned and not billed | Already retried; narrow the request if it recurs |
| `APIError` | 502, or any status with no class | A proxy or load balancer answered, often with HTML | Free calls were retried; a billed call was not (it may have been charged) |
| `APITimeoutError` | — | No response (headers or body) within `timeoutMs` | Check your network. On a billed call the request may already have been charged, so it was not retried |
| `APIConnectionError` | — | No response: DNS, TCP or TLS failure, or a refused redirect | Check `baseUrl` (a redirect means it is not the API origin) and your network. `reachedServer: false` means nothing was sent |
| `APIResponseValidationError` | 2xx | The response body was not the JSON expected | Contact support with the `requestId` |
| `RunWaitTimeoutError` | — | `runs.wait` passed its deadline | The run continues; wait again, or `runs.cancel` |

## Retries, timeouts, and cancellation

Out of the box the SDK makes up to `maxRetries` (default 2) more attempts after
a failure, with full-jitter backoff: a random 0–0.5 s before the first retry,
doubling to at most 8 s. A server `Retry-After` (seconds or an HTTP date)
replaces the backoff and is honoured in full up to 60 s; a longer one — a daily
quota resetting hours away — is raised at once with `err.retryAfter` set, never
slept through.

**What is retried depends on what repeating the call costs.** Every route
belongs to one class:

| Class | Routes | Repeating it… |
|---|---|---|
| `safe` | every `GET`, `runs.cancel`, `members.resolve`, `feedback.votes.cast`, `lists.rename` / `addItems` / `removeItems` | costs nothing, and changes nothing the first call did not |
| `billed` | `search`, `similar`, `entities.*`, `relationships.*`, `orgChart.*`, and `lists.export` / `searchExport` (free today, priced through the same meter once export pricing ships) | may charge again — the server charges once the work is done, and recognises a same-day repeat with the same `Idempotency-Key` only when it returns the same rows |
| `keyed` | `runs.create` | is recognised by its `Idempotency-Key` |
| `once` | `feedback.create`, `lists.create`, `lists.delete` | files the report, or makes the list, twice — or answers `lists.not_found` for a list the first call deleted |

| Failure | `safe` | `billed` | `keyed` | `once` |
|---|---|---|---|---|
| Never sent: connection refused, DNS failure, connect timeout | retry | retry | retry | retry |
| Sent, no answer: a timeout, a dropped connection, a 502 or 408 | retry | **raise** | retry | **raise** |
| 429 with `Retry-After` ≤ 60 s or none; 503; 504 | retry | retry | retry | retry |
| 500 (except `credits.unknown_action`) | retry | retry (same key) | retry | raise |
| 400, 401, 402, 403, 404, 409, 413, 415, 422, 501, `credits.unknown_action`, a 429 beyond 60 s | raise | raise | raise | raise |

"Never sent" is known only when the runtime says so (`err.cause.code` is
`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN` or `UND_ERR_CONNECT_TIMEOUT`); any
other failure is treated as possibly sent. When a billed or `once` call is
raised from that row, the error has `reachedServer: true` and its message says
a charge — or a filed report, or a new list — may have happened. Check
`client.history.list()` (or `client.feedback.list()`, `client.lists.list()`)
before trying again by hand. `maxRetries: 0`
switches retrying off entirely.

**Timeouts cover the whole response.** `timeoutMs` bounds each attempt from
sending to the last byte of the body, so a response that stalls mid-body times
out like one that never started. It is per attempt: with `maxRetries: 2` an
unresponsive network can take about three times the timeout (plus backoff)
before the final error. Pass your own `AbortSignal` for a hard wall-clock
ceiling.

**Redirects are never followed.** A 3xx raises `APIConnectionError`, so the key
is never re-sent to wherever a redirect points. It is never retried.

Two special cases:

- **The run event stream** (`runs.events`): retries and `timeoutMs` apply only
  until the stream opens. After that the caller's `AbortSignal` is the way out,
  and 60 s without a byte (the server sends a heartbeat every 15 s) raises
  `APITimeoutError` with `lastEventId` to resume from.
- **`runs.wait`** has its own whole-wait deadline (`timeoutMs`, default 15
  minutes) on top of each poll's per-attempt timeout, and raises
  `RunWaitTimeoutError` when it passes.

```ts
// Client-wide
const client = new SproutsData({ maxRetries: 3, timeoutMs: 30_000 });

// Per request — every method takes options as its last argument
await client.search({ query: 'fintech' }, { timeoutMs: 30_000, maxRetries: 0 });

// Cancellation with a standard AbortSignal
const controller = new AbortController();
const pending = client.search({ query: 'fintech' }, { signal: controller.signal });
controller.abort(); // pending rejects with APIUserAbortError; retries stop too
```

## Idempotency keys

The server **requires** an `Idempotency-Key` when creating an agent run, and
recognises a repeat of one — which is what makes `runs.create` safe to retry
after a lost response. The SDK sends the `idempotencyKey` you pass, or generates
`sdk-<32 hex>` for the call, and resends the same key on every retry of that
call. Pass your own when a retry may come from somewhere the SDK cannot see:
another process, or a job re-queued after a crash.

The server replays the first run for a key it has already seen and ignores the
new body, so a key names one question: reuse it to retry, and use a new one to
ask something different. See [Agent runs](runs.md#start).

Billed calls carry one too: the SDK generates `sdk-<32 hex>` once per call
(each page of an iteration is a call of its own) and resends it on that call's
retries; a key you put in `headers` is used instead. The server recognises a
same-day repeat of a billed call with the same key as already paid when it
returns the same rows; one that returns different rows is charged for them,
which is why a billed call's "sent, no answer" outcome is raised rather than
retried. The key ties a call's retries to one billing session for the UTC day;
it does not replay the first response, and the work runs again. Free routes and
the `once` routes send none.

## Rate limits

The API limits each workspace per operation (`POST /v1/search` is one,
`PUT /v1/feedback/votes` another) in one-minute windows. Every call it counts
carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`
(seconds until the window resets); on an error they are in `err.headers`.
Going over is `429 quota.burst_exceeded` with a `Retry-After` of at most a
minute, which the SDK waits out and retries like any other 429. Polling a run
(`runs.retrieve`, `results`, `events`) is never counted.

## Troubleshooting

**"Missing API key" at construction** — `SPROUTSDATA_API_KEY` is not set in the
process actually running (a common miss in containers and CI). Pass `apiKey`
explicitly to confirm, then fix the environment.

**401 on every call, and the key looks right** — the key may be revoked or
expired. Keys are listed in the dashboard with their expiry and revocation
dates. Secrets are unrecoverable; if in doubt, create a new key.

**403 `auth.insufficient_scope` on `credits.usage()` but `search()` works** —
the key was created without `dsp.usage.read`. Scopes are fixed at creation;
create a key with both.

**422 on a request that "worked yesterday"** — the API refuses unknown
parameters rather than ignoring them, and refuses meaningless combinations
(domain lists on `patent`, `similar` on a non-company category). Read
`err.message`: it carries the server's detail and every field path.

**A 422 about batch size on an entity lookup** — a lookup with `by` set, or a
named-document lookup by name, takes at most 50 ids per call; record-id lookups
take 1000 (companies and people) or 100 (documents). Split the batch.

**`pagination.cursor_invalid` mid-loop** (`CursorInvalidError`) — a cursor was
sent with a different request: typically a hand-written loop that rebuilt the
params, or a cursor saved from one search and replayed on another. The `*Pages`
iterators send a copy taken before the first page, so editing your params
object cannot cause it. See [Pagination](pagination.md).

**Results seem incomplete** — check `degradation[]` before assuming a bug. A
corpus timeout or incomplete vector coverage is reported there, with
`impact: 'recall'`.

**Empty results for a category that "should" have data** — not every category
has an index behind it in every deployment. Check
`client.coverage({ category })` for what is held.

**`deep` searches seem shallow** — a deep search runs at the agent's minimal
effort tier within one request; a larger `timeoutMs` does not change that. For
exhaustive research, start an [agent run](runs.md).

**An entity lookup "succeeded" but some records are empty** — check `found` on
each hit. An unknown id comes back as `found: false` with `matches: []`.

**A lookup with a search hit's `id` finds nothing** — a company or person hit's
`id` is not a record id. Pass the hit to `lookupRef(hit)` and look it up by
domain or LinkedIn URL ([Quickstart](quickstart.md#from-a-search-hit-to-its-full-record)).

**A news, funding, market-report or job-opening lookup finds nothing for ids
from a search** — make sure you are not sending `by: 'name'`, which reads each
entry as free text. The SDK sends `by: 'id'` unless told otherwise.

**An agent run's `credits_charged` stays null** — the run has not settled.
Billing settles when a finished run is *read*: call `client.runs.retrieve(id)`
(or let `runs.wait` do it). Streaming `events()` alone never settles a run.

**`runs.events()` ended without `run.done`** — the connection dropped. Reconnect
with `client.runs.events(id, { lastEventId })`; the server replays only what
followed.

**Where do I report a problem?** — Contact your Sprouts representative with the
failing call's request id (`err.requestId` on errors, `page.meta.request_id` on
successes). Every server-side log line is keyed to it.

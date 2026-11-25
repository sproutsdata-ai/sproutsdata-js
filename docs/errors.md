# Errors and retries

## The hierarchy

Everything the SDK throws is a `SproutsDataError`. The families:

1. **`ClientValidationError`**: the SDK refused the call locally. Nothing was
   sent and nothing was charged. Fix the call.
2. **`APIConnectionError`**, its subclass **`APITimeoutError`**, and
   **`APIUserAbortError`**: no answer arrived. `reachedServer` is `false` only
   when the request provably never left the process; `true` means it may have
   arrived.
3. **`RedirectRefusedError`**: the server answered with a redirect, which the
   SDK never follows. Check `baseUrl`.
4. **`APIResponseValidationError`**: a success the SDK cannot read (`status`,
   `requestId`). The request was processed.
5. **`WaitTimeoutError`**: `runs.wait` or `exports.wait` gave up before the
   work settled. The work goes on server-side; `last` is the last state seen.
6. **`ExportFailedError`**: an export job ended `failed`; `job` is its last
   state and `job.error` says why.
7. **`APIError`** and its subclasses: the server answered with an error. Every
   instance carries `status`, `code`, `concept`, `title`, `detail`, `nextStep`,
   `requestId`, `fieldErrors`, `extra`, `retryAfter`, `headers` and the raw
   `body`. `concept` is the kind of failure in the names both SDKs share
   (`rate_limit`, `gateway`, …), by `code`, else by status. `detail` says what went
   wrong; `nextStep`, when the server gave one, is one sentence on what to do about
   it, and follows `detail` in `err.message`.

The class of an `APIError` is chosen by `code` first, then by HTTP status, so a
code this release has not seen still maps to a class, and mapping never throws,
even on a proxy's HTML page.

## Handling

```ts
import {
  APIConnectionError,
  AuthenticationError,
  InsufficientCreditsError,
  InvalidRequestError,
  PermissionDeniedError,
  RateLimitError,
  WalletFrozenError,
} from 'sproutsdata';

try {
  await client.search({ query: 'fintech companies in Germany' });
} catch (err) {
  if (err instanceof RateLimitError) {
    // 429: already retried within maxRetries. err.retryAfter is in seconds.
    console.warn(`rate limited on ${err.operation ?? 'this operation'}; retry in ${err.retryAfter ?? '?'} s`);
  } else if (err instanceof WalletFrozenError) {
    // 402 credits.wallet_frozen: contact support. Check it before its parent class.
    console.error('The wallet is frozen', err.requestId);
  } else if (err instanceof InsufficientCreditsError) {
    // 402: waiting does not help; the workspace needs credits.
    console.error(`need ${err.requiredCredits ?? '?'}, have ${err.availableCredits ?? '?'}`);
  } else if (err instanceof PermissionDeniedError) {
    // 403: the key is valid but lacks the scope.
  } else if (err instanceof AuthenticationError) {
    // 401: the key is missing, unknown, revoked or expired.
  } else if (err instanceof InvalidRequestError) {
    console.error(err.message, err.fieldErrors);
  } else if (err instanceof APIConnectionError) {
    // No answer, after the retries a keyed call gets. reachedServer: true means it may have arrived.
    console.error(err.message, err.reachedServer);
  } else {
    throw err;
  }
}
```

Two rules worth keeping:

- **Branch on the class or on `err.code`, never on `title` or `detail`.** The
  code is the contract; `title` and `detail` are prose for people and may be
  reworded.
- **Log `err.requestId`.** Support starts from it. A success carries it too,
  as `page.meta.request_id`.

To tie a call to your own logs, give it your id: `{ requestId: 'job-42' }` in
its options is sent as `X-Request-Id`, and the server answers with it. It must
be 1 to 128 characters of letters, digits, `_`, `.`, `:` and `-`, since the
server replaces anything else with its own id; the SDK refuses any other value
with a `ClientValidationError`. An `iter*` walk sends it with the first page
only.

## Validation detail

Most invalid requests never leave your process. The SDK checks each request
body against the server's own request models before sending it: unknown fields,
missing required fields, values outside the server's limits, closed values, and
the cross-field rules (such as `query` with `keyword_query`, or a removed
option such as `mode: 'deep'`). A refusal is a `ClientValidationError` whose message names the
call and the field:

```
search: filters.employee_count.gt: not a field this request takes
```

What the server refuses after that is an `InvalidRequestError` (422). Its
message carries the server's detail, and `err.fieldErrors` lists each problem
as `{ loc, msg, type? }` (`loc` is `[]` for a problem with the whole request):

```ts
import { InvalidRequestError } from 'sproutsdata';

try {
  await client.search({ query: 'battery recycling' });
} catch (err) {
  if (!(err instanceof InvalidRequestError)) throw err;
  for (const problem of err.fieldErrors) console.log(problem.loc.join('.'), problem.msg);
}
```

## What each error means, and what to do

| You caught | Status, `code` | What happened | What to do |
|---|---|---|---|
| `ClientValidationError` | | Refused locally; nothing sent | Fix the parameters |
| `AuthenticationError` | 401 `auth.unauthorized` | The key is missing, unknown, revoked or expired, or was sent with an `Origin` header | Check the key; see [Authentication](authentication.md) |
| `PermissionDeniedError` | 403 `auth.insufficient_scope` | Valid key, missing scope | Use a key with the scope |
| `WorkspaceRequiredError` | 403 `auth.workspace_required` | The call needs a workspace | Choose a workspace |
| `InsufficientCreditsError` | 402 `credits.insufficient` | The workspace cannot pay; nothing was charged. `availableCredits`, `requiredCredits` | Add credits; waiting does not help |
| `WalletFrozenError` | 402 `credits.wallet_frozen` | Sprouts froze the wallet; nothing can be charged | Contact support |
| `InvalidRequestError` | 400, 413, 415 or 422 `request.invalid` | Invalid parameters; see [Validation detail](#validation-detail) | Fix the request |
| `InvalidRequestError` | 422 `request.unsupported` | A relationship question the network cannot answer as asked; `extra.kind`, `extra.try_instead` | Reword the question |
| `InvalidRequestError` | 422 `relationship.anchor_not_found`, `relationship.anchor_ambiguous` | A relationship anchor matched nothing, or several (`extra.candidates`) | Name it more precisely |
| `InvalidRequestError` | 422 `lists.category_mismatch` | An item of another kind than the list holds | Add records of the list's kind |
| `InvalidRequestError` | 422 `export.too_large` | More rows than one export may hold | Export a narrower range |
| `OrgChartCompanyAmbiguousError` | 422 `org_chart.company_ambiguous` | The domain or page names several companies; nothing was charged. `candidates` | Call again with a `company_ref`; see [Org charts](org-chart.md#an-ambiguous-company) |
| `CursorInvalidError` | 422 `pagination.cursor_invalid` | The cursor does not belong to this request | Resend it with the same arguments, or start again |
| `CursorExpiredError` | 422 `pagination.cursor_expired` | The cursor is over 24 hours old | Start again from page 1 |
| `PaginationDepthExceededError` | 422 `pagination.depth_exceeded` | Past 10,000 results | Narrow the request |
| `NotFoundError` | 404 `agents.run_not_found`, `history.not_found`, `feedback.not_found`, `lists.not_found`, `export.not_found` | No such resource for this workspace | Check the id |
| `NotFoundError` | 404 `feedback.subject_not_found` | The request a report names is not (yet) in the history | Report again shortly; see [Feedback](feedback.md) |
| `ResultsExpiredError` | 410 `agents.results_expired`, `enrichment.results_expired` | A run's or an enrichment job's rows are no longer kept; a `NotFoundError` | Start the run or the job again |
| `InvalidRequestError` | 422 `relationship.filter_value_unknown` | A department or seniority the taxonomy does not hold; `extra.allowed` lists the values | Use one of `extra.allowed` |
| `ListNameTakenError` | 409 `lists.name_taken` | The workspace already has a list by that name | Choose another name |
| `ConflictError` | 409 `lists.item_cap_reached` | Over a list size limit; nothing was added | Save fewer records |
| `RateLimitError` | 429 `quota.burst_exceeded` | Over a per-minute limit. `limit`, `window`, `operation`, `scope` | Wait `retryAfter` seconds (the SDK already did, within the cap) |
| `ConcurrencyLimitError` | 429 `quota.concurrency_exceeded` | The key already has as many agent runs going as it may (two), or the engine is full; a `RateLimitError`, thrown at once | Follow or cancel a run, then start again |
| `InternalServerError` | 500 `internal` | An unexpected server error | Retried where safe; quote `requestId` if it persists |
| `FeatureNotAvailableError` | 501 `not_implemented` | The server cannot do this yet (today: listing runs) | Not transient |
| `ServiceUnavailableError` | 503 `service.unavailable`, `service.overloaded`, `upstream.unavailable`, `auth.unavailable`, `credits.unavailable` | The API or a service behind it is unavailable; the API answered before doing the work, so nothing was charged | Retried; try again later |
| `CreditsRefusedError` | 503 `credits.refused` | The credits ledger refused to hold credits for a run or an enrichment job; nothing ran or was charged. A `ServiceUnavailableError`, never retried | Contact support with `requestId` |
| `UpstreamTimeoutError` | 504 `upstream.timeout` | The work did not finish in time; the API abandoned it before any charge | Retried (not a list create or delete); narrow the request if it recurs |
| `GatewayError` | 408, 502, 504 without the API's code | A gateway in front of the API answered instead of the API: it gave up waiting, or the API's answer did not reach it. The work may still finish and be charged | Retried where a repeat is free or carries its key; otherwise the message says what may have happened |
| `APITimeoutError` | | No answer within `timeoutMs` | Check the network; see below for billed calls |
| `APIConnectionError` | | DNS, TCP or TLS failure, or a broken event stream (`lastEventId`) | Check `baseUrl` and the network |
| `RedirectRefusedError` | 3xx | The server redirected | Set `baseUrl` to the API origin itself |
| `APIResponseValidationError` | 2xx | A success the SDK cannot read | Quote `requestId` to support |
| `WaitTimeoutError` | | A `wait` gave up; the work goes on | Wait again, or cancel the run |
| `ExportFailedError` | | An export job failed | Read `err.job`; export again |

## Retries, timeouts, and cancellation

The SDK makes up to `maxRetries` (default 2) more attempts after a failure,
with full-jitter backoff: a random wait up to 0.5 s before the first retry,
doubling to at most 8 s. A server `Retry-After` of up to 60 seconds replaces
the backoff and is waited out in full; a longer one is raised at once, with
`err.retryAfter` set.

**What is retried depends on what repeating the call costs.** Every operation
belongs to one class:

| Class | Operations | Repeating it |
|---|---|---|
| `safe` | every read, `runs.cancel`, `enrichment.cancel`, `feedback.votes.cast`, `lists.rename`, `lists.addItems`, `lists.removeItems`, `lists.export`, `searchExport` | costs nothing and changes nothing the first call did not |
| `billed` | none today: every billed call reads an `Idempotency-Key` and is `keyed` | may charge again |
| `keyed` | `search`, `similar`, `entities.*`, `relationships.find` / `reach` / `institutions` / `ask`, `orgChart.retrieve` / `departments` / `locations` / `people`, `runs.create`, `enrichment.create`, `enrichment.lookup`, `feedback.create` | is recognised by its `Idempotency-Key`: a billed call is charged once |
| `once` | `lists.create`, `lists.delete` | makes a second list (409), or answers 404 for the list the first call deleted |

| Failure | `safe` | `billed` | `keyed` | `once` |
|---|---|---|---|---|
| 429 `quota.concurrency_exceeded`, 503 `credits.refused` | raise | raise | raise | raise |
| 504 `upstream.timeout` | retry | retry | retry | **raise** |
| Never sent: connection refused, DNS failure, connect timeout | retry | retry | retry | retry |
| Sent, no answer: a timeout, a dropped connection, a gateway's 408, 502 or 504 | retry | **raise** | retry | **raise** |
| 429 with `Retry-After` of 60 s or less | retry | retry | retry | retry |
| 429 with a longer `Retry-After` | raise | raise | raise | raise |
| 500 | retry | retry | retry | raise |
| 503 | retry | retry | retry | retry |
| 400, 401, 402, 403, 404, 405, 409, 410, 413, 415, 422, 501 | raise | raise | raise | raise |

"Never sent" is known only when the runtime says so (`ECONNREFUSED`,
`ENOTFOUND`, `EAI_AGAIN` or `UND_ERR_CONNECT_TIMEOUT` in the error's cause
chain); any other failure counts as possibly sent. A `keyed` call is repeated
with the key it was first sent with: on a search, look-alike, lookup,
relationships or org chart call, the same key on the same request, from the same
credential, on the same UTC day, is charged once (the repeat answers
`meta.credits_charged: 0`). A `once` call raised from the "sent, no answer" row
(`reachedServer: true`, or a `GatewayError`) has a message that says what may have
happened. Check
`client.lists.list()` before trying again. `maxRetries: 0` turns retrying off.

**`timeoutMs` is per attempt.** With `maxRetries: 2`, an unresponsive network
can take about three times the timeout, plus backoff, before the final error.
Pass your own `AbortSignal` for a hard limit on the whole call.

**Redirects are never followed.** A 3xx throws `RedirectRefusedError` and is
never retried, so the key is never sent to wherever a redirect points.

**Event streams.** On `runs.events`, retries and `timeoutMs` apply until the
stream opens. After that, 60 seconds without data throws `APITimeoutError`, and
a broken stream throws `APIConnectionError`; both carry `lastEventId` to resume
from. See [Agent runs](runs.md#follow-it-as-it-happens).

```ts
import { SproutsData } from 'sproutsdata';

// For every call of this client
const patient = new SproutsData({ maxRetries: 3, timeoutMs: 30_000 });

// For one call: every method takes options as its last argument
await client.search({ query: 'fintech' }, { timeoutMs: 30_000, maxRetries: 0 });

// Cancellation with a standard AbortSignal
const controller = new AbortController();
const pending = client.search({ query: 'fintech' }, { signal: controller.signal });
controller.abort(); // pending rejects with APIUserAbortError, and retries stop too
await pending.catch(() => undefined);
console.log(JSON.stringify(patient));
```

## Idempotency keys

Every `keyed` operation sends an `Idempotency-Key`: `runs.create` and
`enrichment.create`, where the server requires one, and `enrichment.lookup`,
`feedback.create` and the billed calls (search, look-alikes, entity lookups,
relationships, org charts). The SDK sends the `idempotencyKey` you pass in the
call's options (1 to 255 printable characters; a billed call's server takes 1 to
120 letters, digits or `._:-`), or generates `sdk-<32 hex>`, and resends the same
key on every retry of that call. That is what makes them safe to retry after a
lost answer. Pass your own key when a retry may come from somewhere the SDK
cannot see, such as another process or a job queued again after a crash. A page walk
(`iterSearch` and the other `iter*`) sends your key with its first page only: each
later page is its own call, with a key of its own.

Every other operation takes no key: passing `idempotencyKey` to one throws a
`ClientValidationError`.

## Rate limits

The API limits calls per endpoint, by default 60 a minute. Going over is a 429
(`RateLimitError`) with a `Retry-After`, which the SDK waits out and retries
like any other 429 within the 60-second cap. `RateLimitError` reads `limit`,
`window`, `operation` and `scope` from the answer.

A key may also have two agent runs going at once. Starting a third answers 429
`quota.concurrency_exceeded`, thrown as `ConcurrencyLimitError` (a `RateLimitError`) at
once: a run takes minutes, so waiting out its `Retry-After` rarely frees a place. Follow
a run to its end or cancel it, then start again.

## Response details

Every successful answer's status, request id, headers and rate limit reach an
`onResponse` callback, set on the client or for one call:

```ts
import { SproutsData, type AnswerMeta } from 'sproutsdata';

const log = (meta: AnswerMeta): void => {
  console.log(meta.status, meta.requestId, meta.rateLimit.limit, meta.rateLimit.remaining, meta.rateLimit.resetSeconds);
};

const logged = new SproutsData({ onResponse: log });
await logged.coverage();

await client.search({ query: 'fintech' }, { onResponse: log });
```

`rateLimit` is read from the `RateLimit-*` (or `X-RateLimit-*`) headers; each
field is `undefined` when the server did not send it. On an error, the headers
are on `err.headers`.

## Troubleshooting

**"No API key" at construction.** `SPROUTSDATA_API_KEY` is not set in the
process that runs (a common miss in containers and CI). Pass `apiKey`
explicitly to confirm, then fix the environment.

**401 on every call, and the key looks right.** The key may be revoked or
expired; a revocation takes up to about five minutes to apply everywhere. Also
check that nothing adds an `Origin` header to the request.

**403 on `credits.retrieve()` while `search()` works.** The key lacks
`dsp.usage.read`. See the [scope table](authentication.md#scopes).

**`CursorInvalidError` in the middle of a loop.** A cursor was sent with
different arguments: usually a hand-written loop that rebuilt the parameters.
The `iter*` walks keep a copy of the first request, so changing your own object
cannot cause it. See [Pagination](pagination.md).

**Results seem incomplete.** Read `degradation` before assuming a bug. A corpus
that timed out, or incomplete vector coverage, is reported there with
`impact: 'recall'`.

**A lookup with a person row's `id` finds nothing.** A person row's `id` is a
hash no lookup resolves. Use `lookupRef(hit)`; see
[Quickstart](quickstart.md#from-a-search-row-to-its-full-record).

**A report on a request made a moment ago answers 404.** History rows are
written in background batches after the answer. Report again shortly.

**Where to report a problem.** Send the failing call's request id
(`err.requestId`, or `page.meta.request_id` on a success) to Sprouts support.

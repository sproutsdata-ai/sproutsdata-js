# Behavioural fixtures

Canned HTTP exchanges plus the behaviour this client must produce for each one.
Driven by `tests/test_conformance.py`.

These were built to hold several language SDKs to one answer, back when they
shared a repository. That job is gone — each language has its own repo now — but
the cases were never really *about* multi-language consistency. They are the
clearest statement of what the client has to do:

- a `402` is never retried and never slept on;
- a paginated request re-sends a frozen body;
- an unknown error code does not crash;
- an unknown response field does not crash;
- `request_id` survives onto every error;
- `Origin` is never sent.

So they stay. **Treat a case as the specification and the runner as the
implementation.** If the two disagree, work out which is wrong before changing
either — the temptation when a case fails is to edit the case.

## Case format

```jsonc
{
  "name": "insufficient_credits_is_never_retried",
  "description": "Why this case exists, in one sentence.",
  "request": {                       // optional; defaults to POST /v1/search
    "method": "POST",
    "path": "/v1/search",
    "body": { "query": "fintech" }
  },
  "responses": [                     // replayed in order, one per attempt
    {
      "status": 402,
      "headers": { "X-Request-Id": "req_abc" },
      "body": { "code": "credits.insufficient", "title": "Insufficient credits",
                "status": 402, "extra": { "available": 0, "required": 1 } }
    }
  ],
  "expect": {
    "error": {
      "concept": "insufficient_credits",
      "request_id": "req_abc",
      "fields": { "available": 0, "required": 1 }
    },
    "attempts": 1,                   // how many HTTP requests should be made
    "no_sleep": true                 // must not have waited before giving up
  }
}
```

`expect.success` asserts on a parsed result instead of an error:

```jsonc
"expect": {
  "attempts": 1,
  "success": { "results_length": 2, "has_more": false, "request_id": "req_x" }
}
```

`expect.sent` asserts on what went out — the pagination cases use it to prove the
second request body matches the first:

```jsonc
"expect": { "sent": [ { "body_equals_index": null },
                      { "body_equals_index": 0, "except_keys": ["cursor"] } ] }
```

Entry `i` describes the `i`-th HTTP request, retries included. Every key is
optional; a key the runner does not know fails the case.

| Key | Asserts that request `i`… |
|---|---|
| `body_equals_index` | has the same JSON body as request `j` (`null`: no comparison) |
| `except_keys` | …ignoring these top-level body keys in that comparison |
| `cursor`, `limit` | sent this body `cursor` / `limit` |
| `headers_present` | carried each named header |
| `headers_absent` | carried none of the named headers |
| `headers_equal` | carried each header with exactly this value: `{"X-Request-Id": "req_caller_1"}` |
| `same_header_as_index` | carried the header, non-empty, with the same value as request `index`: `{"header": "Idempotency-Key", "index": 0}` |

Header names are matched case-insensitively, as HTTP defines them.
`same_header_as_index` is how a case says "reused" without knowing the value — an
`Idempotency-Key` the SDK generated, say — and pointed at an earlier page instead
of an earlier attempt, it would fail, which is the point: each logical call gets
its own key.

A case may set a top-level `"request_id"`: the caller's request id, passed on the
**first** call only (`client._page(..., request_id=…)` in Python, the per-call
option in JS). Later pages are fetched through the page's own "next page" call
without one, so a case can prove the id is not carried:

```jsonc
"request_id": "req_caller_1",
"paginate": "next_page",
"expect": { "sent": [ { "headers_equal": { "X-Request-Id": "req_caller_1" } },
                      { "headers_absent": ["X-Request-Id"] } ] }
```

## Route classes and network outcomes

Whether a failure may be retried depends on what the route costs, so every case
runs against a route class. The runner looks `request.method` + `request.path`
up in `spec/routes.json` (path templates such as `/v1/entities/{category}`
match any segment). With no `request`, the case is `POST /v1/search`, a
`billed` route. `GET` requests send no body; the runner calls the route through
the client's generic request path, so cases are not tied to one resource.

A `responses[]` entry may describe a transport outcome instead of an HTTP
response:

```jsonc
{ "network": "connect_refused" }   // never sent: DNS failure, refused, connect timeout
{ "network": "read_timeout" }      // sent, no answer before the timeout
{ "network": "reset_after_send" }  // sent, connection dropped before an answer
```

A case whose route is not in `routes.json` — or one that pins behaviour for a
class rather than a route — may set a top-level `"route_class": "safe" |
"billed" | "keyed" | "once"`, which takes precedence over the lookup. A case
that matches no route and sets no class fails rather than guessing.

`expect.error` then names the concept `connection` or `timeout` (a timeout is
also a connection error) and may assert `"reached_server": true | false`. The
contract's retry table (`spec/retry-policy.json`) is what these cases pin: a
`billed` or `once` call that may have reached the server is raised, never
repeated.

`Retry-After` values in `headers` may be seconds or an HTTP date. A date far in
the future is how a case says "beyond the 60-second cap" without depending on
the clock.

## Why cases name a concept, not a class

`"concept": "insufficient_credits"` rather than `"InsufficientCreditsError"`. The
runner maps concepts to exception types in one small table.

That indirection was there so other languages could use their own idiomatic
names. Keeping it costs almost nothing and leaves the directory portable if a
second SDK ever wants to copy it — which is likelier than it sounds, since the
behaviours above are properties of the API rather than of Python.

## The exhaustive error table is elsewhere

`spec/error-codes.json` holds every code, its status, its concept and whether it
is retryable. `tests/test_contract.py` asserts this client's mapping against that
file directly, which is better than thirty near-identical JSON cases. These cases
cover the *behaviours* around errors instead: which are retried, what fields
survive, and what happens when the server sends something this version has never
seen.

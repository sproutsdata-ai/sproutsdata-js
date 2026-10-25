# Credits, usage history and members

The operational reads. All free, and all safe to retry. Credits and history need
`dsp.usage.read`; members needs `dsp.search.read` or `dsp.agents.write`.

Two resources that are easy to confuse:

- **`client.credits`** — the billing view: the balance, and requests and credits
  per period.
- **`client.history`** — the operational view: individual calls, with what was
  asked, what came back, what it cost and how long it took. It is where "this
  query returned nothing yesterday" gets answered.

## What can this tenant still spend?

```ts
const credits = await client.credits.retrieve();
console.log(credits.spendable); // spendable on this platform right now
console.log(credits.allocated?.remaining, credits.allocated?.reserved);
for (const source of credits.allocated?.sources ?? []) {
  // purchased | signup | referral | promo | other
  console.log(source.source, source.remaining, source.never_expires ? 'never' : source.expires_at);
}
```

`allocated.sources` breaks `allocated.remaining` down by where the credits came
from. Purchased credits — a top-up's extra credits included — never expire;
signup, referral and promotional credits do, and each entry's `expires_at` says
when. The amounts add up to `allocated.remaining`, and `reserved` is not split by
source. It is absent or `null` when the backend does not report the breakdown.

**Gate on `spendable`.** Do not add `allocated.remaining` to `shared.remaining`:
the shared pool is reported for visibility but is not available to this
platform, so the sum is a number that looks like credit and buys nothing. When
`scope` is `'tenant_wide_fallback'`, only `spendable` is answerable and
`allocated` / `shared` are `null` — deliberately, rather than filled with totals
that are not this platform's to report.

## What has this key spent?

`credits.usage()` reports **the calling key only** — one key cannot read another
key's spend; tenant-wide reporting is a dashboard feature.

```ts
// Default: the last 30 days, bucketed by day
const usage = await client.credits.usage();
console.log(usage.total_requests, 'requests,', usage.total_credits, 'credits');

// A custom window and bucket size
const monthly = await client.credits.usage({
  granularity: 'month', // 'hour' | 'day' | 'month' | 'total'
  from: new Date('2026-01-01'),
  to: new Date('2026-07-01'),
});
for (const bucket of monthly.buckets) {
  console.log(bucket.period_start, bucket.action_type, bucket.requests, bucket.credits);
}
```

- `total_credits` is what the key was charged, in credits to at most three
  decimals. Add credit figures as whole thousandths if you sum many, so floating
  point cannot drift.
- Buckets are split by `action_type` (each search mode bills as its own action),
  so you can see what kind of call is spending.
- A new key has an empty report, not an error.

## What this key has done

```ts
for await (const page of client.history.listPages({
  action_type: ['dsp.search.fast', 'dsp.relationships'], // one value or several (any of them)
  from: new Date('2026-08-01'),
})) {
  for (const call of page.results) {
    console.log(call.id, call.occurred_at, call.query, call.status, call.credits_charged);
  }
}
```

Cursor-paginated like a search, and free, so walking it costs nothing but rate
limit. `action_type` accepts thirteen values: `dsp.search.fast` / `.auto` /
`.deep`, `dsp.similar`, `dsp.entities`, `dsp.relationships`,
`dsp.relationships.ask`, `dsp.org_chart`, and `dsp.agent.run.minimal` / `.low` /
`.medium` / `.high` / `.xhigh`. Pass an array to match any of several; the SDK
sends the key once per value and the server de-duplicates and sorts the set, so
argument order does not change the cursor.

`status` is one of three values — `pending`, `ok` or `failed`. A call is
**pending** from the moment it starts costing something until its outcome is
written (an agent run is pending until it settles); one pending too long to be
believed is reported by the server as `failed`. A pending call is not a failure,
however long it has run. To find out *why* a call failed, branch on
`error_code` — the same vocabulary the errors map from.

A list page's `total` is its own count (`total_is_estimate: true`), not an
all-time number. History ids are numbers — unlike agent run ids, which are
strings.

## One call, in full

```ts
const detail = await client.history.retrieve(42);
detail.request;        // the original body minus the cursor — replay it, don't rebuild it
detail.snapshot;       // the page-1 envelope exactly as it was served — or null…
detail.snapshot_state; // …and this says why: 'present' | 'expired' | 'omitted_too_large' | 'absent'
```

Requests are kept indefinitely; **result snapshots expire**. That is the
difference between "re-run it" and "see what it gave last time", and an
investigation usually wants the second. An unknown id is
`404 history.not_found` (`NotFoundError`).

## Totals

```ts
import { failureRate } from 'sproutsdata';

const daily = await client.history.metrics({ from: new Date('2026-08-01') });
console.log(daily.total_ok, daily.total_failed, daily.total_pending, daily.total_credits);

const rate = failureRate(daily); // or one bucket: failureRate(daily.buckets[0])
console.log(rate === null ? 'nothing finished in this window' : `${(rate * 100).toFixed(1)}% failed`);
```

`failureRate` is `failed / (ok + failed)`. Pending calls count on neither side:
they have no outcome yet, and counting them either way would move the rate while
nothing had changed. They are reported separately as `total_pending`, and as
`pending` on each bucket. It is `null` rather than `0` when nothing finished: no
traffic is not a perfect success rate.

## Members

One question, for integrations that must attribute work to a person before
spending the organisation's credits: does this email belong to a member of the
key's own organisation?

```ts
const member = await client.members.resolve('ada@example.com'); // matched case-insensitively
if (member.found && member.state === 'active') {
  // attribute the work to member.user_id
}
```

- `found: false` is an **answer**, returned as a 200 with `state: 'unknown'`.
  Every error means "could not determine" — never treat an error as "not a
  member".
- `state` is `active`, `not_activated` (has a role, has not activated the
  platform yet), `invitation_pending`, `no_access` (in the organisation, no role
  on this platform), or `unknown`.
- One email per call, never a roster: the organisation is always the
  credential's own.

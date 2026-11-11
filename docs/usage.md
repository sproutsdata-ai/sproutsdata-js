# Credits and usage history

Two free resources, both needing a key with `dsp.usage.read`:

- **`client.credits`**: the workspace's balance, and the ledger of every charge
  and grant behind it.
- **`client.history`**: the workspace's individual calls, with what was asked,
  what it cost and how long it took, and daily totals.

## The balance

```ts
import { canAfford } from 'sproutsdata';

const credits = await client.credits.retrieve();
console.log(credits.balance, credits.reserved, credits.available, credits.debt);
console.log(credits.status, credits.has_paid, credits.rate_card, credits.stale);

if (!canAfford(credits, 50)) console.warn('Fewer than 50 credits available');
```

| Field | Meaning |
|---|---|
| `balance` | The workspace's credits. |
| `reserved` | Credits held for research runs that have not settled. |
| `available` | What can be spent now: the balance, less what is reserved and any debt. |
| `debt` | Credits owed. |
| `status` | The wallet's status. A `frozen` wallet spends nothing until Sprouts unfreezes it; a billed call then throws `WalletFrozenError`. |
| `has_paid` | Whether the workspace has paid for credits. |
| `rate_card` | The price list the workspace is billed on. |
| `stale` | The balance was read from a cache while the ledger was unreachable. |

`canAfford(credits, n)` compares `n` with `available`. Credits do not come in
lots and have no fixed expiry.

A billed call the workspace cannot pay for throws `InsufficientCreditsError`
(402) and charges nothing; `err.availableCredits` and `err.requiredCredits` say
how far short it is. Waiting does not help: the workspace needs credits.

## The ledger

`credits.transactions` is the ledger, newest first. Each row has a `kind`
(`charge`, `grant`, ...), signed `credits` (negative for a charge),
`balance_after`, and the `action` or `source` behind it.

```ts
const page = await client.credits.transactions({ limit: 20 });
for (const row of page.results) console.log(row.created_at, row.kind, row.credits, row.balance_after, row.action ?? row.source);

// Every row, page after page
for await (const row of client.credits.iterTransactions({ maxResults: 500 })) {
  if (row.kind === 'charge') console.log(row.action, row.credits);
}
```

A call made with a test key is free and writes no ledger row.

## What the workspace has done

`history.list` is one page of calls, newest first; `history.iterList` walks
them all. Both are free.

```ts
for await (const call of client.history.iterList({ action_type: 'dsp.search.fast', from: new Date('2026-11-01'), maxResults: 200 })) {
  console.log(call.id, call.occurred_at, call.query, call.status, call.credits_charged, call.latency_ms);
}
```

- `action_type` takes one action. The SDK refuses a list, since the server
  would keep only the last one: list the history once per action.
- `from` and `to` take a `Date` or an ISO 8601 string.
- `limit` is 1 to 100 rows a page. A page holds `results` and `next_cursor`.
- `credits_charged` is a decimal string (`"0.500"`), or `null` when the call
  was not metered. `latency_ms` may be `null`.
- `status` is `pending`, `ok` or `failed`; `error_code` says why a call failed,
  in the same codes the errors carry.

History rows are written in background batches after each answer, so a call
made a moment ago may not be listed yet.

## One call, in full

```ts
const page = await client.history.list({ limit: 1 });
const latest = page.results[0];
if (latest !== undefined) {
  const detail = await client.history.retrieve(latest.id);
  console.log(detail.request); // the request as it was sent, or null
  console.log(detail.snapshot_state); // 'present', 'absent' or 'continuation'
  console.log(detail.snapshot); // the answer as it was served, when one was kept
}
```

A row's `id` is a digit string, which `retrieve` takes as it is. An unknown id
throws `NotFoundError` (`history.not_found`).

`snapshot_state` is `present` when the answer was kept, `absent` when it was
not, and `continuation` for a later page of a search, whose snapshot is its
session's first page.

## Daily totals

```ts
const metrics = await client.history.metrics({ from: new Date('2026-11-01') });
console.log(metrics.total_requests, metrics.total_ok, metrics.total_failed, metrics.total_pending, metrics.total_credits);
for (const bucket of metrics.buckets) console.log(bucket.day, bucket.action_type, bucket.requests, bucket.credits);
```

`metrics` gives daily totals by action: requests, outcomes and credits. Credits
are decimal strings; parse them with a decimal library if you add many of them.

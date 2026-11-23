# Agent runs

Agents do research rather than retrieval. An agent run is a question worked
through for minutes, which finds candidates, checks them against criteria you
state in words, fills the enrichment columns you name, and reports its own
coverage. The flow is start, follow, read.

A run needs a key with the `dsp.agents.*` scopes: `dsp.agents.write` to start
and cancel one, `dsp.agents.read` (or write) to read and follow it. A key made
with the default scopes has neither; create one with them.

## Start

```ts
const handle = await client.runs.create(
  {
    query: 'series B fintechs in DACH with an in-house ML team',
    category: 'company', // or 'person'
    effort: 'detailed', // 'quick', 'basic', 'standard' (the default), 'detailed', 'maximum' or 'auto'
    criteria: ['has an in-house ML team'], // up to 10, in words
    enrichments: ['ml_team_evidence'], // up to 20 columns to fill
    exclusion: ['<record-id-you-already-hold>'], // up to 1,000
  },
  { idempotencyKey: 'dach-ml-fintechs-2026-11-01' }, // optional
);
console.log(handle.run_id, handle.status);
```

The earlier effort names (`minimal`, `low`, `medium`, `high`, `xhigh`, typed
`LegacyEffort`) are still accepted, and the SDK sends them as the names above.

`create` answers at once with the run's id; the work goes on server-side. The
run is billed when it settles (`credits_charged` on the result). A run
cancelled before it finishes is not billed.

**Every create carries an `Idempotency-Key`.** The server requires one on this
route. The SDK sends the `idempotencyKey` you pass (1 to 255 characters), or
generates one, and resends it on its own retries, which is what makes retrying
a timed-out create safe. Pass your own key when a retry may come from somewhere
else, such as another process or a job queued again after a crash. Use a new
key for a new question.

A key without the scopes throws `PermissionDeniedError`.

## Follow it as it happens

```ts
const handle = await client.runs.create({ query: 'European neobanks with a banking licence' });

let lastEventId: string | undefined;
for await (const event of client.runs.events(handle.run_id)) {
  console.log(event.event, event.data);
  lastEventId = event.id ?? lastEventId;
}

const run = await client.runs.retrieve(handle.run_id);
console.log(run.status, lastEventId);
```

`events` yields the run's server-sent events as they happen, each with its
`id`, its `event` name, its `data` as JSON and the `raw` text. The generator
ends when the run's stream closes. The stream carries no closing frame, so read
the outcome with `retrieve` (or `wait`) afterwards. Pass an `AbortSignal` in
the options to stop early.

A stream that breaks throws `APIConnectionError`, and one silent for 60 seconds
throws `APITimeoutError`; both carry `lastEventId`. Pass it back to resume
after the last event read:

```ts
import { APIConnectionError } from 'sproutsdata';

async function follow(runId: string, lastEventId?: string): Promise<void> {
  try {
    for await (const event of client.runs.events(runId, lastEventId === undefined ? {} : { lastEventId })) {
      console.log(event.event);
    }
  } catch (err) {
    if (err instanceof APIConnectionError && err.lastEventId !== undefined) return follow(runId, err.lastEventId);
    throw err;
  }
}

await follow('<run-id>');
```

A person run's `rows.preliminary` events carry no preview.

## Read the outcome

```ts
const run = await client.runs.wait('<run-id>', { pollIntervalMs: 3_000, maxWaitMs: 900_000 });
console.log(run.status, run.stop_reason, run.credits_charged, run.effort_ran);
console.log(run.summary, run.coverage?.universe_exhausted, run.insights);
```

`retrieve` reads a run as it stands: `status` (`pending`, `running`,
`completed`, `failed` or `cancelled`), `summary`, `effort_ran` (the effort it
ran at; for `auto`, the one chosen), `coverage` and the cost. It is free.

`wait` polls `retrieve` until the run settles (`completed`, `failed` or
`cancelled`) and returns it. A failed or cancelled run is returned, not thrown.
Polling starts at `pollIntervalMs` (default 3 seconds) and waits half again
longer each time, to at most 15 seconds. After `maxWaitMs` (default 15 minutes;
`null` waits for as long as it takes) it throws `WaitTimeoutError`, whose `last`
is the last state seen; the run goes on server-side. Your `signal` stops the
wait at once.

Read `coverage` before trusting a count: "we found 40 accounts" and "there are
40 accounts" are different claims. `total` says how many rows matched, and
`coverage` says whether those are all of them:

```ts
const settled = await client.runs.retrieve('<run-id>');
const c = settled.coverage;
if (c !== null) {
  console.log(c.universe, c.universe_is_exact); // records matching the resolved question, counted
  console.log(c.enumerated, c.enumeration_recall); // how many this answer carries, as a fraction
  console.log(c.universe_exhausted); // every match returned, and the count agrees
  console.log(c.constraints_unmet, c.truncated_by); // what could not be asked, and what stopped it short
}
```

## The rows

A settled run's rows are free to read, with its `columns` filled in on each:

```ts
const page = await client.runs.results('<run-id>', { limit: 100 });
console.log(page.columns, page.total, page.next_cursor);

for await (const row of client.runs.iterResults('<run-id>', { maxResults: 500 })) {
  console.log(row);
}
```

`insights` (with `insight_sources`) on the run are not rows; keep them in their
own block.

## Listing and cancelling

`runs.list` is one page of the workspace's runs, newest first, and
`runs.iterList` walks them all. Both are free. A server that cannot list runs
yet throws `FeatureNotAvailableError` (501).

`runs.cancel(runId)` stops a run. A run that had already finished stays
finished, and charged.

An unknown run id throws `NotFoundError` (`agents.run_not_found`).

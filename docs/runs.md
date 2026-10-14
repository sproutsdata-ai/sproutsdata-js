# Agent runs

Research rather than retrieval: an asynchronous, multi-step job that finds
candidates and verifies them against criteria you state in words, fills the
enrichment columns you name, streams progress, and measures its own coverage.
Runs take minutes, not milliseconds, and are the only asynchronous surface in
the API — so the flow is start → watch → read.

## Start

Needs `dsp.agents.write`.

```ts
const { run_id } = await client.runs.create(
  {
    query: 'series B fintechs in DACH with an in-house ML team',
    category: 'company',                    // or 'person'
    effort: 'high',                         // minimal 1.02 | low 2.125 | medium 8.5 | high 42.5 | xhigh 85 | auto (holds 85)
    criteria: ['has an in-house ML team'],  // prose — the engine decides what it can prove
    enrichments: ['ml_team_evidence'],      // columns to fill
    exclusion: ['<record-id-you-already-hold>'],
  },
  { idempotencyKey: 'dach-ml-fintechs-2026-10-01' }, // optional
);
```

**Credits are held, then settled.** The hold is placed before the engine is
called, so an unaffordable run does not start. Cancelling releases the hold —
you are charged nothing for work you stopped — but a run that had already
finished stays finished and is charged.

**Every create carries an `Idempotency-Key`**, which the server requires on this
route and nowhere else. Starting a run holds credits and takes minutes, so a
repeat must be recognisable: the server returns the original run for a key it
has seen instead of starting (and holding credits for) a second one. Without
`idempotencyKey` the SDK generates `sdk-<32 hex>` for the call and resends it on
each of its own retries — which is what makes retrying a timed-out create safe.
Pass your own when a retry may come from somewhere else (another process, a job
re-queued after a crash).

The server replays the first run for a key it has already seen and **ignores
the new body**. A key therefore names one question: reuse it to retry, and use a
new one to ask something different.

## Watch — the event stream

```ts
for await (const event of client.runs.events(run_id)) {
  console.log(event.seq, event.type, event.data);
  // run.started, plan, step.started, tool.called, grounded, coverage,
  // rows.preliminary, budget, answer, … then run.done or error.
}
```

The generator ends when the server closes the stream, after a terminal
`run.done` or `error` (the exported `TERMINAL_RUN_EVENTS` set names them).
Heartbeats are absorbed; your `AbortSignal` (in the options argument) is the way
to leave early. Event payloads are server-owned (`data` is a plain object; `raw`
keeps the original line), and unknown event types still arrive — the vocabulary
can grow without an SDK release.

There is **no mid-stream auto-reconnect**, because a silent reconnect replays
events you have already handled. A stream silent for 60 seconds raises
`APITimeoutError` carrying `lastEventId`; a dropped one raises
`APIConnectionError`. Either way, resume from the last `seq` you saw and the
server replays only what followed:

```ts
client.runs.events(run_id, { lastEventId: String(lastSeq) });
```

## Read the outcome

```ts
const run = await client.runs.wait(run_id); // completed, failed, cancelled or expired
console.log(run.status, run.stop_reason, run.credits_charged);
console.log(run.summary, run.coverage?.universe_exhausted, run.insights);
```

**Events are for progress; reading the run is for outcomes.** Reading a finished
run (`runs.retrieve` — `runs.wait` is a poll loop over it) is what settles the
credit hold, so `credits_charged` is real there; it stays `null` (never `0`)
until then. Streaming alone never settles a run.

`runs.wait` polls from 3 s, growing 1.5× per poll up to 15 s (`pollIntervalMs`
sets the first interval), and returns any terminal run — `failed` and `expired`
included: a terminal run is an answer, not an error. It gives up after 15
minutes (`timeoutMs` changes the deadline) by throwing `RunWaitTimeoutError`,
whose `run` is the last polled state; the run itself carries on server-side and
is not cancelled. `signal` stops the wait at once.

Check coverage before trusting a count: "we found 40 accounts" and "there are 40
accounts" are different claims, and `run.coverage` says which one this is (see
[the coverage block](quickstart.md#the-coverage-block)).

## The rows

The rows are free to read and cursor-paginated:

```ts
for await (const page of client.runs.resultsPages(run_id, { limit: 100 })) {
  process(page.results); // each row: { id, …the run's own columns }
}
```

Insights (`run.insights`, with `run.insight_sources`) come from corpora with no
company linkage, so they are never one of the rows; keep them in their own
block.

## Listing and cancelling

`client.runs.list({ limit })` lists the tenant's runs, newest first, with no
cursor. `client.runs.cancel(run_id)` is idempotent, needs a key with
`dsp.agents.write`, and releases the credit hold rather than settling it. A
finished run whose hold had already lapsed before anyone read it reports
`credits_charged: 0` — it was not charged. `effort_ran` says which tier a run
actually ran at (for `auto`, the one it chose).

An unknown run id is a 404 carrying `code: 'request.invalid'` rather than a
dedicated not-found code. Errors are classed by code first, so it arrives as an
`InvalidRequestError` with `status: 404` — branch on `err.status === 404`.

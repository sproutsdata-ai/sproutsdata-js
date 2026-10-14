/**
 * Start an agent run, watch it, and read what it found.
 *
 * A run is the only asynchronous thing in the API, so it is the only place a
 * client has to decide what to do about time. This streams progress, then
 * reads the run itself — the stream ending is not by itself proof the run
 * finished — and checks coverage before trusting the count.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_test_<your-key>
 *   npx tsx examples/agent-run.ts "Series B fintechs in the Nordics"
 */

import { RunWaitTimeoutError, SproutsData, SproutsDataError } from 'sproutsdata';

const query = process.argv.slice(2).join(' ') || 'Series B fintechs in the Nordics';
const client = new SproutsData();

// The SDK sends a generated Idempotency-Key and reuses it on its own retries.
// Pass `{ idempotencyKey }` yourself when a retry may come from another process.
const handle = await client.runs.create({
  query,
  criteria: ['has launched a card product', 'is not a bank'],
  enrichments: ['ceo_name'],
  effort: 'high',
});
console.log(`run ${handle.run_id} (${handle.status})`);

let lastSeq: number | null = null;
try {
  for await (const event of client.runs.events(handle.run_id)) {
    lastSeq = event.seq ?? lastSeq;
    console.log(`  [${event.type}] ${JSON.stringify(event.data).slice(0, 120)}`);
  }
} catch (err) {
  // A dropped stream is not a failed run. Resume from where we were
  // (`lastEventId`), or fall back to polling — never assume the work stopped.
  if (!(err instanceof SproutsDataError)) throw err;
  console.log(`  stream ended early (${err.message}); falling back to polling`);
}

try {
  const run = await client.runs.wait(handle.run_id, { timeoutMs: 30 * 60_000 });
  if (run.status !== 'completed') {
    console.log(`run ${run.status}: ${run.error ?? run.stop_reason}`);
  } else {
    // Coverage first. "We found 40" and "there are 40" are different claims,
    // and only one of them is safe to put in front of a customer.
    const coverage = run.coverage;
    if (coverage === null) console.log('\nthe run reported nothing about coverage');
    else if (coverage.universe_exhausted) console.log(`\ncomplete: the whole universe of ${coverage.universe}`);
    else console.log(`\npartial: ${coverage.enumerated} of ~${coverage.universe} (${coverage.truncated_by ?? 'not exhausted'})`);

    // The rows are free to read. The run searched companies (the default
    // category), so each row names itself in `account_name`.
    for await (const page of client.runs.resultsPages(run.run_id, { limit: 50 }, { maxResults: 100 })) {
      for (const row of page.results) console.log(' ', row.id, row['account_name']);
    }

    console.log(`\n${run.summary}`);
    // Reading the finished run is what settled it, so this is the real charge.
    console.log(`charged ${run.credits_charged} credits`);
  }
} catch (err) {
  // The run is still going server-side; nothing has been lost.
  if (!(err instanceof RunWaitTimeoutError)) throw err;
  console.log(`still ${err.run.status} after the deadline; resume the stream from event ${lastSeq}`);
}

/**
 * A research run: start it, follow it, and read its rows.
 *
 * A run is the one call that works in the background. Follow it by streaming its events or by
 * waiting for it to finish; `runs.wait` polls with a growing interval and throws
 * `WaitTimeoutError` (holding the last state) if it takes too long. Runs need a key with the
 * `dsp.agents.*` scopes, which a key does not have by default.
 *
 *   export SPROUTSDATA_API_KEY=sk_dsp_live_<your-key>
 *   node examples/agent-run.ts
 */

import { PermissionDeniedError, SproutsData, WaitTimeoutError } from 'sproutsdata';

const client = new SproutsData();

try {
  const handle = await client.runs.create({ query: 'fintech companies hiring engineers' });
  console.log(`run ${handle.run_id}: ${handle.status}`);

  for await (const event of client.runs.events(handle.run_id)) console.log(`  ${event.event ?? "message"}: ${event.raw.slice(0, 60)}`);

  const run = await client.runs.wait(handle.run_id, { maxWaitMs: 300_000 });
  console.log(`${run.status}: ${run.summary.slice(0, 120)} (${String(run.credits_charged)} credits)`);

  const rows = await client.runs.results(handle.run_id, { limit: 5 });
  for (const row of rows.results) console.log(`  ${String(row['account_name'] ?? row['id'])}`);
} catch (error) {
  if (error instanceof PermissionDeniedError) console.log('this key cannot start runs: create one with the dsp.agents scopes');
  else if (error instanceof WaitTimeoutError) console.log(`still running after 5 minutes: ${JSON.stringify(error.last)}`);
  else throw error;
}

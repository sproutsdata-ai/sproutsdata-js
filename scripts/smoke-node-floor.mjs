#!/usr/bin/env node
// Runs the BUILT sdk package on the oldest Node.js it claims to support.
//
// The unit tests run on vitest, which needs a newer Node than the sdk's
// `engines` floor, so they cannot prove the floor. This script can: it loads
// dist/ through both the ESM and the CommonJS entry points and makes one real
// HTTP call against a local stub server. A syntax or runtime API the floor
// lacks (fetch, AbortSignal, crypto) fails here.
//
//   npm run build -w packages/sdk && node scripts/smoke-node-floor.mjs

import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TEST_KEY = 'sk_dsp_test_' + 'x'.repeat(22);

const server = createServer((req, res) => {
  const ok = req.headers['x-api-key'] === TEST_KEY;
  res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json', 'x-request-id': 'req_smoke' });
  res.end(JSON.stringify(ok ? { spendable: 7 } : { title: 'unauthorized' }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

let failed = false;
try {
  const entries = {
    esm: await import('../packages/sdk/dist/index.js'),
    cjs: require('../packages/sdk/dist/index.cjs'),
  };
  for (const [kind, sdk] of Object.entries(entries)) {
    const client = new sdk.SproutsData({ apiKey: TEST_KEY, baseUrl, maxRetries: 0 });
    const credits = await client.credits.retrieve();
    if (credits.spendable !== 7) throw new Error(`${kind}: unexpected response ${JSON.stringify(credits)}`);
    console.log(`${kind}: sproutsdata ${sdk.VERSION} works on Node.js ${process.versions.node}`);
  }
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  server.close();
}
process.exitCode = failed ? 1 : 0;

#!/usr/bin/env node
// Runs the BUILT sdk inside workerd, Cloudflare's runtime, through Miniflare, without
// Node.js compatibility: the strictest runtime the SDK supports (no Node globals, no
// node: modules), and the one an isolate-based edge function (Vercel Edge, Workers)
// gives the AI SDK adapter.
//
// A Node-only API that slipped into the bundle fails here, at load or at call time,
// even when every unit test passes on Node.
//
//   npm run build -w packages/sdk && node scripts/smoke-edge.mjs

import { readFileSync, readdirSync } from 'node:fs';

import { Miniflare } from 'miniflare';

const bundle = (file) => readFileSync(new URL(`../packages/sdk/dist/${file}`, import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../packages/sdk/package.json', import.meta.url), 'utf8'));

// The worker imports the ESM build exactly as a bundler would hand it over, makes a client
// and calls it through a stubbed fetch: building a request, checking it, sending it and
// reading the answer all run inside the isolate.
const worker = `
import { SproutsData, VERSION } from './sdk/index.js';
import * as tools from './sdk/tools.js';
const answer = { as_of: '2026-11-11T00:00:00Z', meta: { request_id: 'edge' }, segments: [{ category: 'company', name: 'companies', total: 3 }] };
export default {
  async fetch() {
    const seen = [];
    const fetch = async (url, init) => {
      seen.push({ url: String(url), key: new Headers(init.headers).get('x-api-key') });
      return Response.json(answer, { headers: { 'x-request-id': 'edge' } });
    };
    const client = new SproutsData({ apiKey: 'sk_dsp_test_' + 'edge-smoke', baseUrl: 'https://api.test.invalid', fetch });
    const coverage = await client.coverage({ category: 'company' });
    let refused = '';
    try {
      await client.search({ category: 'patent', mode: 'deep', query: 'x' });
    } catch (err) {
      refused = err.name;
    }
    return Response.json({ version: VERSION, tools: typeof tools, total: coverage.segments[0].total, seen, refused });
  },
};`;

const chunks = readdirSync(new URL('../packages/sdk/dist/', import.meta.url)).filter(
  (file) => file.startsWith('chunk-') && file.endsWith('.js'),
);
const mf = new Miniflare({
  // A fixed date, not today's: the runtime's behaviour is pinned like any other dependency.
  compatibilityDate: '2026-08-01',
  modules: [
    { type: 'ESModule', path: 'worker.js', contents: worker },
    { type: 'ESModule', path: 'sdk/index.js', contents: bundle('index.js') },
    { type: 'ESModule', path: 'sdk/tools.js', contents: bundle('tools.js') },
    ...chunks.map((file) => ({ type: 'ESModule', path: `sdk/${file}`, contents: bundle(file) })),
  ],
});

try {
  const response = await mf.dispatchFetch('http://localhost/');
  const body = await response.json();
  const called = body.seen.length === 1 && body.seen[0].url === 'https://api.test.invalid/v1/coverage?category=company' && body.seen[0].key !== null;
  if (body.version !== manifest.version || body.total !== 3 || !called || body.refused !== 'ClientValidationError') {
    throw new Error(`unexpected answer ${JSON.stringify(body)}`);
  }
  console.log(`ok   sproutsdata ${body.version} runs in workerd: a call answered, a refusal refused`);
} catch (err) {
  console.error(`FAIL workerd: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await mf.dispose();
}


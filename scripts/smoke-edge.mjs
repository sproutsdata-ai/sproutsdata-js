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

// The worker imports the ESM build exactly as a bundler would hand it over, makes a client and
// calls one operation of every resource family through a stubbed fetch: building each request,
// checking it, sending it and reading its answer (JSON, CSV) all run inside the isolate.
const worker = `
import { SproutsData, VERSION } from './sdk/index.js';
import * as tools from './sdk/tools.js';
const segments = [{ category: 'company', name: 'companies', total: 3 }];
export default {
  async fetch() {
    const seen = [];
    const fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      seen.push(path);
      if (path.endsWith('/export')) return new Response('entity_category,entity_id\\r\\n', { headers: { 'content-type': 'text/csv' } });
      return Response.json({ meta: { request_id: 'edge' }, results: [], segments, values: [], lists: [], tags: [] });
    };
    const client = new SproutsData({ apiKey: 'sk_dsp_live_' + 'edge-smoke', baseUrl: 'https://api.test.invalid', fetch });
    const families = {
      search: () => client.search({ query: 'x' }),
      vocabulary: () => client.filterValues('industry'),
      coverage: () => client.coverage({ category: 'company' }),
      entities: () => client.entities.companies({ ids: ['stripe.com'] }),
      runs: () => client.runs.retrieve('run-1'),
      relationships: () => client.relationships.ask({ query: 'who at Stripe knows Adyen' }),
      orgChart: () => client.orgChart.taxonomy(),
      lists: () => client.lists.list(),
      exportFile: () => client.lists.export('l1'),
      exports: () => client.exports.retrieve('j1'),
      history: () => client.history.list(),
      feedback: () => client.feedback.tags(),
      credits: () => client.credits.retrieve(),
    };
    const answered = {};
    for (const [family, call] of Object.entries(families)) answered[family] = typeof (await call());
    let refused = '';
    try {
      await client.search({ category: 'patent', mode: 'deep', query: 'x' });
    } catch (err) {
      refused = err.name;
    }
    return Response.json({ version: VERSION, tools: typeof tools, answered, calls: seen.length, refused });
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
  const families = Object.keys(body.answered);
  if (body.version !== manifest.version || body.calls !== families.length || body.refused !== 'ClientValidationError' || families.length !== 13) {
    throw new Error(`unexpected answer ${JSON.stringify(body)}`);
  }
  console.log(`ok   sproutsdata ${body.version} runs in workerd: ${String(families.length)} resource families answered, a refusal refused`);
} catch (err) {
  console.error(`FAIL workerd: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await mf.dispose();
}


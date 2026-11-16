#!/usr/bin/env node
// Checks the JS SDK against a live deployment, call by call: the counterpart of sproutsdata-py's
// scripts/smoke.py. The checks are named in spec/smoke/checks.json (vendored from sproutsdata-py),
// and the script refuses to run if its checks and that file differ, so both report one list.
//
//   export SPROUTSDATA_API_KEY=sk_dsp_live_<your-key>
//   export SPROUTSDATA_BASE_URL=<origin>     # optional; production otherwise
//   npm run build && node scripts/smoke-live.mjs
//
// Several checks are billed, and every key is charged (test keys were retired), so the run ends by
// saying how many credits it spent.
//
// Exit codes: 0 every check passed (or was skipped), 1 a check failed, 2 misconfigured.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ClientValidationError, CursorInvalidError, entityHit, missingValues, PermissionDeniedError, SproutsData, SproutsDataError, totalFor, VERSION } from 'sproutsdata';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKS = JSON.parse(readFileSync(join(ROOT, 'spec', 'smoke', 'checks.json'), 'utf8')).checks.map((check) => check.name);
const STRIPE = { value: 'stripe.com', by: 'domain' };
const ADYEN = { value: 'adyen.com', by: 'domain' };

class Skip extends Error {}

function require(condition, message) {
  if (!condition) throw new Error(message);
}

async function refused(call) {
  try {
    await call();
  } catch (error) {
    if (error instanceof ClientValidationError) return error.message.slice(0, 70);
    throw error;
  }
  throw new Error('sent instead of refused locally');
}

const search = { cursor: null };

/** Every check, by its name in spec/smoke/checks.json. */
const IMPLEMENTED = {
  'local.unknown_argument_refused': (c) => refused(() => c.search({ query: 'x', colour: 'red' })),
  'local.crossed_range_refused': (c) => refused(() => c.search({ query: 'x', filters: { employee_count: { gte: 500, lte: 10 } } })),
  'local.document_filters_refused': (c) => refused(() => c.search({ query: 'x', category: 'news_article', filters: { employee_count: { gte: 10 } } })),
  'credits.retrieve': async (c) => {
    const wallet = await c.credits.retrieve();
    return `available ${wallet.available}, status ${wallet.status}`;
  },
  'credits.transactions': async (c) => `${(await c.credits.transactions({ limit: 5 })).results.length} rows`,
  coverage: async (c) => `${totalFor(await c.coverage(), 'company')} companies`,
  sorts: async (c) => `${(await c.sorts('company')).sorts.length} sortable fields`,
  filter_values: async (c) => `${(await c.filterValues('industry')).values.length} industries on page 1`,
  'search.page_one': async (c) => {
    const page = await c.search({ query: 'robotics', limit: 5 });
    require(page.results.length > 0, 'no rows');
    search.cursor = page.next_cursor;
    return `${page.results.length} rows, total ${page.total}, cost ${page.meta.credits_charged}`;
  },
  'search.page_two': async (c) => {
    if (search.cursor === null) throw new Skip('page one had no next page');
    return `${(await c.search({ query: 'robotics', limit: 5, cursor: search.cursor })).results.length} rows`;
  },
  'search.cursor_bound_to_request': async (c) => {
    if (search.cursor === null) throw new Skip('page one had no next page');
    try {
      await c.search({ query: 'another question', limit: 5, cursor: search.cursor });
    } catch (error) {
      if (error instanceof CursorInvalidError) return error.code ?? 'refused';
      throw error;
    }
    throw new Error('a cursor was accepted for a different request');
  },
  'iter_search.max_results': async (c) => {
    const rows = [];
    for await (const row of c.iterSearch({ query: 'robotics', limit: 5, maxResults: 7 })) rows.push(row);
    require(rows.length === 7, `${rows.length} rows`);
    return '7 rows over two pages';
  },
  similar: async (c) => `${(await c.similar({ anchors: ['stripe.com'], limit: 3 })).results.length} rows`,
  'entities.companies': async (c) => {
    const sent = ['stripe.com', `missing-${randomUUID().slice(0, 8)}.invalid`];
    const answer = await c.entities.companies({ ids: sent });
    require(sent.every((value) => entityHit(answer, value) !== undefined), 'a value sent went unanswered');
    return `${sent.length} answered, missing: ${JSON.stringify(missingValues(answer))}`;
  },
  'relationships.find': async (c) => `${(await c.relationships.find({ companies: [STRIPE, ADYEN], limit: 3 })).total} people`,
  'relationships.institutions': async (c) => `request ${(await c.relationships.institutions({ companies: [STRIPE, ADYEN] })).meta.request_id}`,
  'org_chart.retrieve': async (c) => `${(await c.orgChart.retrieve({ domain: 'stripe.com' })).total} people`,
  'history.list': async (c) => `${(await c.history.list({ limit: 5 })).results.length} rows`,
  'history.metrics': async (c) => `${(await c.history.metrics()).total_requests} requests`,
  'feedback.tags': async (c) => `${Object.keys(await c.feedback.tags()).length} fields`,
  'lists.round_trip': async (c) => {
    const saved = await c.lists.create({ name: `smoke ${randomUUID().slice(0, 8)}`, entity_category: 'company' });
    try {
      await c.lists.addItems(saved.id, { items: [{ entity_category: 'company', entity_id: 'stripe.com' }] });
      return `${(await c.lists.items(saved.id)).items.length} item`;
    } finally {
      await c.lists.delete(saved.id);
    }
  },
  'runs.list': async (c) => {
    try {
      return `${(await c.runs.list({ limit: 5 })).results.length} runs`;
    } catch (error) {
      if (error instanceof PermissionDeniedError) throw new Skip('this key lacks the dsp.agents scopes');
      throw error;
    }
  },
};

/** The wallet's balance, or `undefined` when it cannot be read (the checks still run). */
async function balance(client) {
  try {
    return (await client.credits.retrieve()).balance;
  } catch (error) {
    if (error instanceof SproutsDataError) return undefined;
    throw error;
  }
}

async function main() {
  const implemented = Object.keys(IMPLEMENTED);
  const differ = [...CHECKS.filter((name) => !implemented.includes(name)), ...implemented.filter((name) => !CHECKS.includes(name))];
  if (differ.length > 0) {
    console.error(`error: the checks differ from spec/smoke/checks.json: ${differ.join(', ')}`);
    return 2;
  }
  let client;
  try {
    client = new SproutsData();
  } catch (error) {
    if (!(error instanceof ClientValidationError)) throw error;
    console.error(`error: ${error.message}`);
    return 2;
  }
  const before = await balance(client);
  let failed = 0;
  for (const name of CHECKS) {
    let verdict = '  ok  ';
    let note;
    try {
      note = await IMPLEMENTED[name](client);
    } catch (error) {
      verdict = error instanceof Skip ? ' skip ' : ' FAIL ';
      note = error instanceof Skip ? error.message : `${error.name}: ${error.message}`.slice(0, 160);
      if (!(error instanceof Skip)) failed += 1;
    }
    console.log(`[${verdict}] ${name.padEnd(36)} ${note}`);
  }
  console.log(`\n${CHECKS.length - failed} of ${CHECKS.length} checks passed or skipped (sproutsdata ${VERSION})`);
  const after = await balance(client);
  if (before !== undefined && after !== undefined) {
    console.log(`${(before - after).toFixed(2)} credits spent (balance ${before.toFixed(2)} -> ${after.toFixed(2)})`);
  }
  return failed > 0 ? 1 : 0;
}

process.exitCode = await main();

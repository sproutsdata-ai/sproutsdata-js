/**
 * What the application sets (fixed and default arguments, the row cap, baseline filters), the
 * tools' own rules, and how an answer is shaped for a model.
 */

import { describe, expect, it } from 'vitest';

import { SproutsData } from '../../src/index.js';
import { isSproutsData, resolveClient, Toolset, type ToolResult, type ToolsetOptions } from '../../src/tools/index.js';
import { recordedBody, respond } from '../support/answers.js';
import { BASE_URL, FIXTURE_KEY } from '../support/fakes.js';
import { client, companyRow, lookupOk, searchOk, similarOk, toolset } from './support.js';

const caveatsOf = (result: ToolResult): readonly string[] => ('caveats' in result ? result.caveats : []);
const messageOf = (result: ToolResult): string => ('error' in result ? result.error.message : '');
const rowsOf = (result: ToolResult): readonly Record<string, unknown>[] => ('total' in result ? result.results : []);

describe('settings', () => {
  it('merge baseline filters per sub-key, and say when the application overrode the model', async () => {
    const { tools, sent } = toolset([searchOk()], { baselineFilters: { industry: { include: ['Software & Technology'] }, employee_count: { gte: 100 } } });
    const result = await tools.run('sprouts_search', { query: 'acme', filters: { industry: { exclude: ['Gaming'] }, employee_count: { gte: 5 } } });
    expect(sent[0]?.body).toMatchObject({ filters: { industry: { exclude: ['Gaming'], include: ['Software & Technology'] }, employee_count: { gte: 100 } } });
    expect(caveatsOf(result)[0]).toBe('application_filter: `filters.employee_count.gte` is fixed by this application to 100; your 5 was not applied.');
  });

  it('apply the baseline to look-alikes, and refuse an auto search that would bypass it', async () => {
    const { tools, sent } = toolset([similarOk()], { baselineFilters: { employee_count: { gte: 100 } } });
    await tools.run('sprouts_similar', { anchors: [{ value: 'acme.com' }] });
    expect(sent[0]?.body).toMatchObject({ filters: { employee_count: { gte: 100 } } });
    expect(messageOf(await tools.run('sprouts_search', { query: 'acme', category: 'auto', mode: 'auto' }))).toContain('cannot apply the constraints this application sets');
    expect(sent).toHaveLength(1);
  });

  it('apply fixed and default arguments', async () => {
    const { tools, sent } = toolset([searchOk()], { fixed: { sprouts_search: { category: 'person' } }, defaults: { sprouts_search: { mode: 'auto' } } });
    await tools.run('sprouts_search', { query: 'acme' });
    await tools.run('sprouts_search', { query: 'acme', mode: 'fast' });
    expect(sent[0]?.body).toMatchObject({ category: 'person', mode: 'auto' });
    expect(sent[1]?.body).toMatchObject({ mode: 'fast' });
  });

  it('cap the rows, saying so only when the model asked for more', async () => {
    const { tools, sent } = toolset([searchOk()], { maxResults: 5 });
    const asked = await tools.run('sprouts_search', { query: 'acme', limit: 50 });
    await tools.run('sprouts_search', { query: 'acme' });
    expect([sent[0]?.body, sent[1]?.body]).toMatchObject([{ limit: 5 }, { limit: 5 }]);
    expect(caveatsOf(asked).join(' ')).toContain('limit_capped: you asked for 50 rows');
    const fixed = toolset([searchOk()], { maxResults: 5, fixed: { search: { limit: 50 } } });
    expect(caveatsOf(await fixed.tools.run('sprouts_search', { query: 'acme' })).some((c) => c.startsWith('limit_capped'))).toBe(false);
  });

  it.each([
    [{ include: ['search', 'weather'] }, /Unknown tool 'weather'/],
    [{ include: [] }, /at least one tool/],
    [{ include: 'search' }, /not a single string/],
    [{ fixed: { sprouts_search: { category: 'planet' } } }, /must be one of/],
    [{ fixed: { sprouts_search: { colour: 'red' } } }, /unknown argument/],
    [{ include: ['search'], fixed: { lookup: { category: 'person' } } }, /not in this toolset/],
    [{ fixed: { search: { mode: 'auto' } }, defaults: { search: { mode: 'fast' } } }, /both fixed and defaulted/],
    [{ maxResults: 0 }, /from 1 to 25/],
    [{ maxResults: 26 }, /from 1 to 25/],
    [{ baselineFilters: { industry: [] } }, /non-empty filter object/],
    [{ baselineFilters: { industry: {} } }, /non-empty filter object/],
  ])('refuse invalid options when built (%#)', (options, match) => {
    expect(() => new Toolset(client([]).client, options as unknown as ToolsetOptions)).toThrow(match);
  });

  it('need a SproutsData client, recognised by its brand across copies of the package', () => {
    expect(() => new Toolset({} as SproutsData)).toThrow(/needs a SproutsData client/);
    const made = client([]).client;
    expect(isSproutsData(made)).toBe(true);
    expect(isSproutsData({ [Symbol.for('sproutsdata.client')]: true })).toBe(true);
    expect(isSproutsData(null)).toBe(false);
  });

  it('resolve a client from settings or take the one given, never both', () => {
    const made = client([]).client;
    expect(resolveClient({ client: made })).toBe(made);
    expect(resolveClient({ apiKey: FIXTURE_KEY, baseUrl: BASE_URL })).toBeInstanceOf(SproutsData);
    expect(() => resolveClient({ client: made, maxRetries: 4 })).toThrow(/maxRetries configure a client/);
    expect(() => resolveClient({ client: {} as SproutsData })).toThrow(TypeError);
  });
});

describe('tool rules', () => {
  it.each([
    [{ query: 'x', category: 'auto' }, 'requires `mode: "auto"`'],
    [{ filters: { industry: { include: ['x'] } }, category: 'auto' }, 'needs `query`'],
    [{ query: 'x', category: 'auto', mode: 'auto', include_domains: ['a.com'] }, 'accepts only `query`'],
    [{ query: 'x', category: 'patent', include_domains: ['a.com'] }, 'not `patent`'],
    [{ query: 'x', category: 'patent', filters: { industry: { include: ['x'] } } }, 'a `patent` search takes `query` only'],
    [{ query: 'x', sort: [{ field: 'revenue' }, { field: 'revenue', direction: 'asc' }] }, 'names `revenue` twice'],
  ])('search refuses before sending (%#)', async (args, message) => {
    const { tools, sent } = toolset([searchOk()]);
    expect(messageOf(await tools.run('sprouts_search', args))).toContain(message);
    expect(sent).toHaveLength(0);
  });

  it('send an auto search as asked, and a search its paging and domains', async () => {
    const { tools, sent } = toolset([searchOk()]);
    await tools.run('sprouts_search', { query: 'who raised a Series B', category: 'auto', mode: 'auto' });
    await tools.run('sprouts_search', { query: 'acme', include_domains: ['acme.com'], sort: [{ field: 'revenue', direction: 'desc' }], cursor: 'c1' });
    expect(sent[0]?.body).toEqual({ query: 'who raised a Series B', category: 'auto', mode: 'auto', limit: 10 });
    expect(sent[1]?.body).toMatchObject({ include_domains: ['acme.com'], cursor: 'c1', sort: [{ field: 'revenue', direction: 'desc' }] });
  });

  it.each([
    [{ category: 'patent', ids: ['US1'], by: 'name' }, '`patent` accepts no `by`'],
    [{ category: 'person', ids: ['a'], by: 'domain' }, 'a person has no domain'],
    [{ category: 'company', ids: ['a'], by: 'id' }, 'Allowed: auto, domain, li_url, name.'],
  ])('lookup refuses before sending (%#)', async (args, message) => {
    const { tools, sent } = toolset([lookupOk([])]);
    expect(messageOf(await tools.run('sprouts_entity_lookup', args))).toContain(message);
    expect(sent).toHaveLength(0);
  });

  it('send named document lookups by id unless asked otherwise, and companies by auto', async () => {
    const recorded: Record<string, unknown> = recordedBody('entities_fundings', 'by_name');
    const fundings = respond('entities_fundings', 200, { ...recorded, results: [] });
    const { tools, sent } = toolset([fundings, fundings, lookupOk([])]);
    await tools.run('sprouts_entity_lookup', { category: 'funding_round', ids: ['a9f4c1e07d3b52c8'] });
    await tools.run('sprouts_entity_lookup', { category: 'funding_round', ids: ['Stripe'], by: 'name' });
    await tools.run('sprouts_entity_lookup', { category: 'company', ids: ['acme.com'] });
    expect(sent[0]?.url.pathname).toMatch(/\/v1\/entities\/fundings$/);
    expect(sent.map((s) => s.body)).toEqual([{ ids: ['a9f4c1e07d3b52c8'], by: 'id' }, { ids: ['Stripe'], by: 'name' }, { ids: ['acme.com'], by: 'auto' }]);
  });

  it.each([['patent'], ['trend'], ['academic_report'], ['news_article'], ['market_report'], ['job_opening'], ['person']])('route a %s lookup to its own method', async (category) => {
    const { tools, sent } = toolset([lookupOk([])]);
    await tools.run('sprouts_entity_lookup', { category, ids: ['x'], fields: ['title'] });
    expect(sent).toHaveLength(1);
  });

  it('find a search id whole, not up to a trailing newline', async () => {
    const misses = ['a3f9c2e17b604d58', 'a3f9c2e17b604d58\n'].map((id) => ({ id, category: 'company', found: false, matches: [] }));
    const { tools } = toolset([lookupOk(misses)]);
    const caveats = caveatsOf(await tools.run('sprouts_entity_lookup', { category: 'company', ids: misses.map((m) => m.id) }));
    expect(caveats).toHaveLength(1);
    expect(caveats[0]).toMatch(/^search_ids_not_found: a3f9c2e17b604d58 /);
  });

  it('project lookup fields locally', async () => {
    const hit = recordedBody<{ results: { id: string; matches: Record<string, unknown>[] }[] }>('entities_companies', 'by_domain').results[0];
    const { tools, sent } = toolset([lookupOk([hit])]);
    const result = await tools.run('sprouts_entity_lookup', { category: 'company', ids: [hit?.id ?? ''], by: 'domain', fields: ['country'] });
    expect(sent[0]?.body).not.toHaveProperty('fields');
    const record = 'results' in result ? result.results[0] : undefined;
    expect(Object.keys((record as { matches: Record<string, unknown>[] }).matches[0] ?? {}).sort()).toEqual(['country', 'id']);
  });
});

describe('shaping', () => {
  const resolved = (changes: Record<string, unknown>) => ({ ...recordedBody<{ resolved_search: object }>('search', 'company').resolved_search, ...changes });

  it('say when fast mode parsed nothing, but not for a filters-only search', async () => {
    const { tools } = toolset([searchOk([], { resolved_search: resolved({ filters: {} }) })]);
    expect(caveatsOf(await tools.run('sprouts_search', { query: 'payments companies in Germany' }))[0]).toMatch(/^parser_not_run:/);
    expect(caveatsOf(await tools.run('sprouts_search', { filters: { industry: { include: ['Software & Technology'] } } }))).toEqual([]);
  });

  it('pass the suggestion through, and degradation as caveats', async () => {
    const suggestion = { kind: 'search', category: 'job_opening', message: 'Postings answer this.' };
    const degradation = [{ reason: 'mode_downgraded', detail: 'd', impact: 'recall' }];
    const result = await toolset([searchOk([], { suggestion, degradation })]).tools.run('sprouts_search', { query: 'x' });
    expect('suggestion' in result && result.suggestion).toEqual(suggestion);
    expect(caveatsOf(result)[0]).toBe('mode_downgraded: d (impact: recall)');
  });

  it('say why an empty answer is empty, and what to leave out', async () => {
    const without = [{ filter: 'hq_country', label: 'HQ in Iceland', total: 40 }];
    const suggestion = { kind: 'relax', category: null, message: '0 with every filter; 40 without HQ in Iceland.', without };
    const degradation = [{ reason: 'no_match', impact: 'recall', detail: 'Nothing there has 5,000+.' }];
    const result = await toolset([searchOk([], { total: 0, suggestion, degradation })]).tools.run('sprouts_search', { query: 'companies in Iceland with 5,000+ staff' });
    expect('suggestion' in result && result.suggestion).toEqual({ kind: 'relax', message: suggestion.message, without });
    expect(caveatsOf(result)[0]).toBe('no_match: Nothing there has 5,000+. (impact: recall)');
  });

  it('give rows a lookup only when lookup is offered, and count rows with none', async () => {
    expect(rowsOf(await toolset([searchOk([companyRow()])], { include: ['search'] }).tools.run('sprouts_search', { query: 'acme' }))[0]).not.toHaveProperty('lookup');
    const bare = companyRow({ domain: undefined, linkedin_url: undefined });
    const result = await toolset([searchOk([bare])]).tools.run('sprouts_search', { query: 'acme' });
    expect(rowsOf(result)[0]).not.toHaveProperty('lookup');
    expect(caveatsOf(result).at(-1)).toMatch(/^rows_without_lookup: 1 of 1 rows/);
  });

  it('cut long text, drop empty values, and cap long lists with the wanted values first', async () => {
    const row = companyRow({ description: 'word '.repeat(400), city: '', technologies: Array.from({ length: 20 }, (_, i) => `T${String(i)}`) });
    const result = await toolset([searchOk([row])]).tools.run('sprouts_search', { query: 'acme', fields: ['description', 'city', 'technologies'] });
    const shaped = rowsOf(result)[0] ?? {};
    expect(String(shaped['description']).endsWith(String.fromCodePoint(0x2026))).toBe(true);
    expect(shaped).not.toHaveProperty('city');
    expect((shaped['technologies'] as string[]).at(-1)).toMatch(/\+5 more$/);
  });

  it('call out anchors, and drop an anchor returned as its own look-alike', async () => {
    const rows = [companyRow({ id: 'acme.com', domain: 'acme.com' }), companyRow({ id: 'b.com', domain: 'b.com' })];
    const { tools, sent } = toolset([similarOk(rows)]);
    const result = await tools.run('sprouts_similar', {
      anchors: [{ value: 'https://www.ACME.com/about' }, { value: 'Beta Corp', by: 'name' }, { value: 'c.com', weight: 0 }],
      cursor: 'c1',
    });
    expect(rowsOf(result).map((r) => r['id'])).toEqual(['b.com']);
    const caveats = caveatsOf(result);
    expect(caveats.some((c) => c.startsWith('anchors_unreported: the API does not report which of the 3'))).toBe(true);
    expect(caveats.some((c) => c.startsWith('anchors_by_name: Beta Corp'))).toBe(true);
    expect(caveats).toContain('anchors_zero_weight: c.com — weight 0, so no influence on the result.');
    expect(caveats.at(-1)).toMatch(/^anchors_removed: acme\.com/);
    expect(sent[0]?.body).toMatchObject({ cursor: 'c1' });
  });
});

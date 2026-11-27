/** Lookups by identifier (N1-N6): what is sent, what is applied locally, what is read. */

import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ClientValidationError } from '../../src/core/errors.js';
import { RECORD_TYPES } from '../../src/generated/record-shapes.js';
import { Entities } from '../../src/resources/entities.js';
import { entityHit, lookupRef, missingValues, recordsOf } from '../../src/resources/helpers.js';
import type { EntitiesEnvelope, SearchEnvelope } from '../../src/types/index.js';
import { assertValidRequest, recorded, recordedBody, respond } from '../support/answers.js';
import { rig } from '../support/rig.js';

const FIXTURES = new URL('../../../../spec/fixtures/responses/', import.meta.url).pathname;
const LOOKUPS = readdirSync(FIXTURES)
  .filter((folder) => folder.startsWith('entities_'))
  .flatMap((folder) => readdirSync(`${FIXTURES}${folder}`).map((file) => [folder, file.replace('.json', '')] as const));

describe('entities', () => {
  it('N1: companies never send fields and project them locally', async () => {
    const r = rig([recorded('entities_companies', 'by_domain')]);
    const answer = await new Entities(r.transport).companies({ ids: ['example-1.de'], by: 'domain', fields: ['account_name'] });
    expect(r.body()).toEqual({ ids: ['example-1.de'], by: 'domain' });
    assertValidRequest('entities_companies', r.body());
    const matches = answer.results.flatMap((hit) => hit.matches);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => Object.keys(m).every((k) => k === 'id' || k === 'account_name') && 'id' in m)).toBe(true);
  });

  it('N1: documents send fields as their schema takes them', async () => {
    const r = rig([recorded('entities_patents', 'by_id'), recorded('entities_news', 'by_name')]);
    const entities = new Entities(r.transport);
    await entities.patents({ ids: ['d1_x'], fields: ['title'] });
    await entities.news({ ids: ['Battery news'], fields: ['*'] });
    expect([r.body(0), r.body(1)]).toEqual([{ ids: ['d1_x'], fields: ['title'] }, { ids: ['Battery news'], fields: ['*'] }]);
    assertValidRequest('entities_patents', r.body(0));
    assertValidRequest('entities_news', r.body(1));
  });

  it('N2: by defaults to auto for companies and persons, and to the server for documents', async () => {
    const r = rig([recorded('entities_companies', 'by_domain'), recorded('entities_persons', 'by_li_url'), recorded('entities_fundings', 'by_name'), recorded('entities_companies', 'by_domain')]);
    const entities = new Entities(r.transport);
    await entities.companies({ ids: ['stripe.com'] });
    await entities.persons({ ids: ['https://www.linkedin.com/in/x'] });
    await entities.fundings({ ids: ['Stripe'] });
    await entities.companies({ ids: ['record-id'], by: null });
    expect(r.sent.map((s) => (s.body as { by?: string }).by)).toEqual(['auto', 'auto', undefined, undefined]);
    await expect(entities.persons({ ids: ['x'], by: 'domain' as 'li_url' })).rejects.toThrow('by: must be one of');
    await expect(entities.patents({ ids: ['d1_x'], by: 'id' } as never)).rejects.toThrow('by: not a field this request takes');
  });

  it('N2: every document kind is looked up on its own route', async () => {
    const r = rig([recorded('entities_academic_reports', 'by_id'), recorded('entities_trends', 'by_id'), recorded('entities_market_reports', 'by_name'), recorded('entities_job_openings', 'by_name')]);
    const entities = new Entities(r.transport);
    await entities.academicReports({ ids: ['d1_x'] });
    await entities.trends({ ids: ['d1_x'] });
    await entities.marketReports({ ids: ['d1_x'], by: 'id' });
    await entities.jobOpenings({ ids: ['Engineer'], by: 'name' });
    expect(r.sent.map((s) => s.url.pathname.replace('/backend', ''))).toEqual(['/v1/entities/academic-reports', '/v1/entities/trends', '/v1/entities/market-reports', '/v1/entities/job-openings']);
  });

  it('N3: caps are checked before sending', async () => {
    const r = rig([]);
    const entities = new Entities(r.transport);
    await expect(entities.companies({ ids: Array.from({ length: 51 }, (_, i) => `c${String(i)}.de`) })).rejects.toThrow('capped at 50 per call');
    await expect(entities.news({ ids: Array.from({ length: 51 }, (_, i) => `n${String(i)}`) })).rejects.toThrow('a name search is capped at 50');
    await expect(entities.patents({ ids: Array.from({ length: 101 }, (_, i) => `d1_${String(i)}`) })).rejects.toThrow('ids: must be at most 100 entries');
    await expect(entities.companies({ ids: Array.from({ length: 1001 }, (_, i) => String(i)), by: null })).rejects.toThrow('ids: must be at most 1000 entries');
    await expect(entities.trends({ ids: 'd1_x' as unknown as string[] })).rejects.toBeInstanceOf(ClientValidationError);
    expect(r.sent).toHaveLength(0);
  });

  it('N3: a thousand internal record ids and a hundred document ids are sent', async () => {
    const r = rig([recorded('entities_companies', 'by_domain'), recorded('entities_news', 'by_name')]);
    const entities = new Entities(r.transport);
    await entities.companies({ ids: Array.from({ length: 1000 }, (_, i) => String(i)), by: null });
    await entities.news({ ids: Array.from({ length: 100 }, (_, i) => `d1_${String(i)}`), by: 'id' });
    expect((r.body(0) as { ids: string[] }).ids).toHaveLength(1000);
    expect((r.body(1) as { ids: string[] }).ids).toHaveLength(100);
  });

  it('N4: found values come first, and entityHit and missingValues read them', async () => {
    const body = recordedBody<EntitiesEnvelope>('entities_companies', 'by_domain');
    const hit = body.results[0];
    if (hit === undefined) throw new Error('fixture has a row');
    const r = rig([respond('entities_companies', 200, { ...body, results: [hit, { id: 'nope.de', category: 'company', found: false, matches: [] }], total: 2 })]);
    const answer = await new Entities(r.transport).companies({ ids: ['nope.de', hit.id], by: 'domain' });
    expect(answer.results.map((h) => h.id)).toEqual([hit.id, 'nope.de']);
    expect(entityHit(answer, 'nope.de')?.found).toBe(false);
    expect(entityHit(answer, 'absent.de')).toBeUndefined();
    expect(missingValues(answer)).toEqual(['nope.de']);
  });

  it.each(LOOKUPS)('N5: %s/%s reads as typed records', (folder, file) => {
    const answer = recordedBody<EntitiesEnvelope>(folder, file);
    for (const hit of answer.results) {
      const records = recordsOf(hit);
      expect(records).toHaveLength(hit.matches.length);
      expect(RECORD_TYPES[hit.category]).toBeDefined();
      records.forEach((record, index) => {
        expect((record as { id?: unknown }).id).toBe(hit.matches[index]?.['id']);
      });
    }
  });

  it('N6: a document search row is a lookup key', async () => {
    const hit = recordedBody<SearchEnvelope>('search', 'patent').results[0];
    if (hit === undefined) throw new Error('fixture has a row');
    const ref = lookupRef(hit);
    expect(ref?.by).toBeUndefined();
    const r = rig([recorded('entities_patents', 'by_id')]);
    await new Entities(r.transport).patents({ ids: [ref?.value ?? ''] });
    expect(r.body()).toEqual({ ids: [hit.id] });
  });
});

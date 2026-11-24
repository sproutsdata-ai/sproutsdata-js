/** Prism's records read as their types: flexible lists made lists, nested records alike. */

import { describe, expect, it } from 'vitest';

import { asRecords } from '../../src/core/records.js';

describe('records', () => {
  it('makes each flexible list a list, in nested records too', () => {
    const [company] = asRecords('company', [
      { id: 'a.de', naics: '5112', technology: null, office_locations: { city: 'Berlin' }, subsidiaries: [{ name: 'B' }, 'x'], parent_organization: { name: 'P' } },
    ]);
    expect(company).toMatchObject({ id: 'a.de', naics: ['5112'], technology: [], subsidiaries: [{ name: 'B' }, 'x'], parent_organization: { name: 'P' } });
    expect((company as { office_locations: unknown }).office_locations).toEqual([{ city: 'Berlin' }]);
  });

  it('keeps a record of a category it has no type for as it came', () => {
    expect(asRecords('galaxy', [{ id: 'x', tags: 'one' }])).toEqual([{ id: 'x', tags: 'one' }]);
  });
});

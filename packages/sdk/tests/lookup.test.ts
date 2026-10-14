import { describe, expect, it } from 'vitest';

import { lookupRef, type SearchHit } from '../src/index';

function hit(fields: Record<string, unknown>): SearchHit {
  return { id: '56066cb6ead0c44d', score: 1, ...fields } as SearchHit;
}

describe('lookupRef', () => {
  it("looks a company up by its domain, never by the search id", () => {
    expect(lookupRef(hit({ category: 'company', domain: 'stripe.com' }))).toEqual({
      by: 'domain',
      value: 'stripe.com',
    });
  });

  it('falls back to the LinkedIn page for a company with no domain', () => {
    const url = 'https://www.linkedin.com/company/stripe';
    expect(lookupRef(hit({ category: 'company', domain: '', linkedin_url: url }))).toEqual({
      by: 'li_url',
      value: url,
    });
  });

  it('looks a person up by their LinkedIn profile', () => {
    const url = 'https://www.linkedin.com/in/ada';
    expect(lookupRef(hit({ category: 'person', linkedin_url: url }))).toEqual({ by: 'li_url', value: url });
  });

  it.each([
    ['a company with neither identifier', { category: 'company' }],
    ['a person with no LinkedIn profile', { category: 'person', linkedin_url: '' }],
    ['a document hit, whose id resolves nowhere', { category: 'patent', domain: 'x.com' }],
  ])('is null for %s', (_label, fields) => {
    expect(lookupRef(hit(fields))).toBeNull();
  });
});

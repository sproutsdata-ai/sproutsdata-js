/** What the generated types accept and refuse: the IR's direction policy, in TypeScript. */

import { describe, expectTypeOf, it } from 'vitest';

import type { OperationMap, Operations, OperationSpec } from '../../src/generated/operations.js';
import type * as W from '../../src/generated/wire.js';

describe('generated types', () => {
  it('opens a response enum: a member this release does not know still type-checks', () => {
    expectTypeOf<'a_reason_invented_later'>().toExtend<W.DegradationReason>();
    expectTypeOf<'pagination_truncated'>().toExtend<W.DegradationReason>();
  });

  it('closes a request enum: only the values the server accepts', () => {
    expectTypeOf<'company'>().toExtend<W.ResultCategoryInput>();
    expectTypeOf<'a_category_invented_later'>().not.toExtend<W.ResultCategoryInput>();
  });

  it('makes request fields optional unless the server requires them', () => {
    expectTypeOf<{ category: 'company' }>().toExtend<W.EntitySearchRequest>();
    expectTypeOf<{ value: string }>().toExtend<W.RelationshipCompany>();
    expectTypeOf<Record<string, never>>().not.toExtend<W.RelationshipCompany>();
  });

  it('keeps every field of an API response present, nullable where the schema says', () => {
    expectTypeOf<W.SearchEnvelope['next_cursor']>().toEqualTypeOf<string | null>();
    expectTypeOf<W.SearchEnvelope['results']>().toEqualTypeOf<readonly W.SearchHit[]>();
  });

  it('lets a record field be absent, but always gives a flexible list as an array', () => {
    expectTypeOf<W.CompanyRecord['domain']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<W.CompanyRecord['technology']>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<W.CompanyRecord['id']>().toEqualTypeOf<string>();
  });

  it('spells a nested readonly array correctly', () => {
    expectTypeOf<W.TermsFilter['include_groups']>().toEqualTypeOf<readonly (readonly string[])[] | null | undefined>();
  });

  it('gives every operation a valid spec and its bound types', () => {
    expectTypeOf<Operations[keyof Operations]>().toExtend<OperationSpec>();
    expectTypeOf<OperationMap['search']['body']>().toEqualTypeOf<W.SearchBody>();
    expectTypeOf<OperationMap['listsExport']['responses']>().toEqualTypeOf<{ 200: 'text/csv'; 202: W.ExportJobView }>();
    expectTypeOf<OperationMap['listsDelete']['responses']>().toEqualTypeOf<{ 204: undefined }>();
  });
});

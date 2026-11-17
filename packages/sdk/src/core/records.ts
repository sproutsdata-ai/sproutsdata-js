/**
 * Prism's records, read as their types: each flexible list made a list (the index stores a
 * one-value list as the value, and an absent one as null), nested records alike.
 *
 * The record types are generated from prism's verified models (`records.schema.json`); the
 * SDK does not validate at run time, so this is the one place a record is given its type.
 */

import { RECORD_SHAPES, RECORD_TYPES } from '../generated/record-shapes.js';
import type * as W from '../generated/wire.js';
import { isRecord } from './errors.js';

/** The record type of each result category. */
export interface RecordTypes {
  readonly company: W.CompanyRecord;
  readonly person: W.PersonRecord;
  readonly patent: W.PatentRecord;
  readonly news_article: W.NewsRecord;
  readonly market_report: W.MarketReportRecord;
  readonly trend: W.TrendRecord;
  readonly funding_round: W.FundingRecord;
  readonly academic_report: W.AcademicReportRecord;
  readonly job_opening: W.JobOpeningRecord;
}

/** Any record. */
export type AnyRecord = RecordTypes[keyof RecordTypes];

/** Each of `matches` as the record type of `category` (unknown fields kept). */
export function asRecords(category: string, matches: readonly Readonly<Record<string, unknown>>[]): AnyRecord[] {
  const type = RECORD_TYPES[category];
  return matches.map((match) => (type === undefined ? match : normalise(type, match)) as AnyRecord);
}

function normalise(type: string, raw: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const shape = RECORD_SHAPES[type];
  if (shape === undefined) return raw;
  const out: Record<string, unknown> = { ...raw };
  for (const name of shape.lists) out[name] = asList(raw[name]);
  for (const [name, inner] of Object.entries(shape.nested)) {
    const value = out[name];
    if (Array.isArray(value)) out[name] = value.map((entry: unknown) => (isRecord(entry) ? normalise(inner, entry) : entry));
    else if (isRecord(value)) out[name] = normalise(inner, value);
  }
  return out;
}

function asList(value: unknown): readonly unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

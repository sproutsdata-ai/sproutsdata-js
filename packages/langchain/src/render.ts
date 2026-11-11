/**
 * Raw record → `pageContent`: a short, LLM-legible line, not a JSON dump.
 *
 * Lossy by design (a 31-field company row does not belong in a prose field), which is acceptable
 * only because `metadata.record` always carries the complete row. `contentFields` lets an
 * integration pick its own fields without the RunnableLambda every chain would otherwise repeat.
 */

type RawRecord = Readonly<Record<string, unknown>>;

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function fieldValue(value: unknown): string | undefined {
  if (!Array.isArray(value)) return text(value);
  const entries = value.map(text).filter((entry) => entry !== undefined);
  return entries.length > 0 ? entries.join(', ') : undefined;
}

function firstPresent(record: RawRecord, keys: readonly string[]): string | undefined {
  return keys.map((key) => text(record[key])).find((value) => value !== undefined);
}

/** The parts that are present, joined. */
function joined(parts: readonly (string | undefined)[], separator: string): string {
  return parts.filter((part) => part !== undefined && part !== '').join(separator);
}

function sentence(head: string, pointer: string | undefined): string {
  return joined([head === '' ? undefined : `${head}.`, pointer], ' ');
}

function renderCompany(record: RawRecord): string {
  const employees = text(record['employee_count']);
  const location = joined([text(record['city']), text(record['country'])], ', ');
  const detail = joined([text(record['industry']), employees === undefined ? undefined : `${employees} employees`, location], ', ');
  return sentence(joined([text(record['account_name']), detail], ' — '), text(record['domain']));
}

function renderPerson(record: RawRecord): string {
  const company = text(record['account_name']);
  const role = joined([text(record['job_title']), company === undefined ? undefined : `at ${company}`], ' ');
  return sentence(joined([text(record['contact_name']), role], ' — '), text(record['linkedin_url']));
}

function renderDefault(record: RawRecord): string {
  switch (record['category']) {
    case 'company':
      return renderCompany(record);
    case 'person':
      return renderPerson(record);
    default:
      // Every document category has a `title` and a `summary`.
      return joined([firstPresent(record, ['title', 'name', 'account_name', 'contact_name']), firstPresent(record, ['summary', 'description'])], '\n');
  }
}

/** The document text for one row: its `contentFields` as lines, else a per-category line, never empty. */
export function renderPageContent(record: RawRecord, contentFields?: readonly string[]): string {
  const rendered =
    contentFields !== undefined && contentFields.length > 0
      ? joined(contentFields.map((field) => {
          const value = fieldValue(record[field]);
          return value === undefined ? undefined : `${field}: ${value}`;
        }), '\n')
      : renderDefault(record);
  // Never an empty pageContent: an empty document reads as a bug five frames into someone's
  // chain, while raw JSON is at least inspectable.
  return rendered === '' ? JSON.stringify(record) : rendered;
}

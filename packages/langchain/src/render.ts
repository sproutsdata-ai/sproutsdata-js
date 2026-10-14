/**
 * Raw record → `page_content`: a short, LLM-legible line, not a JSON dump.
 *
 * The rendering is lossy by design — a 31-field company row does not belong
 * in a prose field — and that is acceptable only because `metadata.record`
 * always carries the complete row. `contentFields` lets an integration pick
 * its own fields without writing the RunnableLambda every chain would
 * otherwise repeat.
 */

/** Loosely-typed record access: search hits are open-ended by contract. */
type RawRecord = Record<string, unknown>;

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function fieldValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const entries = value.map(text).filter((v): v is string => v !== undefined);
    return entries.length > 0 ? entries.join(', ') : undefined;
  }
  return text(value);
}

function firstPresent(record: RawRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** `{headline}\n{body}`, skipping whichever half is missing. */
function headlineBody(headline: string | undefined, body: string | undefined): string {
  return [headline, body].filter((part): part is string => part !== undefined).join('\n');
}

function renderCompany(record: RawRecord): string {
  const name = text(record.account_name);
  const industry = text(record.industry);
  const employees = text(record.employee_count);
  const location = text(record.location);
  const domain = text(record.domain);

  const detail = [
    industry,
    employees !== undefined ? `${employees} employees` : undefined,
    location,
  ]
    .filter((part): part is string => part !== undefined)
    .join(', ');

  const head = [name, detail.length > 0 ? detail : undefined]
    .filter((part): part is string => part !== undefined)
    .join(' — ');
  return [head.length > 0 ? `${head}.` : undefined, domain]
    .filter((part): part is string => part !== undefined)
    .join(' ');
}

function renderPerson(record: RawRecord): string {
  const name = text(record.contact_name);
  const title = text(record.title);
  const company = text(record.account_name);
  const linkedin = text(record.linkedin_url);

  const role = [title, company !== undefined ? `at ${company}` : undefined]
    .filter((part): part is string => part !== undefined)
    .join(' ');
  const head = [name, role.length > 0 ? role : undefined]
    .filter((part): part is string => part !== undefined)
    .join(' — ');
  return [head.length > 0 ? `${head}.` : undefined, linkedin]
    .filter((part): part is string => part !== undefined)
    .join(' ');
}

export function renderPageContent(record: RawRecord, contentFields?: string[]): string {
  if (contentFields !== undefined && contentFields.length > 0) {
    const lines = contentFields
      .map((field) => {
        const value = fieldValue(record[field]);
        return value !== undefined ? `${field}: ${value}` : undefined;
      })
      .filter((line): line is string => line !== undefined);
    if (lines.length > 0) return lines.join('\n');
  } else {
    switch (record.category) {
      case 'company': {
        const rendered = renderCompany(record);
        if (rendered.length > 0) return rendered;
        break;
      }
      case 'person': {
        const rendered = renderPerson(record);
        if (rendered.length > 0) return rendered;
        break;
      }
      case 'news_article': {
        const rendered = headlineBody(text(record.title), text(record.snippet));
        if (rendered.length > 0) return rendered;
        break;
      }
      case 'patent': {
        const rendered = headlineBody(text(record.title), text(record.abstract));
        if (rendered.length > 0) return rendered;
        break;
      }
      default: {
        const rendered = headlineBody(
          firstPresent(record, ['title', 'name', 'account_name', 'contact_name']),
          firstPresent(record, ['snippet', 'description', 'abstract', 'summary']),
        );
        if (rendered.length > 0) return rendered;
      }
    }
  }
  // Never an empty page_content: an empty document reads as a bug five
  // frames into someone's chain, while raw JSON is at least inspectable.
  return JSON.stringify(record);
}

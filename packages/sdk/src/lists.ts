/**
 * The `/v1/lists` surface (`client.lists`) — saved lists — and the CSV export
 * both lists and search results share.
 *
 * A list belongs to the workspace, not to one key: every key and dashboard
 * user of it sees the same lists. Every call is free. Records are named by
 * their natural id — a company's domain, a person's LinkedIn URL, a patent
 * number, a DOI — never by a search hit's `id`, which for people and
 * documents is a one-way hash that cannot be read back later.
 *
 * Requires `dsp.search.read` or `dsp.entities.read`. Both exports answer
 * `404 export.not_enabled` ({@link NotFoundError}) on a deployment where CSV
 * export is switched off, which it is until export pricing ships.
 */

import type { RawResponse, RequestOptions } from './http';
import { laterPageOptions } from './paginate';
import { APIResource } from './resource';
import type { EntityCategory } from './types';
import { ensure, pathSegment } from './validate';

/** One record to save, remove or export. */
export interface ItemRef {
  entity_category: EntityCategory;
  /**
   * The record's natural id: a company's domain, a person's LinkedIn URL, a
   * patent number, a DOI, a trend name, or the id its entity lookup takes.
   * Normalised by the server (a domain lower-cased and stripped of scheme and
   * `www.`; a LinkedIn URL reduced to `linkedin.com/in/<slug>`).
   */
  entity_id: string;
}

/** `free` — the fields a result card shows. `unlocked` — the full record, for a workspace that bought credits. */
export type FieldTier = 'free' | 'unlocked' | (string & {});

/** One saved list. */
export interface SavedList {
  /** Opaque (a UUID). What every other `lists` call takes. */
  id: string;
  /** 1–120 characters. Names need not be unique. */
  name: string;
  /** The dashboard user who made it; null when an API key did. */
  created_by: number | null;
  created_at: string;
  updated_at: string;
  item_count: number;
}

/** Response of `GET /v1/lists`: every list in the workspace, newest first. */
export interface ListsResponse {
  lists: SavedList[];
  /** Distinct records saved across all of this workspace's lists. */
  saved_items: number;
  /**
   * How many distinct records the workspace may save, or null when it has no
   * cap. Only free workspaces have one; a record already saved in another
   * list does not count twice.
   */
  saved_items_cap: number | null;
  field_tier: FieldTier;
}

/** One record in a list, read fresh from the index. */
export interface SavedItem {
  entity_category: string;
  /** The normalised id the item was saved under. */
  entity_id: string;
  added_at: string;
  /** The dashboard user who added it; null when an API key did. */
  added_by: number | null;
  /** False when the record cannot be read right now. The item stays in the list either way. */
  available: boolean;
  /** `not_found` — no record for this id. `retrieval_unavailable` — reading failed this time. */
  unavailable_reason?: 'not_found' | 'retrieval_unavailable' | (string & {}) | null;
  /** The current record, with the fields `field_tier` allows; null when unavailable. */
  record: Record<string, unknown> | null;
}

/** Response of `GET /v1/lists/{list_id}/items`: one page, newest first. */
export interface ListItemsResponse {
  saved_list: SavedList;
  items: SavedItem[];
  /** Pass as `cursor` for the next page; null on the last. */
  next_cursor: string | null;
  field_tier: FieldTier;
}

/** Query for `GET /v1/lists/{list_id}/items`. */
export interface ListItemsParams {
  /** Items per page. Defaults to 25 on the server, at most 100. */
  limit?: number;
  /** `next_cursor` from the page before. */
  cursor?: string;
}

/** Response of `POST /v1/lists/{list_id}/items`. */
export interface AddItemsResponse {
  saved_list: SavedList;
  added: number;
  /** Items the list already held. Adding is idempotent: a repeat is counted here, not added twice. */
  already_present: number;
  /** Items refused because the record is on the Do-Not-Contact list; never stored or returned. */
  suppressed: number;
}

/** Response of `DELETE /v1/lists/{list_id}/items`. */
export interface RemoveItemsResponse {
  saved_list: SavedList;
  /** Items actually removed. Naming one the list does not hold is not an error. */
  removed: number;
}

/** Body for `POST /v1/search/export`. */
export interface SearchExportParams {
  /** The records, at most 1,000. */
  items: ItemRef[];
  /** The `meta.request_id` of the search they came from, for attribution. Optional. */
  request_id?: string;
}

/**
 * A CSV file from `lists.export` or `searchExport`. The columns are
 * `entity_category`, `entity_id`, then each record field as a dotted path.
 * Records that could not be read are left out and counted in `skipped`;
 * Do-Not-Contact records are left out silently.
 */
export interface CsvExport {
  /** The file, UTF-8. */
  content: Uint8Array;
  /** The file as a string. */
  text(): string;
  /** The name the server suggests, from `Content-Disposition`. */
  filename: string | null;
  /** Which fields the rows carry. */
  field_tier: FieldTier | null;
  row_count: number | null;
  skipped: number | null;
  /** What the export cost. Exports are free today, so `0`. */
  credits_charged: number | null;
  request_id: string | null;
}

const FILENAME = /filename="?([^";]+)"?/;

function headerNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The file, and what the server said about it in its headers. */
export function toCsvExport(raw: RawResponse): CsvExport {
  const { headers, body } = raw;
  const filename = FILENAME.exec(headers['content-disposition'] ?? '')?.[1] ?? null;
  return {
    content: body,
    text: () => new TextDecoder('utf-8').decode(body),
    filename,
    field_tier: headers['x-export-field-tier'] ?? null,
    row_count: headerNumber(headers['x-export-row-count']),
    skipped: headerNumber(headers['x-export-skipped']),
    credits_charged: headerNumber(headers['x-credits-charged']),
    request_id: headers['x-request-id'] ?? null,
  };
}

/**
 * Check an `items` array's shape, and keep only `entity_category` and
 * `entity_id`. How many fit in one call is the server's to say; the likeliest mistake — passing search hits, whose `id` is a hash for
 * people and documents — is caught here, because it would otherwise save a
 * record that can never be read back.
 */
export function checkItems(items: unknown): ItemRef[] {
  ensure(Array.isArray(items), '`items` must be an array of `{ entity_category, entity_id }`');
  ensure(items.length > 0, '`items` is empty: name at least one record');
  return items.map((item: unknown, i) => {
    const ref = item as Partial<ItemRef> | null;
    ensure(
      ref !== null && typeof ref === 'object' && 'entity_category' in ref && 'entity_id' in ref,
      `\`items[${i}]\` needs \`entity_category\` and \`entity_id\` — the record's natural id: a ` +
        "company's domain, a person's LinkedIn URL, a patent number or a DOI. A search hit's `id` is not one.",
    );
    ensure(
      typeof ref.entity_id === 'string' && ref.entity_id.trim().length > 0,
      `\`items[${i}].entity_id\` must be a non-blank string`,
    );
    // Only the two keys travel: the API refuses any other, so items read back
    // from `items()` can be passed as they are.
    return { entity_category: ref.entity_category as ItemRef['entity_category'], entity_id: ref.entity_id };
  });
}

function checkName(name: unknown): string {
  ensure(typeof name === 'string' && name.trim().length > 0, 'A list needs a name: a non-blank string');
  return name;
}

export class Lists extends APIResource {
  /** Every saved list in the workspace, newest first, with the saved-items count and cap. Not paginated. */
  async list(options?: RequestOptions): Promise<ListsResponse> {
    return this.transport.request('GET', '/v1/lists', { options });
  }

  /**
   * Make a list. Not repeated after a failure that may have reached the
   * server — a repeat would make a second list — so check `list()` first.
   */
  async create(name: string, options?: RequestOptions): Promise<SavedList> {
    return this.transport.request('POST', '/v1/lists', {
      body: { name: checkName(name) },
      routeClass: 'once',
      options,
    });
  }

  /**
   * Rename a list. A list that does not exist, was deleted, or belongs to
   * another workspace is a {@link NotFoundError} (`lists.not_found`).
   */
  async rename(listId: string, name: string, options?: RequestOptions): Promise<SavedList> {
    return this.transport.request('PATCH', `/v1/lists/${pathSegment(listId)}`, {
      body: { name: checkName(name) },
      routeClass: 'safe',
      options,
    });
  }

  /**
   * Delete a list and its items. Not repeated after a failure that may have
   * reached the server: a repeat of a delete that succeeded would answer
   * `lists.not_found`.
   */
  async delete(listId: string, options?: RequestOptions): Promise<void> {
    await this.transport.request<undefined>('DELETE', `/v1/lists/${pathSegment(listId)}`, {
      routeClass: 'once',
      options,
    });
  }

  /**
   * One page of a list's items, newest first, each read fresh from the
   * index. An item whose record cannot be read is still returned, with
   * `available: false`. Use {@link Lists.iterItems} to walk every page.
   */
  async items(
    listId: string,
    params: ListItemsParams = {},
    options?: RequestOptions,
  ): Promise<ListItemsResponse> {
    const query = {
      limit: params.limit === undefined ? undefined : String(params.limit),
      cursor: params.cursor,
    };
    return this.transport.request('GET', `/v1/lists/${pathSegment(listId)}/items`, { query, options });
  }

  /**
   * Every item in a list, following `next_cursor` page by page.
   * `options.requestId` goes with the first page only.
   */
  async *iterItems(
    listId: string,
    params: Omit<ListItemsParams, 'cursor'> = {},
    options?: RequestOptions,
  ): AsyncGenerator<SavedItem, void, undefined> {
    const later = laterPageOptions(options ?? {});
    let cursor: string | undefined;
    for (let first = true; ; first = false) {
      const page = await this.items(listId, { ...params, cursor }, first ? options : later);
      yield* page.items;
      if (page.next_cursor === null || page.next_cursor === undefined || page.items.length === 0) return;
      cursor = page.next_cursor;
    }
  }

  /**
   * Save records to a list — at most 500 per call. Idempotent: a record the
   * list already holds is counted in `already_present`, so a retry is safe.
   * Do-Not-Contact records are refused and counted in `suppressed`. Over a
   * free workspace's saved-items cap, a {@link ConflictError}
   * (`lists.item_cap_reached`): nothing was added, and `error.problem.extra`
   * has `cap`, `saved` and `adding`.
   */
  async addItems(listId: string, items: ItemRef[], options?: RequestOptions): Promise<AddItemsResponse> {
    return this.transport.request('POST', `/v1/lists/${pathSegment(listId)}/items`, {
      body: { items: checkItems(items) },
      routeClass: 'safe',
      options,
    });
  }

  /** Remove records from a list. Naming one the list does not hold is not an error. */
  async removeItems(
    listId: string,
    items: ItemRef[],
    options?: RequestOptions,
  ): Promise<RemoveItemsResponse> {
    return this.transport.request('DELETE', `/v1/lists/${pathSegment(listId)}/items`, {
      body: { items: checkItems(items) },
      routeClass: 'safe',
      options,
    });
  }

  /**
   * The whole list as a CSV file, at most 1,000 rows. A
   * {@link NotFoundError} with code `export.not_enabled` while export is
   * switched off. Free today, but retried like a billed call — it carries an
   * `Idempotency-Key` and a lost answer is not repeated — because the server
   * prices exports through the same meter once export pricing ships.
   */
  async export(listId: string, options?: RequestOptions): Promise<CsvExport> {
    const raw = await this.transport.requestBytes('POST', `/v1/lists/${pathSegment(listId)}/export`, {
      routeClass: 'billed',
      options,
    });
    return toCsvExport(raw);
  }
}

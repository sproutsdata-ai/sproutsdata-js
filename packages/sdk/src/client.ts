/**
 * `SproutsData`: options, the transport and the resources, wired together. The searches and
 * catalogues are methods of the client itself (`client.search(...)`); every other feature is a
 * resource (`client.runs.create(...)`), built on first use. No request logic lives here.
 */

import { resolveOptions, type ClientOptions } from './core/options.js';
import { Transport } from './core/transport.js';
import { Coverage } from './resources/coverage.js';
import { Credits } from './resources/credits.js';
import { Entities } from './resources/entities.js';
import { Exports, SearchExport } from './resources/exports.js';
import { Feedback } from './resources/feedback.js';
import { History } from './resources/history.js';
import { Lists } from './resources/lists.js';
import { OrgChart } from './resources/org-chart.js';
import { Relationships } from './resources/relationships.js';
import { Runs } from './resources/runs.js';
import { Search } from './resources/search.js';
import { Vocabulary } from './resources/vocabulary.js';

export class SproutsData {
  /** Search the index: one page. See {@link Search.search}. */
  readonly search: Search['search'];
  /** Every result of a search, page after page. See {@link Search.iterSearch}. */
  readonly iterSearch: Search['iterSearch'];
  /** Companies like the ones named: one page. See {@link Search.similar}. */
  readonly similar: Search['similar'];
  /** Every look-alike, page after page. See {@link Search.iterSimilar}. */
  readonly iterSimilar: Search['iterSimilar'];
  /** One page of what a filter accepts. See {@link Vocabulary.filterValues}. */
  readonly filterValues: Vocabulary['filterValues'];
  /** Every value a filter accepts. See {@link Vocabulary.iterFilterValues}. */
  readonly iterFilterValues: Vocabulary['iterFilterValues'];
  /** One page of what a document filter accepts. See {@link Vocabulary.documentFilterValues}. */
  readonly documentFilterValues: Vocabulary['documentFilterValues'];
  /** Every value a document filter accepts. See {@link Vocabulary.iterDocumentFilterValues}. */
  readonly iterDocumentFilterValues: Vocabulary['iterDocumentFilterValues'];
  /** The fields a category's search sorts on. See {@link Vocabulary.sorts}. */
  readonly sorts: Vocabulary['sorts'];
  /** How many records the index holds. See {@link Coverage.coverage}. */
  readonly coverage: Coverage['coverage'];
  /** Export search rows as CSV, at once or as a job. See {@link SearchExport.searchExport}. */
  readonly searchExport: SearchExport['searchExport'];

  readonly #transport: Transport;
  #entities: Entities | undefined;
  #runs: Runs | undefined;
  #relationships: Relationships | undefined;
  #orgChart: OrgChart | undefined;
  #lists: Lists | undefined;
  #exports: Exports | undefined;
  #history: History | undefined;
  #feedback: Feedback | undefined;
  #credits: Credits | undefined;

  /**
   * Make a client. Nothing is sent until the first call. `apiKey` defaults to
   * `SPROUTSDATA_API_KEY` and `baseUrl` to `SPROUTSDATA_BASE_URL`, else
   * `https://api.sproutsdata.ai`. A key is a server-side secret: the client refuses to run in a
   * browser, and the server refuses a key that comes with an `Origin`.
   *
   * @throws {ClientValidationError} A setting is missing or invalid.
   */
  constructor(options: ClientOptions = {}) {
    this.#transport = new Transport(resolveOptions(options));
    const search = new Search(this.#transport);
    const vocabulary = new Vocabulary(this.#transport);
    const coverage = new Coverage(this.#transport);
    const searchExport = new SearchExport(this.#transport);
    this.search = (params, call) => search.search(params, call);
    this.iterSearch = (params, call) => search.iterSearch(params, call);
    this.similar = (params, call) => search.similar(params, call);
    this.iterSimilar = (params, call) => search.iterSimilar(params, call);
    this.filterValues = (name, params, call) => vocabulary.filterValues(name, params, call);
    this.iterFilterValues = (name, params, call) => vocabulary.iterFilterValues(name, params, call);
    this.documentFilterValues = (category, name, params, call) => vocabulary.documentFilterValues(category, name, params, call);
    this.iterDocumentFilterValues = (category, name, params, call) => vocabulary.iterDocumentFilterValues(category, name, params, call);
    this.sorts = (category, call) => vocabulary.sorts(category, call);
    this.coverage = (params, call) => coverage.coverage(params, call);
    this.searchExport = (params, call) => searchExport.searchExport(params, call);
  }

  /** Records by identifier: companies, people and each document kind. */
  get entities(): Entities {
    return (this.#entities ??= new Entities(this.#transport));
  }

  /** Research runs. */
  get runs(): Runs {
    return (this.#runs ??= new Runs(this.#transport));
  }

  /** People connected across companies and institutions. */
  get relationships(): Relationships {
    return (this.#relationships ??= new Relationships(this.#transport));
  }

  /** A company's people, counted by department, seniority and place. */
  get orgChart(): OrgChart {
    return (this.#orgChart ??= new OrgChart(this.#transport));
  }

  /** Saved lists of records. */
  get lists(): Lists {
    return (this.#lists ??= new Lists(this.#transport));
  }

  /** Export jobs and their files. */
  get exports(): Exports {
    return (this.#exports ??= new Exports(this.#transport));
  }

  /** What the workspace asked, and what it cost. */
  get history(): History {
    return (this.#history ??= new History(this.#transport));
  }

  /** Reports and votes on answers. */
  get feedback(): Feedback {
    return (this.#feedback ??= new Feedback(this.#transport));
  }

  /** The workspace's balance and ledger. */
  get credits(): Credits {
    return (this.#credits ??= new Credits(this.#transport));
  }

  /** What `JSON.stringify` shows: the configuration, with the key redacted. */
  toJSON(): Record<string, unknown> {
    return this.#transport.toJSON();
  }
}

# Changelog

## 0.1.0 (Unreleased)

Breaks the org chart and two lists methods, which on 0.x is a minor version.
The org chart broke on the server first: it moved to One Platform's contract on
27 October 2026 without notice and refuses requests in the old shape, so
0.0.1's org-chart calls fail against it and none of the old surface could be
kept working. Lists gained types and ranged exports at the same time.

### Changed (breaking)

- **Org charts follow One Platform's.** `client.orgChart.retrieve`,
  `.departments` and `.locations` keep their names and take the API's new
  contract:
  - Requests carry one `filters` object (`OrgChartFilters`): `locations.include`
    / `exclude` of `{ level, value }` places (`OrgChartPlace`), and
    `governance_levels`, `employment_types` (codes such as `co_founder`,
    `full_time`), `c_suite_access`, `job_titles`, `text`, `search_mode`.
    `retrieve` adds `metrics` (`new_joiners`, `job_openings`) and
    `include_suspects`; `departments` adds `include_suspects`. Gone: `country`,
    `state`, `city`, `governance_level`, `employment_type`,
    `has_direct_access_to_c_suite`, `include_others` and `locations`' `search`:
    each is typed `never` (`RetiredOrgChartParams`), so passing one is a compile
    error, and is refused before sending with a `ClientValidationError` that
    names its replacement, rather than reaching the server as an unknown field.
  - Responses carry `{ code, label }` values (`OrgChartCode`): rows and columns
    are `OrgChartAxisEntry` (`code`, `label`, `total`, `unknown`), cells carry
    `badges`, the grid carries `subdepartments`, `state`, `coverage` and
    `matched`; the location tree is `items` of `OrgChartLocation`
    (`level`, `value`, `label`, `count`, `unknown`, `children`).
  - Each person is counted once, at their most senior level; each axis ends
    with an explicit Unknown.
  - Exports: `UNKNOWN_LOCATION`, `GovernanceLevel`, `EmploymentType`,
    `OrgChartPeopleFilters`, `OrgChartSubDepartment`, `OrgChartDepartment`,
    `OrgChartCity`, `OrgChartState` and `OrgChartCountry` are replaced by
    `UNKNOWN_CODE`, `OrgChartGovernanceLevel`, `OrgChartEmploymentType`,
    `OrgChartMetric`, `OrgChartPlaceLevel`, `OrgChartPlace`, `OrgChartFilters`,
    `OrgChartCode`, `OrgChartStatus`, `OrgChartMatched`, `OrgChartAxisEntry`,
    `OrgChartBadges`, `OrgChartSubdepartment`, `OrgChartCoverage` and
    `OrgChartLocation`.
- **A domain several companies share is never guessed.** When the domain sent
  to `retrieve`, `departments` or `locations` names more than one company that
  has people (or several records hold the LinkedIn page), the call throws
  `AmbiguousCompanyError`, a free `422 org_chart.company_ambiguous` and an
  `InvalidRequestError`. Its `candidates` (`OrgChartCandidate`) list the
  companies, at most 10, each with `company_ref`, `name`, `domain`,
  `linkedin_url`, headquarters and `employee_count`; `candidateCount` says how
  many there are in all. Send the chosen one's `company_ref` instead of the
  domain to chart it: it is the third identifier, beside `domain` and
  `linkedin_url` (exactly one), and `OrgChartCompany.company_ref` echoes it.

### Changed

- **Lists are typed, and exports come in ranges.** `lists.create(name,
  { entity_category })` makes a list of one kind of record, and
  `SavedList.entity_category` says which (a list created without it takes the
  kind of the first records added). Records of another kind throw
  `InvalidRequestError` (`lists.category_mismatch`); a name already in use,
  ignoring case, throws `ConflictError` (`lists.name_taken`).
  `lists.export(listId, { offset, limit })` exports one range of a list: one
  export holds at most 10,000 rows (was 1,000), and more throws
  `InvalidRequestError` (`export.too_large`). `searchExport` takes up to
  10,000 items. **Breaking:** both methods now take params second and request
  options third (`ListCreateParams`, `ListExportParams`); request options
  passed second are refused with a `ClientValidationError` that says so.
- New error codes in `ErrorCode`: `lists.name_taken`,
  `lists.category_mismatch`, `export.too_large`, `org_chart.company_ambiguous`,
  and the `enrichment.*`, `privacy.*` and `rate_limits.key_not_found` codes of
  routes this SDK does not wrap, each mapped to its class.

## 0.0.1 (Unreleased)

The first public release of `sproutsdata`, the official JavaScript / TypeScript
SDK for the Sprouts Data API. Until 1.0, a minor version may include breaking
changes; each one will be listed here.

### Included

- **Search**: `search()` in `fast`, `auto` and `deep` modes over companies,
  people and the document categories (patents, news, funding rounds, job
  openings, market and academic reports, trends), with typed filters, sorting,
  `keyword_query`, and `searchPages()` for cursor pagination up to the API's
  10,000-result depth cap.
- **Look-alikes**: `similar()` for companies like a set of anchors.
- **Catalogues**: `filterValues()`, `iterFilterValues()`,
  `documentFilterValues()`, `sorts()` and `coverage()`.
- **Entities**: `client.entities` looks up full records by id, domain, name or
  LinkedIn URL, and reports every id it could not find.
- **Relationships**: `client.relationships` finds people connected to a set of
  companies, who a person can reach at a target company, the institutions they
  share, and answers the same questions asked in words (`ask()`).
- **Org charts**: `client.orgChart` for a company's grid, departments and
  locations.
- **Agent runs**: `client.runs` creates, follows (server-sent events), waits
  for, cancels and lists agent runs, and pages through their results.
- **Account**: `client.credits` (balance and key usage), `client.history`
  (past calls, their detail and metrics) and `client.members`.
- **Feedback**: `client.feedback` files reports and help requests, lists them,
  and casts votes on results.
- **Saved lists**: `client.lists` creates, renames and deletes lists, adds,
  reads and removes items, and exports a list or a search as CSV where the
  deployment offers it.
- **Tools for models**: `sproutsdata/tools` exposes `sprouts_search`,
  `sprouts_similar` and `sprouts_entity_lookup`, with the same names, schemas
  and results as the Sprouts MCP server, for OpenAI, Anthropic and any model
  that calls functions.
- **Errors and retries**: a typed error class per API error code, with
  `request_id` on every response and error. Retries follow each route's cost,
  so a billed call that may have reached the server is never repeated, and a
  `402` is never retried.
- **Runtime**: no runtime dependencies, Node.js 18 or later, ESM and CommonJS
  builds with full TypeScript types.

The older `DSP_API_KEY` and `DSP_BASE_URL` environment variables are still read
when `SPROUTSDATA_API_KEY` and `SPROUTSDATA_BASE_URL` are unset, with a
deprecation warning, until 1.0.

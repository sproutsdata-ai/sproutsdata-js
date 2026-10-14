# Tool specs

The three Sprouts tools as data: what a model is told, what it may send, and
what it gets back (contract 02 §12). The Python SDK's `sproutsdata.tools` and the
JS SDK's `sproutsdata/tools` are both built from these files, and the JS SDK
vendors them byte for byte. The tool names and input schemas are the Sprouts MCP
server's, so one name means one contract on every surface.

| File | What it holds |
|---|---|
| `sprouts_search.json`, `sprouts_similar.json`, `sprouts_entity_lookup.json` | One tool each: `name`, `description`, `description_hints`, `refused_arguments`, `input_schema`, and the generated `strict_input_schema` |
| `shaping.json` | The numbers and tables results are shaped with |
| `messages.json` | Every sentence the tools modules write themselves: validation and rule refusals, caveats, and errors with no problem document to quote |
| `fixtures/` | Cross-language parity cases: arguments, a canned response, the expected request and the expected result |

Edit a tool file or a shared file, then regenerate:

```bash
python scripts/gen_tool_schemas.py           # strict schemas + src/sproutsdata/tools/_specs.py
python scripts/gen_tool_schemas.py --check    # CI: fails while either is stale
```

## Tool files

- **`description`** is a prompt, not documentation. It carries what a result
  means — `total_is_estimate` makes `total` a floor, `has_more` means more pages,
  an empty result is not proof of absence — the live filter vocabulary, and the
  cost. Example values must come from `/v1/search/filters/*`; the seven
  seniority levels and the `governance_level` / `employment_type` values are
  spelled out.
- **`description_hints`** maps a tool name to a sentence appended to the
  description only when that tool is in the same toolset, separated by a blank
  line, in file order. A description never names a tool the model cannot call.
- **`refused_arguments`** maps a name a model is likely to send but the tool
  does not take (`page`, `offset`, a retired argument) to the sentence it is
  refused with. A refused name is reported before any schema problem.
- **`input_schema`** is the loose JSON Schema, used for validation, Anthropic,
  and OpenAI with `strict: false`. It uses only `type`, `enum`, `properties`,
  `required`, `additionalProperties: false`, `items`, `minLength`/`maxLength`,
  `minItems`/`maxItems`, `minimum`/`maximum` and `default`.
- **`strict_input_schema`** is generated for OpenAI strict mode: every property
  listed in `required`, every optional one made nullable (`null` added to `type`,
  and to `enum` where there is one), `additionalProperties: false` on every
  object, and every other keyword moved into the description as a sentence. A
  model in strict mode sends `null` for an argument it does not use, and the
  runtime treats `null` as "not set".

## Running a call

1. **Arguments** — a JSON string (OpenAI), an object (Anthropic), `""` or nothing
   (an empty object). A string is read as `JSON.parse` reads it: `NaN`,
   `Infinity` and `-Infinity` are not JSON and are refused as `not_json`.
   Numbers are IEEE-754 doubles in either form, so an integer beyond 2^53 is
   read as its nearest double (one beyond the double range as infinite).
   Integers that large are not supported as arguments; reading them this way
   keeps one input to one request in both languages. `null` members are then
   removed at every depth.
2. **Refused names**, then **schema validation** against the model's schema
   (the input schema minus any `fixed` arguments). Two coercions only, both the
   MCP server's: an integer written as a string of ASCII digits, optionally
   signed with `-` and surrounded by whitespace, becomes the integer (read as a
   number is in step 1), and a bare string where a list of strings belongs
   becomes a one-item list. "Whitespace" here and in step 4 is what
   ECMAScript's `String.prototype.trim` removes: the `WhiteSpace` and
   `LineTerminator` code points (tab, line feed, vertical tab, form feed,
   carriage return, U+FEFF, U+2028, U+2029 and the `Zs` category).
   Every problem is reported as `path: problem` — the path dotted, array indices
   as numbers, the root as `arguments` — in this order: refused names, then for
   each object its unknown keys (input order), its missing required keys (schema
   order), then its properties (schema order), recursively.
3. **Developer settings** — `defaults` under the model's arguments, `fixed` over
   them, then each `default` from the full input schema for whatever is still
   absent (inside objects that exist; a default never conjures its parent).
4. **Rules** (`messages.json` → `rules`), the first that applies refusing the
   call: search needs `query` or `filters` (`needs_query_or_filters`), where a
   `filters` that is `{}` once nulls are removed and a `query` that is empty or
   only whitespace both count as absent; `category: "auto"` needs a `query`,
   `mode: "auto"`, and no filters, domains or sort, and cannot run under
   baseline filters; domain lists need a domain category; a sort field may
   appear once; a lookup `by` must be one the category accepts
   (`shaping.json` → `lookup_by`).
5. **Baseline filters** merge into the model's per sub-key: a filter the model
   did not set is added whole; one it did set keeps its own keys, and takes the
   application's value for every key the application sets. Each key whose value
   changed adds an `application_filter` caveat. Not applied to `category: "auto"`.
6. **Row cap** — `limit` above the toolset's `max_results` (1–25, default 25) is
   lowered to it, with a `limit_capped` caveat when the model asked explicitly.
7. **The request.** Search sends `mode`, `category` (omitted for `auto`, which is
   how the API is asked to classify), `limit` and whatever else was given;
   `fields` is never sent, because `/v1/search` and `/v1/similar` refuse it.
   Look-alike sends each anchor with its `by` and `weight`. Lookup sends `ids`,
   `fields` when given, and `by` when given or when the category has a default
   (`id` for the four named document categories, whose server default would read
   a record id as a name).

## Result shape

Search and look-alike:

```json
{
  "results": [{"id": "…", "category": "company", "account_name": "…", "technology": ["HubSpot", "…", "… +19 more"], "lookup": {"by": "domain", "value": "…"}}],
  "total": 13137,
  "total_is_estimate": false,
  "has_more": true,
  "next_cursor": "…",
  "interpreted_as": {"filters": {}, "source": "parser", "conflicts": []},
  "caveats": ["vector_coverage_incomplete: … (impact: recall)"],
  "suggestion": null,
  "request_id": "…",
  "environment": "test"
}
```

- **Rows** are projected to `default_projection` for `company` and `person`, or
  to the requested `fields` plus `identity_fields`; other categories keep every
  field. `null`, `""`, `[]` and `{}` are dropped at every depth, strings are cut
  at `text_max_chars` Unicode code points plus `ellipsis`, and lists are capped
  at `list_max_entries` plus a `more_marker`. Before the cap, strings that match
  a value the request asked for move to the front, case-insensitively, in a
  stable partition. "Asked for" is every literal in the effective filters and in
  `resolved_search.filters` under the same field name: a string, a list of
  strings, or an object's `include` list.
- **`lookup`** is added to a company or person row when the lookup tool is in
  the toolset: `{"by": "domain", "value": domain}` for a company with a domain,
  otherwise `{"by": "li_url", "value": linkedin_url}` when there is one. A row
  without either gets none, and a `rows_without_lookup` caveat counts them.
- **`interpreted_as`** is `resolved_search` as `{filters, source, conflicts}`
  (`source` is `filters_source`), and `{"filters": {}, "source": "none",
  "conflicts": []}` when the response had none. It is never dropped.
- **`caveats`**, in order: each degradation as `"<reason>: <detail> (impact:
  <impact>)"`; `coverage_truncated` and `constraint_unmet` from `coverage`;
  `parser_not_run` when the call sent a `query` and `resolved_search` has
  `parser_version` `"none"` (or empty) and no filters; then the call's own, in
  this order — `application_filter` (one per replaced key), `anchors_unreported`
  (more than one anchor), `anchors_by_name`, `anchors_zero_weight`,
  `limit_capped`, `anchors_removed` — and last `rows_without_lookup`. The
  `anchors_*` caveats come before `limit_capped` because they describe the
  arguments, and `anchors_removed` after it because it describes the response
  (`fixtures/similar_caveat_order.json` pins the order).
- **Look-alike** removes a row whose `domain` (else `id`), normalised —
  lower-case, scheme, `www.` and path removed — equals a `by: "domain"` anchor's.
- **`suggestion`** is the response's, with empty members dropped, or `null`.

Lookup:

```json
{
  "results": [{"id": "stripe.com", "found": true, "matches": [{"…": "…"}], "ambiguous": false}],
  "caveats": [],
  "request_id": "…",
  "environment": "test"
}
```

Every id is answered, in order. `matches` holds at most `matches_max` records,
shaped like rows, plus a `more_marker` when there were more; `ambiguous` is true
when more than one record matched. `found: true` with an empty `matches` is a
record that resolved but did not come back (`record_unavailable`), never a miss.
For a company or person lookup without `by`, misses that match
`search_id_pattern` add `search_ids_not_found`, and misses containing `.` or `/`
add `raw_values_without_by`.

## Errors

```json
{"error": {"code": "…", "message": "…", "retryable": false, "retry_after": null, "field_errors": [], "request_id": null}}
```

All six keys, always. Returned, never raised: invalid arguments
(`invalid_arguments`; schema problems in `field_errors` under a summary
`message`, a rule refusal as the `message`), an unknown tool (`unknown_tool`),
and every API failure except the three below — `code` is the problem
document's, or `http.<status>` without one; `message` its `detail`, else its
`title`, else `HTTP <status>`; `field_errors` its `extra.errors` as `path: msg`
with a leading `body` or `query` segment dropped (`msg` defaults to `invalid`);
`retry_after` in seconds. `retryable` is true for 429, 500 (except
`credits.unknown_action`), 503 and 504. A 502 or 408 is `gateway_no_answer`, and
a timeout (`timeout`) or dropped connection (`connection_error`) after the
request was sent is not retryable either: all three tools are charged once the
server has done the work, so a repeat may be a second charge. A request that never left is
retryable. An unreadable success is `response_invalid`.

Raised to the application: 401, 403 and 402, and the configuration errors a
client raises before any call. A model can fix none of them.

## Canonical JSON

A result is handed to a model, and compared by the fixtures, in one form — the
text `JSON.stringify` writes once every object's keys are sorted:

- **Objects**: keys sorted by Unicode code point (not UTF-16 code unit), no
  whitespace anywhere, separators `,` and `:`.
- **Strings**: `"` and `\` escaped with a backslash; U+0008, U+0009, U+000A,
  U+000C and U+000D as `\b`, `\t`, `\n`, `\f`, `\r`; every other code point
  below U+0020 as `\u00XX` with lower-case hex. Every other character is
  written as itself — non-ASCII, U+007F, U+2028 and U+2029 included — except a
  lone surrogate (U+D800–U+DFFF not part of a high-then-low pair), which is
  written as `\uXXXX` with lower-case hex, as ES2019's well-formed
  `JSON.stringify` does. A string is read as UTF-16 first: a high surrogate
  followed by a low one is one character.
- **Numbers** as ECMAScript's `Number::toString` writes them, from the
  shortest digit string that round-trips to the same double: decimal notation
  when 10^-6 ≤ |x| < 10^21 (`0.00001`, `1.5`, `123000000000000000000`), exponent
  notation otherwise (`5e-7`, `1.5e-10`, `1e+21`, `1.23e+22`); an integral value
  has no fraction (`5000000.0` is `5000000`, `100.0` is `100`), and `-0` is
  `0`. An integer is written as the double nearest to it, so one beyond 2^53
  may lose digits, exactly as it would in JavaScript. `NaN`, `Infinity` and an
  integer beyond the double range have no JSON form and are refused.
- `true`, `false` and `null` as themselves.

## Fixtures

Each file in `fixtures/`:

| Key | Meaning |
|---|---|
| `description` | What the case shows |
| `tool` | The tool name called |
| `options` | Toolset options, in Python spelling (`max_results`, `baseline_filters`, `fixed`, `defaults`, `include`); the JS runner maps them to its own case |
| `arguments` | What the model sent |
| `response` | The canned HTTP response (`status`, `headers`, `body`), or `null` when nothing may be sent |
| `expected_request` | `method`, `path` (after the base URL) and JSON `body`, or `null` |
| `expected_output` | The result. Its canonical JSON must equal the implementation's byte for byte |

Run each case with retries disabled, so a retryable status is returned rather
than retried.

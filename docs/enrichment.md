# Enrichment

Enrichment finds values for records you already hold: an email or a phone for a
person (`contacts`), a domain, a phone or a LinkedIn page for a company
(`accounts`). `client.enrichment` has seven calls. They need a key with the
`dsp.enrichment.*` scopes (see [Scopes](#scopes)).

| Call | Answer | Cost |
|---|---|---|
| `lookup` | up to 20 items, answered in the call | the values newly found |
| `create` | a job's handle, at once | the values newly found, when it ends |
| `retrieve` | a job as it stands | free |
| `wait` | a job, once it has ended | free |
| `results` | one page of a job's rows (`iterResults` reads every page) | free |
| `list` | the workspace's jobs (`iterList` reads every page) | free |
| `cancel` | the job, stopped | the values found until then |

## What to send

| `entity` | Fields it takes | Name an item by |
|---|---|---|
| `contacts` (the default) | `EMAIL`, `PHONE` | a `linkedin_url`; or a name (`full_name`, or `first_name` and `last_name`) with `company_domain` or `company_name`; `email_hint` helps |
| `accounts` | `DOMAIN`, `PHONE`, `LINKEDIN_URL` | `company_domain`, `company_name` or `linkedin_url` |

`fields` (1 to 3, each once) is required: nothing is looked up, or charged,
that you did not ask for. An item may ask for fewer of them with its own
`fields`. `external_id` is your own id for an item, echoed back on its row.

## A few items in the call

```ts
const people = [
  { full_name: 'Ada Lovelace', company_domain: 'example.com', external_id: 'crm-1' },
  { linkedin_url: 'https://www.linkedin.com/in/someone', external_id: 'crm-2' },
];

const found = await client.enrichment.lookup({ items: people, fields: ['EMAIL', 'PHONE'] });
for (const row of found.results) {
  console.log(row.input['external_id'], row.outcome, row.fields['EMAIL']?.value ?? null);
}
console.log(found.values_found, 'values found,', found.meta.credits_charged, 'credits');
```

A lookup that does not finish in the call answers `complete: false`: it became
the job `found.job_id`, which settles its credits when it ends. `wait` for it
and read its `results`. `wait_seconds` (0.1 to 20; the server's default is 15)
bounds how long the lookup may take. A workspace may take fewer than 20 items
in a lookup: more is `InvalidRequestError` (`request.too_large`), so start a
job instead.

## A job

```ts
const people = [{ full_name: 'Ada Lovelace', company_domain: 'example.com', external_id: 'crm-1' }];
const handle = await client.enrichment.create({ items: people, fields: ['EMAIL'], name: 'Q4 prospects' });
const job = await client.enrichment.wait(handle.job_id);
console.log(job.status, job.values_found, job.credits_charged);
for await (const row of client.enrichment.iterResults(handle.job_id)) {
  console.log(row.idx, row.outcome, row.values_found, row.credits);
}
```

`create` sends an `Idempotency-Key`, generated when `options.idempotencyKey`
gives none and resent on its own retries, so a retry after a lost answer finds
the job the first attempt started. Pass your own when a repeat may come from
another process; a key sent again with another body throws `ConflictError`.
`lookup` sends one too, so a repeat answers the first again and is charged once.

`wait` polls with a growing interval (2 seconds, half again longer each time,
up to 30) for up to 30 minutes, and returns a failed or cancelled job rather
than throwing. It throws `WaitTimeoutError`, with the last state on `last`,
when the job has not ended in time; the job goes on server-side.

A job's `status` is `queued`, `running`, `cancelling`, `completed`, `failed` or
`cancelled`. A job the API stopped carries a `stop_reason`: `time_limit` (still
running six hours after it started) or `no_credits` (the workspace could no
longer cover it).

```ts
const accounts = await client.enrichment.lookup({
  entity: 'accounts',
  items: [{ company_name: 'Example Ltd', external_id: 'acct-1' }],
  fields: ['DOMAIN'],
});
console.log(accounts.results[0]?.fields['DOMAIN']?.value);
```

## What it costs

Each field has its own price, set in the workspace's price list: by default an
email, a domain or a LinkedIn page costs 1 credit and a phone number 9. The most
a request can cost is held first: every field asked of every item, each at its
price. One request may hold at most 30,000 credits; one that could cost more is
refused (`InvalidRequestError`): split it, or ask for fewer fields. A quote
shows the hold (`credits.quote({ operation: 'enrichment', rows, fields })`,
with `rows` the number of records, basis `values_up_to`). It can be higher than
a job's hold, never lower: an item that asks for fewer fields is held for fewer.
When the work ends, only the values newly found are charged:

- a value Sprouts already holds, a miss, and an error cost nothing;
- `re_enrich: true` looks up values that are already known, and each costs
  again;
- a failed or cancelled job is charged for the values it found before it
  stopped.

A job's `credits_used` and a row's `credits` are what the values newly found
cost, each at its field's price; `credits_charged` is what the job cost, set
once it has ended. `values_found` counts those same values, one each whatever
the field (an email and a phone number found are 2 values and 10 credits): on
a lookup, on each row, and on a job once it has ended (`null` while it runs,
and for jobs that ended before it was added). Rows on the Do-Not-Contact list
are left out of both. Reading a job that has ended settles it.

## Rows

A row has its position (`idx`), its `input` as you sent it, an `outcome`
(`found`, `partial`, `not_found`, `error`, `cancelled`, `skipped` or
`suppressed`), and `fields`: per field a `status` (`found`, `not_found`,
`unavailable`, `ineligible`, `cancelled`, `pending`, ...), a `value`, whether it
was `verified`, and, for a field with no value, the `reason` when it is known:
`no_source` (no data source covers the field yet), `sources_unavailable` (try
again later), `not_found` (every source was asked), `not_enough_input` (the item
does not identify its subject well enough) or `error`. Read `status` and
`reason` as open sets: new words can appear. `incomplete` names the fields a
lookup's time ran out on.

A job's rows are kept for 7 days after it ends; after that `results` throws
`ResultsExpiredError` (a `NotFoundError`, 410).

**Do-Not-Contact.** An item for someone on the workspace's Do-Not-Contact list
is never looked up and never charged. `suppressed_rows` lists its position in
`items`. A lookup answers a placeholder row there (`outcome: 'suppressed'`); a
job's rows leave it out.

## Refused before sending

Each throws `ClientValidationError` before anything is sent, in the server's
words: `fields` repeated, a field the entity is not enriched for, an item's
`fields` that are not a subset of the request's, a key that belongs to the
other entity (`company_id` on a contact, a person's name on an account),
`verify_mode` on accounts (it is for contacts only: `skip`, `moderate` or
`strict`), more than 20 items in a lookup, and a `wait_seconds` under 0.1.

## Scopes

Enrichment needs a key granted `dsp.enrichment.write` (to start a job, cancel
one and look up) and `dsp.enrichment.read` or write (to read). A key's default
scopes include neither; an owner or admin grants them. Without them a call
throws `PermissionDeniedError`.

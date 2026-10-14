# Feedback

Report a result, or a whole result set, against one of your own requests or
agent runs; list what you have reported; read the tag vocabulary. Three calls
under `client.feedback`, all free, with any valid key.

A rating says something was off; `expected` says what should have come back, and
only the second settles anything.

## What a report points at

A report names its subject by the id it carries:

- `kind: 'request'` — anything in your usage history: a search, a look-alike
  search, an entity lookup, a relationship query — identified by the
  `meta.request_id` on its response.
- `kind: 'agent_run'` — an agent run, identified by its `run_id`.

And a target: one row (`kind: 'result'`, with the row's `entity_id`) or the
whole page (`kind: 'result_set'`, no `entity_id`).

## `create`

```ts
const page = await client.search({ query: 'lenders in Germany', category: 'company' });

const report = await client.feedback.create({
  subject_ref: { kind: 'request', id: page.meta.request_id },
  target: { kind: 'result', entity_id: page.results[0]!.id, entity_type: 'company' },
  sentiment: 'bad',                             // the default; 'good' is also a report
  tags: ['wrong_entity'],                       // each legal at the target's level
  comment: 'A payments company, not a lender.', // free text; required with `other`
  expected: { should_include: ['lender.com'], note: 'Lenders only.' },
});

report.feedback_id;
report.target_verified; // could the stored snapshot confirm the entity was in that result set?
```

`target_verified: false` does not mean the report was wrong — only that the
stored page could not confirm it (omitted for size, or past its expiry).

The SDK refuses only structural mistakes before any request: no `subject_ref`
or an empty id, no `target`, `entity_id` missing on a `result` or present on a
`result_set`. Everything else is the server's, and its 422 names the field:
kinds and statuses, id lengths, how many tags, an unknown tag or one filed at
the wrong level, `other` without a comment, the size of an `expected` list.

`create` is never retried once it may have reached the server — a repeat would
file the report twice. A subject that is not one of this caller's requests or
runs is `404 feedback.subject_not_found` (`NotFoundError`).

## Tags

Tags are a closed, levelled, versioned set. Read it live and render forms from it
rather than from a hard-coded list:

```ts
const vocabulary = await client.feedback.tags();
vocabulary.version; // every report records the version it was filed against
for (const tag of vocabulary.tags) {
  console.log(tag.tag, tag.applies_to, tag.label, tag.description, tag.requires_comment);
}
```

- `applies_to` is `result`, `result_set` or `any`. Filing "the right results,
  in the wrong order" (`bad_ranking`, a set-level tag) against one row is
  refused — it is a claim about the wrong thing.
- `requires_comment` marks the tags that mean nothing on their own. Today that
  is `other`, for a problem no other tag describes.

At version 2 the vocabulary is `irrelevant`, `wrong_entity`, `stale`,
`data_quality`, `duplicate` (one result); `bad_ranking`, `missing`,
`no_results`, `too_few`, `too_many` (the set); and `other` (either, with a
comment). The `FeedbackTag` type lists them and stays open to new ones.

## `list`

```ts
const mine = await client.feedback.list({
  subject_id: page.meta.request_id, // or filter by status / tag / subject_kind
  limit: 50,
  offset: 0,
});

mine.total; // every report this credential has filed that matches — not the page
for (const view of mine.results) {
  console.log(view.feedback_id, view.status, view.tags, view.subject?.query);
}
```

This is the one **offset-paginated** list: there is no cursor and no
`listPages`. Loop with `offset += limit` while
`offset + results.length < total`. Each row's `subject` is the call it points
at, resolved when you read it; it is `null` when that call has aged out, never a
sign that the report is invalid. `status` is `new`, `triaged`, `confirmed` or
`dismissed`.

## Problem reports: `context: 'help'`

A report about the product rather than one answer — what a Help menu sends —
names no subject:

```ts
await client.feedback.create({
  context: 'help',
  target: { kind: 'result_set' },
  comment: 'The export button does nothing on Safari.',
});
```

Its `target.kind` is `'result_set'`, and it needs a `comment` or `tags` saying
what went wrong. It may still name the call it happened on with `subject_ref`.

## Votes

A vote is lighter than a report: a like or dislike on a whole answer, or a flag
on one record.

```ts
await client.feedback.votes.cast({
  request_id: page.meta.request_id,
  vote: 'dislike',               // 'like' | 'dislike' on the whole answer
  entity_category: 'company',
  reason_code: 'too_few',        // optional; never with 'like'
});

await client.feedback.votes.cast({
  request_id: page.meta.request_id,
  vote: 'flag',                  // one record
  entity_category: 'company',
  entity_id: 'stripe.com',
  reason_code: 'outdated',
  text: 'Acquired in 2025.',     // only together with a reason
});

const mine = await client.feedback.votes.list(page.meta.request_id);
```

Giving `entity_id` makes the vote about that record (`level: 'result'`); leaving
it out makes it about the whole answer (`level: 'result_set'`). Reason codes are
checked by the server: `not_relevant`, `missing_expected`, `too_few`,
`wrong_or_outdated` or `other` on a whole answer; `wrong_entity`, `outdated`,
`duplicate`, `missing_info` or `other` on a record.

Each key holds one active vote per answer, and per record. Casting the same vote
again stores nothing and returns `changed: false`; a different vote replaces the
old one. That makes a vote safe to retry, and the SDK does. Free; requires
`dsp.search.read` or `dsp.usage.read`.

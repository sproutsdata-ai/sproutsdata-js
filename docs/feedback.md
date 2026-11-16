# Feedback

Report on an answer, list the reports, read the tag vocabulary, and vote on an
answer. Every call under `client.feedback` is free and needs a key with
`dsp.search.read` or `dsp.usage.read`.

## What a report points at

A report names its subject:

- `{ kind: 'request', id }`: a call in the usage history (a search, a
  look-alike search, a lookup, a relationship query), by the `meta.request_id`
  of its answer;
- `{ kind: 'agent_run', id }`: an agent run, by its `run_id`.

And a target: one row (`{ kind: 'result', entity_id }`) or the whole answer
(`{ kind: 'result_set' }`).

## `create`

```ts
const page = await client.search({ query: 'lenders in Germany', category: 'company' });
const first = page.results[0];

if (first !== undefined) {
  const report = await client.feedback.create({
    subject_ref: { kind: 'request', id: page.meta.request_id },
    target: { kind: 'result', entity_id: first.id, entity_type: 'company' },
    sentiment: 'bad', // or 'good'
    tags: ['wrong_entity'],
    comment: 'A payments company, not a lender.',
    expected: { should_include: ['lender.example'], note: 'Lenders only.' },
  });
  console.log(report.feedback_id, report.status, report.target_verified);
}
```

`target_verified` says whether the stored answer could confirm the target was
in it; `false` does not mean the report is wrong.

The SDK checks the report against the server's model before sending it (the
fields, their lengths, at most 10 tags) and refuses the tag `other` without a
comment. Whether a tag exists, and fits the target's level, is checked by the
server: list the tags with `feedback.tags()`.

**Report a moment after the answer, not at once.** History rows are written in
background batches after the answer, so a report on a request made a second ago
may throw `NotFoundError` (`feedback.subject_not_found`) until its row is
written. Report again shortly. The same error means the subject is not one of
this workspace's calls.

`create` sends an `Idempotency-Key` (yours, from `options.idempotencyKey`, or
one the SDK makes) and resends it on its retries, so a retry files the report
once.

### Help reports

A report with no `subject_ref` is a help request about the API in general:

```ts
await client.feedback.create({
  target: { kind: 'result_set' },
  tags: ['other'],
  comment: 'The org chart for our own domain shows no engineering department.',
});
```

## Tags

The tags are a closed, versioned set, each for a `level`. Read it rather than
hard-coding it:

```ts
const vocabulary = await client.feedback.tags();
console.log(vocabulary.version);
for (const tag of vocabulary.tags) console.log(tag.tag, tag.level, tag.label, tag.requires_comment, tag.description);
```

## `list`

`list` is one page of the workspace's reports, newest first; `iterList` walks
them all.

```ts
const reports = await client.feedback.list({ limit: 50 }); // 1 to 100
for (const report of reports.results) console.log(report.feedback_id, report.status, report.tags, report.subject_ref, report.target);

for await (const report of client.feedback.iterList({ maxResults: 200 })) {
  console.log(report.created_at, report.sentiment);
}
```

## Votes

A vote is lighter than a report: a like or dislike on a whole answer, or a flag
on one row. `request_id` is the answer's `meta.request_id`.

```ts
const page = await client.search({ query: 'lenders in Germany', category: 'company' });

const dislike = await client.feedback.votes.cast({
  request_id: page.meta.request_id,
  level: 'result_set',
  vote: 'dislike',
  entity_category: 'company',
  reason_code: 'too_few',
});
console.log(dislike.changed, dislike.vote.vote_id);

const first = page.results[0];
if (first !== undefined) {
  await client.feedback.votes.cast({
    request_id: page.meta.request_id,
    level: 'result',
    vote: 'flag',
    entity_category: 'company',
    entity_id: first.id,
    reason_code: 'outdated',
    text: 'Acquired last year.',
  });
}

const mine = await client.feedback.votes.list({ request_id: page.meta.request_id });
for (const vote of mine.votes) console.log(vote.level, vote.vote, vote.entity_id, vote.reason_code);
```

The SDK refuses, before sending:

- a `flag` on a `result_set`, or anything but a `flag` on a `result`;
- a `result` vote without its `entity_id`;
- a reason on a `like`;
- `text` without a `reason_code`.

Reason codes come from `feedback.tags()`. `entity_category` is free text.

A voter holds one vote per answer, and per row. Casting a vote changes your
vote; `changed` says whether it did.

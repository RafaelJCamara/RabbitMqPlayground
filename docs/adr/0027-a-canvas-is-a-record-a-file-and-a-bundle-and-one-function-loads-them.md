# ADR-0027: A canvas is a record, a file and a bundle, and one function loads all of them

- **Status:** Accepted. The size caps that are about a canvas are the domain's `LIMITS`, and the commands refuse at them ([ADR-0029](0029-the-commands-refuse-at-the-size-caps.md)).
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** "The canvas", "Storage" and "Files" of [ADR-0012](0012-multiple-canvases-and-local-persistence.md). The
  repository, autosave and the storage errors that go with them are in [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md).

## Context

[ADR-0012](0012-multiple-canvases-and-local-persistence.md) says that a canvas is kept in IndexedDB, can be saved as native
JSON, that a backup holds all of them, that everything is versioned and validated with ordered migrations, and that a file
from a newer version is refused with a clear message and never half-loaded. [ADR-0013](0013-self-contained-share-links.md)
says that a link is validated "using the same validator as file import". They leave open what the pieces are, how many
version numbers there are and what each one is for, in which order a load checks things, what it answers when something is
wrong, how big is too big, and what a migration is. S3 ([#5](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/5))
had to decide before it wrote the loader, because S4 (autosave), S9 (files and backups) and S10 (links) all build on it,
and a file, a record and a link are three doors into the same room.

## Decision

### Four numbers, three shapes

Four numbers are called a version. They change for different reasons, so they are different numbers:

| Number | Lives in | Is 1 now | Changes when | Acts on |
|---|---|---|---|---|
| `schemaVersion` | every document | yes | the shape of a document changes | the migrations, when a document is loaded |
| `version` of a canvas file | the envelope of one canvas | yes | the envelope changes | the reader of the file |
| `version` of a backup | the envelope of a backup, and the entries in it | yes | the envelope or an entry changes | the reader of the backup |
| `DB_VERSION` | the IndexedDB database | yes | a store or the shape of a record changes | the upgrade steps, when the database is opened |

Migrations act on the payload, the document, and the upgrade step of the database acts on the structure around it. They
never meet: a document is migrated in memory after it is read, and the database is upgraded before anything is read.

Three shapes hold a canvas. A time is a number of milliseconds since the epoch, and an id is 1 to 64 letters, digits, `.`,
`:`, `_` or `-`, starting with a letter or a digit.

- **The record** is what the repository keeps, one for each canvas: `id`, `name`, `createdAt`, `updatedAt`, `deletedAt` (only
  on a tombstone) and `document`.
- **The canvas file** is an envelope around one canvas: `format` (`rmq-playground/canvas`), `version`, `name` and `document`.
  It has no id and no time, because opening it makes a new canvas.
- **The backup** is an envelope around many: `format` (`rmq-playground/backup`), `version`, `exportedAt` and `canvases`, each
  with the `id`, `name`, `createdAt`, `updatedAt` and `document` of a record. It keeps ids and times, so that a restore can put
  a canvas back as it was, and what to do with an id that is taken is S9's choice.
- **Each shape is strict.** A key that the shape does not have is refused and named, as the document's schema does
  ([ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md)). A key can only appear with a new version, and a
  file that has an unexpected one was edited by hand or made by a bug, and says so instead of losing the key on the next save.
- **A file is written as JSON with two spaces of indentation and a final newline**, and is read from text. A file is refused
  before it is parsed if its text is longer than 50,000,000 characters.

### One loader

`loadCanvas(raw: unknown)` is the one function that turns data from anywhere into a document: a record that was read, the
`document` of a file, the entry of a backup, and, in S10, what a link inflates to. It never throws, and it returns
`{ ok: true, value: { document, from } }` (`from` is the schema version that the data had) or `{ ok: false, error }`. It does
these in order and stops at the first that fails:

1. **Is it an object?** Not `null`, not a list, not text. Otherwise `not-an-object`.
2. **Does it say what version it is?** `schemaVersion` has to be a whole number from 1. Otherwise `unknown-format`.
3. **Is it newer than this app?** Then `newer-version`, and nothing else is looked at, because the rest of it may mean
   something that this version does not know. The message says which version the data has, which one the app understands
   and what to do (reload to get the newest version), and says that nothing was loaded and nothing was changed.
4. **Is it older?** The migrations from its version to the current one run, one after the other. A version that has no way
   forward is `unsupported-version`. A migration that throws, or does not give back an object, is `migration-failed`, and
   says from which version to which.
5. **Is it too big?** The size caps below. Otherwise `too-large`, which says what is too big, how much it is and how much is
   allowed.
6. **Is it right?** `parseDocument` of `@rmq/domain`: the strict schema, then the references and the broker's rules
   ([ADR-0021](0021-transient-queues-are-refused.md), [ADR-0022](0022-topic-binding-keys-have-at-most-two-hash-wildcards.md),
   [ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md)). Otherwise `invalid`, with every
   `Issue` that it found. The message of the error names the first and counts the rest.

A document that comes out is the current version, valid, and a new object that shares nothing with the input. If anything
else goes wrong, such as a getter that throws on a hostile object, it is `invalid` and says that the data could not be read.
The functions that read a file and a backup add one kind, `not-json`, for text that is not JSON, and use the same kinds for
their own envelope.

Every message says the root cause in plain words and what to do. The one for a canvas from a newer version reads, for
example, "This canvas was saved by a newer version of this app. It uses schema version 3, and this version understands up
to 1. Reload the page to get the newest version, then open it again. Nothing was loaded and nothing was changed." No
message names the product, which lives in one constant of the app.

### Size caps

The schema has ranges for its numbers and `validateDocument` has the 255 bytes of a name, but nothing bounded how many
things a document holds or how long a payload is. A document that has a million exchanges would be parsed to the end before
anyone said so. The caps are checked on the data before the schema runs, and they sit about ten times above the plan's 200
nodes and 500 edges ([plan, section 7](../plans/m1.md)), so that nothing a learner builds comes near them:

| What | At most |
|---|---|
| Elements: exchanges, queues, producers and consumers together | 2,000 |
| Edges: bindings, producer links and consumer subscriptions together | 5,000 |
| Header entries on one message or one binding | 100 |
| Characters of one payload, and of one header value that is text | 10,000 |
| Positions in the layout, and labels | one for each element, and one for each edge, so no more than the two caps |
| Characters of the text of a file or a backup | 50,000,000 |
| Canvases in a backup | 1,000 |
| Characters of a canvas's name | 200 |

The caps are not in the domain's schema. The domain refuses what a broker would refuse, and the caps are about untrusted
data. A canvas that is over a cap cannot be saved either, and the repository says so, so that nothing is ever stored that
cannot be read back. The commands do not know the caps (OPEN_QUESTIONS 9).

### Migrations

- **A migration is a function from one version to the next.** `MIGRATIONS` is a list that only grows: the item at index `n`
  reads version `n + 1` and gives back version `n + 2`, and the runner sets `schemaVersion` itself, so that a migration cannot
  forget to. A migration does not change its input, and a spec feeds each fixture to it frozen, so that one that does fails.
- **A spec holds the list to the schema.** There is exactly one migration for each version below the current one. Changing the
  document's `schemaVersion` without adding a migration fails there, and so does adding a migration without the version.
- **The runner is proved on a chain that exists only in a spec**, with throwaway shapes, since only version 1 exists: the steps
  run in order from any starting version, a gap and a step that throws are typed errors, and the input is left as it was.
- **A fixture for every version.** `web/fixtures/schema/vN/` holds documents as version N wrote them. A spec requires a folder
  for every version up to the current one and none above it, requires that each file says that it is version N, and loads each
  one into the current document. A file is never edited once it is committed, because the day a migration is wrong, it is
  the only proof: a `manifest.json` has the SHA-256 of each file's parsed content (not of its bytes, so that the checkout's
  line endings, OPEN_QUESTIONS 5, cannot change it), and a spec fails on a fixture that is not in it or that no longer matches.
- **A record is migrated when it is read and is rewritten only when it is saved.** If the app updated every record when it
  started, a learner who went back to an older deployment would find them all "from a newer version" and lose the canvases
  for as long as they stayed there. A migration therefore runs over what it is given, and has to be no worse than linear in it.

### What S10 has to do

The share codec is `'v1.' + base64url(deflate-raw(canonical JSON))` ([ADR-0013](0013-self-contained-share-links.md)). Its
decoding ends in `loadCanvas`, and in nothing of its own: the caps, the versions and the errors are the ones above. The
codec's own limits (256k characters in, 2 MB out, counted while streaming) are about bytes before there is any data, and
are its own.

## Consequences

### Positive

- A file, a record and a link are checked by the same function, so a hole in one is a hole in all of them, and a fix is one.
- A canvas from a newer version is never opened in part, and never rewritten without what the app did not understand. The
  learner is told which version it is and what to do.
- Every way that a load can fail is a value with a kind that a screen can branch on, and a sentence that it can show. That the
  loader never throws, for any input, is a property.
- Changing the shape of a document without a version, a migration and a fixture fails a test, and so does editing a fixture.

### Negative / trade-offs

- Four numbers are more than one, and a change to the document that is also a change to the envelope bumps two.
- The envelopes are checked by hand and not by a schema, because persistence may not import `zod` ([ADR-0018](0018-workspace-layout-and-dependency-rules.md)).
  They are a handful of fields, and a spec covers every one.
- The caps are numbers that a person chose. A canvas over them cannot be opened, and the way out is to remove things from the
  file by hand.
- A canvas that commands made can in principle be over a cap, and then it loads nowhere and cannot be saved. Nobody can reach
  2,000 elements by hand in practice. Whether the commands should refuse before that is OPEN_QUESTIONS 9.
- A migration does the work of one version at a time, so a very old canvas is migrated in as many steps as there are versions.

## Alternatives considered

- **One number for the document, the files and the database.** Rejected: an envelope changes when what is around a canvas
  changes (a thumbnail, a runtime snapshot), the database changes when a record or a store does, and neither should force a
  migration of every document.
- **Migrate every record when the database is upgraded.** Rejected, for the rollback above.
- **Load what a newer file has that this version knows.** Rejected: [ADR-0012](0012-multiple-canvases-and-local-persistence.md)
  says never half-loaded, and the next save would drop what the app did not understand.
- **Put the caps in the domain's schema.** Rejected: the schema is the broker's rules and the simulator's, and a command would
  have to know the caps to keep "a document that a command made always loads". They can move there if OPEN_QUESTIONS 9
  decides that the commands should refuse.
- **Accept a bare document as a file.** Rejected: such a file does not say what it is or which version of the envelope it
  has, and cannot be told from any other JSON.
- **Throw typed exceptions.** Rejected: a load fails often, because the data comes from someone else, and a failure is an
  answer that a screen shows. A result is visible in the type, and "never throws" can be tested.
- **A schema library for the envelopes.** Not possible under ADR-0018 without widening the table, which needs a new ADR, for
  a few fields.

## Related

- [ADR-0012](0012-multiple-canvases-and-local-persistence.md), [ADR-0013](0013-self-contained-share-links.md),
  [ADR-0015](0015-testing-strategy-and-definition-of-done.md) (a migration test for every schema version),
  [ADR-0018](0018-workspace-layout-and-dependency-rules.md) (what persistence may import), and
  [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md) (the `Issue` and the strict document).
- [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md): the repository that keeps the records.
- [M1 plan](../plans/m1.md), sections 2.5 and 3 (S3).

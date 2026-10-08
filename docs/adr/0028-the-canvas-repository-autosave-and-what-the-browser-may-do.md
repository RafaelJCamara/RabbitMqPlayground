# ADR-0028: The canvas repository, autosave, and what the browser may do to the storage

- **Status:** Accepted. How the app opens a canvas and runs the autosave is settled by [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md). The meta store's `openCanvases`, who owns the repository now that there are several canvases, and the promise and the room on the home are settled by [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md) and [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md).
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** "Storage" of [ADR-0012](0012-multiple-canvases-and-local-persistence.md): the repository interface, the
  tombstones behind the Undo toasts, and the autosave debounce. [ADR-0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md)
  has the shapes that it keeps and the loader that it reads through.

## Context

[ADR-0012](0012-multiple-canvases-and-local-persistence.md) says that canvases are kept in IndexedDB behind a small
repository interface, that every command autosaves with a debounce, that a delete shows an Undo toast, that the app asks for
persistent storage and warns when storage is nearly full. [ADR-0015](0015-testing-strategy-and-definition-of-done.md) asks for
Create, Read, Update and Delete tests on fake-indexeddb. The plan says "an `idb` implementation and an in-memory one", "soft-delete
tombstones for the Undo toasts, a meta store, and `estimate()`". What it does not say is what each call answers when the
browser says no, what a tombstone is for and how long it lives, what happens to a canvas that cannot be read, what the
database does when two tabs have different versions of the app, and when exactly a debounced write is allowed to be late.

## Decision

### One repository, two stores

- **The rules are written once.** `createCanvasRepository(store, { now, newId })` holds them: what is valid, what a tombstone
  is, the order of a list, what a meta value is. It sits on a `RecordStore`, which only keeps raw records and the meta values
  and runs a set of reads and writes as one transaction that happens whole or not at all. There are two: one in memory
  (`createMemoryRepository`), and one on IndexedDB through `idb` (`createIdbRepository`). The memory one copies on the way in
  and on the way out, as IndexedDB does, so that nothing is shared with the caller, and it runs one transaction at a time.
- **One contract spec runs the same cases on both.** The memory repository is what the app's specs use, and the contract is
  what makes that honest.
- **The clock and the ids are injected and required.** `now()` gives milliseconds, `newId()` an id. Nothing here reads the clock or
  makes an id by itself, so a spec is the same every time. The app passes `Date.now` and `crypto.randomUUID`.
- **No call throws.** Each answers an `Outcome`: `{ ok: true, value }` or `{ ok: false, error }`, and an error is one of the
  kinds below or one of the loader's ([ADR-0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md)).

### Reading and writing

- **Everything that is read is validated.** `get` and `list` pass the raw record through the loader, so a record from an
  older version is migrated in memory, and one that is from a newer version, or damaged, is an error. The fields of the
  record are checked too: an id, a name, two times and `deletedAt`, and a key that it does not have is refused.
- **A canvas that cannot be read is not an error of the list.** `list()` answers `{ canvases, unreadable }`: the canvases
  that are valid, the one edited last first, and for each record that is not, its id, its name if it has one, and why. The
  home screen shows both, and the learner can delete an unreadable canvas like any other. `get` of one answers the error.
- **Everything that is written is validated the same way.** `create`, `save` and `put` check the name (not empty, at most 200
  characters), the id, the times and the document, and a canvas over a cap or with a problem is refused with the loader's
  error. Nothing is stored that `get` would then refuse: a property of the specs.
- **The calls.**
  - `create({ name, document, id? })` makes a canvas with a new id, or the id it is given, and `exists` if it is taken.
  - `save(id, { name?, document? })` changes it and sets `updatedAt`.
  - `put(record)` stores a record exactly as it is, replacing the one with its id, and is the door for an import.
  - `get(id)`, `list()`.
  - `softDelete(id)`, `softDeleteAll()`, `restore(id)`, `restoreAll(ids)` and `purgeExpired()`.
  - `getMeta`, `setMeta` and `deleteMeta`.
  - `estimate()`, and `close()`.
  - A deleted canvas, and one that is not there, is `not-found` for `get`, `save` and `softDelete`.
- **A record is migrated when it is read and rewritten only when it is saved.**

### Tombstones

- **A delete is a tombstone.** `softDelete` sets `deletedAt` and keeps the whole record, so that the Undo toast of ADR-0012
  has something to bring back. The record is invisible to `list`, `get` and `save`. `restore` clears `deletedAt`, and the
  canvas is exactly as it was: restoring is not an edit, so `updatedAt` does not move.
- **Delete all is a delete of each.** `softDeleteAll` puts a tombstone on every canvas that has none, readable or not, in one
  transaction, and answers their ids, which Undo gives to `restoreAll`. A canvas that was deleted before keeps its own
  `deletedAt`, so that undoing "delete all" does not bring back what the learner had deleted earlier.
- **A tombstone does not live long.** `purgeExpired` removes the ones that are older than `TOMBSTONE_TTL_MS`, 60 seconds, and
  the app calls it when it starts. The tombstone backs a toast, and is not a bin: the learner asked for the canvas to go,
  and it should be gone soon, from the disk too. The number is easy to change if a "recently deleted" screen is ever wanted.
- **`restore` of an id that is not a tombstone is `not-found`, and `restoreAll` ignores such ids**, so that the Undo of "delete
  all" brings back what is still there, even if some tombstones were purged meanwhile, and says which.

### The meta store

- It holds small values by key: `lastOpenCanvas` (an id), `lastBackupAt` and `backupReminderSnoozedUntil` (times). A value
  that is not what its key says it is, which is how a value from a newer version or from the browser's tools looks, reads as
  absent, and `setMeta` refuses one. When to remind someone to make a backup is the app's policy (S9), and not stored here.

### `estimate()` and the browser's own estimate

- `estimate()` answers what the repository knows: how many canvases there are, how many tombstones, and how many bytes their
  records come to as JSON. Both stores give the same numbers for the same records.
- What the browser allows is a different question. **`readUsage(manager)` and `quotaWarning(usage)`** answer it over a
  storage manager that is passed in (`navigator.storage`, or a fake). The warning is `ok` below 80% of the quota, `low`
  from 80% and `critical` from 95%, with a sentence that says what to do: export a backup, delete canvases that are not
  wanted, free space on the device.
- **`requestPersistence(manager)`** asks for `persist()` once and says what happened: `already`, `granted`, `denied`,
  `unsupported` or `failed`, each with a sentence. A browser may refuse or ask the user, and Safari evicts what is not
  persisted after a week without a visit, so the sentence for `denied` tells the learner to keep a backup. The app asks
  after the first save, not at start, because a browser weighs what the visitor has done on the site.

### Errors of storage

A failure of the browser is a value too:

| Kind | When | What the message says |
|---|---|---|
| `quota-exceeded` | the browser has no room | nothing was saved; export a backup, delete canvases or free space, then try again |
| `blocked` | another tab keeps an older version of the database open, so it cannot be upgraded | close the other tabs of the app |
| `unavailable` | the browser does not let the site keep data (a private window, blocked site data, no IndexedDB) | the canvas can still be built and saved as a file, and nothing will be kept automatically |
| `newer-database` | the database was made by a newer version of the app | reload for the newest version; nothing was changed |
| `failed` | anything else, with the browser's own words in `detail` | try again, and export a backup if it keeps happening |

and the repository adds `not-found` and `exists`. Where an error was thrown decides what it means: a failure while opening is
`unavailable` unless it is one of the others, and one while reading or writing is `failed` unless it is `quota-exceeded`.

### The database

- `DB_NAME` is `rmq-playground` and `DB_VERSION` is 1. There are two stores: `canvases`, keyed by the record's `id`, and `meta`,
  keyed by name. There are no indexes: the list is short and is sorted in memory.
- **The structure is upgraded by steps that only grow**, one for each version. Version 1 makes the two stores. A spec requires as many
  steps as `DB_VERSION`, and proves the runner on a step that exists only in the spec, on a database that already has records.
  Raising `DB_VERSION` is a decision about the structure around the canvases, and has nothing to do with `schemaVersion`.
- **The connection is opened when it is first needed, and is kept.** When another tab asks for a newer version it is closed at
  once, and opened again at the next call. When the browser ends it, the next call opens it again. A call that finds it closed
  opens it once more. An event that comes late for a connection that a call has already replaced lets go of that one and
  leaves the new one alone. When another tab blocks an upgrade, the call answers `blocked`, the open stays pending, and the
  next call uses the connection if the other tab has let go by then.
- **A transaction holds only IndexedDB's own promises.** Anything else that it waits for would close it.

### Autosave

`createAutosave({ write, delayMs, timer, onResult })` is a debounced writer for one value that changes: the document of the
open canvas. `write` is what saves it, for example `repository.save(id, { document })`.

- **It coalesces.** `schedule(value)` keeps only the last value, and each call starts the delay again. `delayMs` is 500 unless it
  is given. A value that is the very object that was last written is ignored, which is what ADR-0019's reference equality is for.
- **The timer is injected** (`set` and `clear`), and a spec moves it by hand. The default is the page's.
- **It can flush.** `flush()` writes what is waiting now and waits for a write that is under way, and answers whether anything was
  written. The app calls it when the page is hidden or closed.
- **Writes never overlap.** One at a time, in order. A value that comes while a write is under way is written after it.
- **It reports failure as a result.** A write that fails, or throws, is reported to `onResult` as an error (what a write throws
  is read as any error of the browser is), and to whoever called `flush`. The value stays waiting, nothing retries by itself,
  and the next `schedule` or `flush` writes the latest value. So a full disk is a message, and a retry once the learner has
  freed space. A listener that throws does not stop the saving.
- **`cancel()`** forgets what is waiting, for a canvas that is closed or deleted.

## Consequences

### Positive

- The app's specs can use the same repository that production does, minus the browser, and the contract spec is the
  proof that the two agree. A rule is changed in one place.
- A canvas that has gone wrong never takes the list down with it, and can be deleted. A canvas from a newer version is
  neither lost nor changed.
- The browser's refusals are answers that a screen can show: a full disk, a private window and two tabs are each a sentence
  and not a stack trace.
- The autosave is small enough to test without a clock, and its failure is something the editor can show.

### Negative / trade-offs

- `list()` reads and validates every canvas, which is a few milliseconds each. It is called when a screen opens, not
  while someone is editing.
- A tombstone holds a whole document for a minute. A tab that is closed in that minute leaves it there until the next start.
- The `blocked` answer leaves an open request behind it, and the repository has to remember to use its connection when it
  arrives.
- A backup is made of what `list()` answers, so it cannot contain a canvas that could not be read. What the home screen and the
  delete-all dialog say about those is S9's (OPEN_QUESTIONS 10).
- The 80% and 95% thresholds, the 60 seconds and the 500 milliseconds are numbers that a person chose.

## Alternatives considered

- **Two separate implementations that each have the rules.** Rejected: they would drift, and the contract spec would be the only
  thing that said so. With one set of rules, the store is the only part that can differ, and the contract is about the store.
- **An abstraction over the storage that is more than the small interface** (Dexie, `idb-keyval`). Rejected: ADR-0018
  lets persistence import `idb` and nothing else, and a few calls do not need more.
- **Throwing, and letting the app catch.** Rejected for the reason in ADR-0027: a full disk and a private window are expected
  answers, and a type that says so is checked.
- **Hard delete, with the Undo copy held in memory.** Rejected: the copy goes with the tab, and the toast would offer an Undo
  that a reload cannot honour. A tombstone survives, and is purged at the next start.
- **Throttle instead of debounce.** Rejected: a burst of commands should be one write at the end, and the app flushes when the
  page is hidden, so a pause is not needed to be safe.
- **Retry a failed write on a timer.** Rejected: a full disk does not clear by itself, a retry loop hides the failure from the
  learner, and the next edit retries anyway.
- **Ask for `persist()` when the app starts.** Rejected: a browser decides by what the visitor has done, and a first visit has
  done nothing.

## Related

- [ADR-0012](0012-multiple-canvases-and-local-persistence.md), [ADR-0019](0019-undo-through-immutable-document-snapshots.md)
  (history is memory only, and reference equality), [ADR-0015](0015-testing-strategy-and-definition-of-done.md).
- [ADR-0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md): the shapes, the loader and the caps.
- [ADR-0018](0018-workspace-layout-and-dependency-rules.md): persistence may import `@rmq/domain`, `@rmq/engine` and `idb`.
- [M1 plan](../plans/m1.md), sections 2.5 and 3 (S3).

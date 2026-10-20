# ADR-0111: A definitions file is imported into the open canvas, and replaces what it has, in one change that Undo takes back

- **Status:** Accepted
- **Date:** 2026-10-20
- **Deciders:** @RafaelJCamara
- **Refines:** "Import (M2)" of [ADR-0014](0014-broker-interop-via-definitions-json.md): the vhost that is chosen becomes the content of the canvas that is open, not a new canvas. The rest of it stands (a vhost picker, a file that is checked so that nothing in it can crash the import, auto-layout, and a report of what is left out). It also refines "a file never replaces a canvas" of [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md), which still holds for a canvas file and a backup.

## Context

- ADR-0014 planned the import of a RabbitMQ definitions file for M2, and only the export was built (ADR-0079). A learner who had a topology on a broker had to draw it again.
- The request: "the possibility to import the definitions.json inside a canvas. If there's existing content inside the canvas, importing a definitions.json should override the existing one." The maintainer chose that it replaces **everything** on the canvas, producers and consumers too.
- A definitions file has more than a canvas can hold: users, permissions, policies, parameters, several vhosts, queue types and arguments, the exchanges that a broker makes itself (`amq.*`), exchange types of plugins. A file from another tool may be malformed. Earlier simulators crashed on such files (`TypeError: binding is null`, ADR-0014).
- RabbitMQ keeps `1` and `1.0` apart in the arguments of a binding (ADR-0009), and the export writes a float as `1.0` for that reason (ADR-0079). `JSON.parse` reads both as the number 1.
- Every change of a canvas is a command (ADR-0011), so that it is checked, undone, saved, and followed by the simulation.

## Decision

### Where it is, and what it looks like

- **An "Import…" button in the Share group of the top bar**, beside "Export…" (`data-testid="import"`). It opens the browser's file picker, which takes JSON files only by name and type, and a file that is not one, or is over 200 MB, is refused before it is read (ADR-0102, with the sentence of this picker: "The import takes a RabbitMQ definitions file, which is a JSON file."). `refusedKind` and `tooBigToRead` move from `canvases/` to `core/files/`, so that the editor can use them, and take the words of their picker.
- **The dialog** (`rmq-import-dialog`, opened by `ShareDialogs`, one dialog at a time) says which file; the vhost, with a select when the file has several (it starts at the only one, or at `/` when the file has it, or at the first); what the canvas will have ("3 exchanges, 4 queues and 5 bindings will be on the canvas."); and, when the canvas is not empty, that this replaces everything on it, with how much, and that Undo takes the import back. The button then says "Replace and import", and "Import" on an empty canvas. The list "What is not imported as it is in the file" has each note, with its kind in words (Left out, Changed, Refused).
- **A file that cannot be imported** opens the same dialog with the reason (`role="alert"`) and only a Close button. A file that has nothing a canvas can hold says so, with the notes of what was left out; its Import button stays enabled and says the reason again (as the export does).
- There is **no command-bar verb** for it: a command cannot carry a file.

### What it reads

- **`readJson`** (`persistence/src/lib/import/json.ts`) is a reader of JSON that keeps whether a number was written with a fraction or an exponent (`JsonNumber.float`), keeps the keys of an object in the order of the file (an object of JavaScript puts `"10"` before `"x-match"`), takes `__proto__` as a key like any other, refuses deeper than 64 levels, never throws, and says where it stopped.
- **`readDefinitions`** refuses a text over the cap of a file (50,000,000 characters, as a canvas file), text that is not JSON, a file of this app ("Open a canvas file or a backup from My canvases"), and JSON with no list of exchanges, queues or bindings. It names the vhosts of the file (from `vhosts` and from the entries) and counts the other lists that hold what a broker has: users, permissions, topic permissions, policies, parameters and limits. What says where the file came from (`rabbitmq_version`, `explanation`, `metadata`, `global_parameters`, which name the cluster) is not reported.
- **`planImport(file, vhost)`** takes the entries of that vhost, and the entries that name none (which is how a broker exports one vhost: `GET /api/definitions/{vhost}`), and turns them into commands: `declare-exchange`, `declare-queue` and `bind`, with the header arguments typed as the canvas types them (a string, a boolean, an integer, or a float for a number written with a fraction or an exponent).
- **What it leaves out or changes, each in a sentence:** the other lists and the other vhosts; the exchanges that a broker makes itself; an exchange of a type that is not direct, fanout, topic or headers, and the bindings that need it; a binding of the default exchange; a binding whose `x-match` is not one of the four, or whose argument is a list, a table or null; an item that lacks a field or has one of the wrong kind (counted per list). It imports a quorum or stream queue as a classic one, and an exchange or a queue without its arguments, and an auto-delete queue as one that is not, and says so.
- **Each command is tried, in the order of the file, on an empty canvas of its own.** What the canvas refuses (a queue that is not durable, ADR-0024; a reserved name; a topic key with three `#`; the caps of ADR-0029) is a note with the canvas's own reason, and the rest goes in. Something that is there twice changes nothing the second time and is not counted. A file in which nothing can go on a canvas is refused, with the notes.

### What it does to the canvas

- **One batch through the bus** (`importBatch`): `clear`, then `set canvas vhost=<the vhost>` when the file names one, then the commands, then `layout`. It applies all or nothing, is one step of undo (ADR-0019), is saved by the autosave, is followed by the simulation through `reconcile`, and is one line in the log of equivalent commands. `CommandBus.load` is not used: it starts the history again and is not saved.
- **`set canvas vhost=…`** is a new attribute of `set canvas` (in `CanvasChanges` and the grammar), with the rules of the document: not empty, at most 255 bytes of UTF-8. The canvas takes the vhost of the file, which the export then offers first. A file that names no vhost leaves the canvas its own.
- **What stays:** the settings of the canvas (the seed, the timings, the default exchange), as `clear` keeps them. The name of the canvas.
- **A batch can carry a `label`**, which the bus says instead of describing its commands: "Imported 3 exchanges, 4 queues and 5 bindings from a definitions file." A notice with Undo follows, as one follows a clear (ADR-0074, ADR-0099), and goes when the canvas changes again.

### Tests

- The export of this app read back: every golden file of `fixtures/export` imports onto an empty canvas and onto one that has things, and the canvas exports the same bytes; for any canvas that commands can make and any vhost, the import of its export onto any canvas gives the vhost, no producer or consumer, the same settings, and the same file again; a file damaged anywhere is refused in words or imported, and never throws.
- A file that RabbitMQ 4.3.6 exported (`fixtures/import`, declared by `tools/import/declare-broker-fixture.sh` on a container and exported by the broker itself, whole and for one vhost): what is imported, in the order of the file; `"ratio": 1.0` a float and `"pages": 10` an integer; each note.
- The dialog, the action, the top bar, the journeys in a browser (replace and Undo, a round trip through the export, the refusals), and axe on the dialog in both themes (two rows of `docs/accessibility.md`).

## Consequences

### Positive

- A topology that is on a broker comes onto a canvas in one step, and the report says what did not come and why.
- The import is made of the commands that a learner can type, so every rule of the canvas holds for it, and Undo, the autosave, the log and the simulation need nothing new.
- The round trip with the export is held by a property, so a change to one that breaks the other fails a test.

### Negative / trade-offs

- An import replaces the canvas: what was there is gone except through Undo, whose history is held in memory by the editor (ADR-0019) and is not there after a reload. A learner who wants to keep both has to duplicate the canvas first.
- The line of the log for an import is every command of it, which is long for a large file.
- A quorum or stream queue becomes a classic one, and arguments such as a TTL or an alternate exchange are dropped: the canvas then routes as the broker does, but does not do everything that the broker does with them.
- The JSON reader is code of our own, where `JSON.parse` is not: it is held by a property against `JSON.parse` and by hostile inputs.

## Alternatives considered

- **Open a definitions file as a new canvas from the home**, as ADR-0014 planned. Not what was asked; it may come later beside this, and nothing here is in its way.
- **Add what the file has to the canvas instead of replacing it.** Names would clash with what is there, and the request was to override.
- **`CommandBus.load` of a new document.** It starts the history again, so nothing is left to undo, and the session does not save a change that it makes (`canvas-session.ts` skips the cause `load`).
- **Validate the file with a zod schema.** A schema refuses the whole file for one bad item; reading each item and saying what is left out keeps the rest of a real file.
- **`JSON.parse` with the source text of its reviver.** It tells `1.0` from `1`, but the objects that it makes still put a key such as `"10"` first, and the order of the arguments of a binding is part of what a canvas holds.
- **Ask a confirmation in a second dialog.** The one dialog already says what is replaced, and Undo takes it back, as with a clear (ADR-0074).

## Related

- [ADR-0009](0009-headers-exchange-support.md), [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0014](0014-broker-interop-via-definitions-json.md), [ADR-0019](0019-undo-through-immutable-document-snapshots.md), [ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md), [ADR-0029](0029-the-commands-refuse-at-the-size-caps.md), [ADR-0074](0074-delete-clear-and-delete-all-ask-once-and-can-be-taken-back-with-an-undo-that-says-how-long-it-lasts.md), [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md), [ADR-0079](0079-the-export-is-a-definitions-file-for-one-vhost-written-with-floats-as-1-0-it-lists-what-it-leaves-out-and-the-nightly-imports-it.md), [ADR-0085](0085-targets-are-24-pixels-nothing-that-stays-is-drawn-over-the-canvas-and-every-screen-is-checked-in-both-themes-from-a-list.md), [ADR-0102](0102-the-file-pickers-take-only-json-files-by-name-and-type-and-refuse-anything-else-before-they-read-it.md).
- Code: `web/projects/persistence/src/lib/import/json.ts`, `import/definitions.ts`, `web/projects/domain/src/lib/commands/set.ts` (`vhost`), `syntax/specs/set.ts`, `web/projects/app/src/app/share/import-dialog.ts`, `editor/actions.ts` (`importDefinitions`), `editor/top-bar.ts`, `core/files/file-kind.ts`, `core/files/file-text.ts`.
- Tests: `persistence/src/lib/import/json.spec.ts`, `import/definitions.spec.ts`, `domain/src/lib/commands/set.spec.ts`, `share/import-dialog.spec.ts`, `editor/actions.spec.ts`, `editor/top-bar.spec.ts`, `e2e/import-journeys.spec.ts`, `e2e/share-a11y.spec.ts`. Fixtures: `web/fixtures/import/`.

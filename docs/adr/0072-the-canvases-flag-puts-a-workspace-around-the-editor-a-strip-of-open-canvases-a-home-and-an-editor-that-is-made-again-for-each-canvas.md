# ADR-0072: The `canvases` flag puts a workspace around the editor: a strip of open canvases, a home, and an editor that is made again for each canvas

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** @RafaelJCamara
- **Extends:** "UI (M1)" and "Storage" of [ADR-0012](0012-multiple-canvases-and-local-persistence.md), the folders and the lazy chunk of [ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md), and the session of
  [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md) ("the session decides some policy that S9 will revisit when there are several canvases: which one is open, and what its name is"), for what S9
  ([#11](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/11)) puts behind `canvases`.

## Context

Until S8 the app has one canvas. The editor makes the state it shares (ADR-0031), its session opens "the canvas that was open last, or the most recent, or makes one", and nothing else in the app knows that a canvas has an id. S9 adds several: a home that lists them,
a strip of the ones that are open, new, rename, duplicate, delete, clear, delete-all, a backup and a file. The plan fixes the screens (ADR-0012, section 3), and leaves open how they are arranged around the editor that exists, what keeps the open ones across a reload,
what happens to the history and the simulation of a canvas that is left, and who owns the repository now that two parts of the app use it.

The facts that decide it:

- The editor is one component that provides its own stores (`DocumentStore`, `CommandBus`, `SelectionStore`, `CanvasSession`, the simulation and the explanation). Nothing is shared with a second editor, and the Foblex canvas, the engine and the frame loop of an editor that is hidden
  would keep running.
- The history of a canvas is the timeline of its store (ADR-0019), which `load` clears. A canvas that is opened has "a new engine" (OPEN_QUESTIONS, follow-ups of S6): nothing of a simulation is saved with it.
- The session opens its own repository and closes it when the editor goes. With two users of the repository, in the memory fallback (a private window) they would see two different maps.
- There is no router, and no URL for any screen (ADR-0030). `#c=…` is reserved for the share links of S10.

## Decision

### The flag and the root

- **`canvases` needs `editor`.** Alone it does nothing, as `headers` alone does nothing (ADR-0069), and a unit test says so. Without it the app is what S8 left: the editor, with its one implicit canvas, opened by the session.
- The root shows, behind `editor`, `<rmq-editor>` as before, or with `canvases` the **workspace**, `<rmq-workspace>`, in a `@defer` block of its own, so that a visitor without the flag downloads none of it, and the editor's chunk is the one that it was.

### The workspace

It is three things in a column: the **strip of open canvases**, a **notice region** for the toasts of ADR-0074, and the **view**, which is the home or the editor.

- **The strip** is a `nav` named "Open canvases" that holds a list: first **My canvases**, which shows the home, then one item for each open canvas (a button with its name, and a button that closes it), and last a button **New canvas**. The one that is shown has `aria-current="true"`. It is
  not the ARIA tabs pattern: a tab may not hold a button (the close button would be nested inside it), a tab needs a panel that it controls and arrow keys that move between tabs, and every item here is a plain button that Tab reaches. The strip wraps to more lines when it has more than fits, and does
  not scroll sideways, so no item is hidden (WCAG 1.4.10).
- **Closing a tab is not deleting.** The canvas stays in the browser and in the home. Closing the one that is shown shows the one next to it on the left, or on the right if it was the first, or the home if it was the last. A tab that is closed is not asked about: nothing is lost, because the canvas was saved
  before it went (see "Leaving a canvas").
- **The home is not a tab of a canvas.** It is a view, and it is the only one that can show no canvas at all.

### Which canvas is shown, and which are open

- The open canvases and the one shown are kept, so that a reload brings back the strip. The repository's meta store (ADR-0028) gets a third kind of value next to `lastOpenCanvas`: **`openCanvases`**, the ids of the open canvases in the order of the strip. A value that is not a list of ids that are valid and different from one another reads as absent, as the others
  do, and an id of a canvas that is gone or cannot be read is dropped when the strip is made. It is written when a tab is opened, closed or when the strip changes, in the background; if the write fails the strip is whatever it was, and the next reload shows the canvas that was open last.
- **At start** the workspace shows the canvas that was open last if it is open, else the first open one, else the most recent canvas that can be read, else it makes "Untitled canvas" (the first run). It never starts on the home: the learner came to build.
- **Showing the home** and **showing a canvas** are the same act: `library.show(view)`. Both write `lastOpenCanvas` when a canvas is shown.
- There is no route and no change of the address. The Back button leaves the app as it did, and `#c=…` stays for S10.

### Leaving a canvas

- **The editor is made again for each canvas.** The workspace shows it with `@for (id of shown; track id)` over a list of zero or one id, so that a change of canvas destroys the editor and everything it provides, and makes a new one that opens the canvas by its id. The history, the selection, the position and zoom of the view, the
  simulation (its clock, its messages, its counters) and the open panels of the canvas that is left are gone. This is the stated trade-off of the plan ("a canvas that is opened has a new engine"), and it is what keeps one Foblex canvas and one engine alive at a time.
- **What the learner did is written first.** The session writes what is waiting when the editor goes, and does not cancel it (it did, because the page was going). The library waits for the editor it is leaving to finish writing before it asks the repository for anything, so that a canvas that is duplicated, exported or opened again is the one that
  the learner left, not the one from 500 ms before.
- A learner who wants the history of a canvas back has Undo, which is the document's and is per editor; "Undo" of a delete or a clear is the toast's (ADR-0074).

### Who owns the repository

- **One repository for the page**, made by a service of the root, `CanvasStorage`: it tries the browser's, and if that fails to open (a private window, blocked site data) it works in memory and keeps the reason, exactly as the session did. The session and the library both ask it for the repository, so they see the same canvases whichever it is. It closes the
  repository when the app is destroyed, which in a page is never and in a test is the end of the test. `REPOSITORIES` (the two factories) stays the way a spec decides which repository the page gets.
- **The session saves the document of the canvas it was given, and nothing else.** `open(id)` takes the canvas named by the workspace; without an id it picks one as before, so that the app without the flag, and every spec of S4 to S8, behave as they did. If the id cannot be opened it falls back to the pick and says so on the status line: the strip
  does not keep an id that the repository will not give.
- **The library does everything to the list**: it makes, renames, duplicates, deletes and restores canvases, reads them for the home and the files, and keeps the strip. It does not touch the document of the canvas that is open; the session does. A rename is a write of the name alone, and the session's write is a write of the document alone, and a record is read and written in one
  transaction, so they cannot lose each other's change.

### Names

- A new canvas is "Untitled canvas", and if that is taken by a canvas, "Untitled canvas 2", and the first free number after that. A copy is "<name> (copy)", then "<name> (copy 2)", and so on; the name is cut so that the whole stays inside the 200 characters of S3. The names are only a help: **two canvases may have the same name** (ADR-0028), and
  a rename never refuses for that.
- A rename is refused when the name is blank or longer than 200 characters, with the words of S3 for the cause and the field kept open, as the rename of a node is.

### The commands of the language do not change

New, rename, duplicate, delete, open, close and the files are not changes of a document, so they are not commands, and the command bar does not learn them. The one command that S9 touches is `clear`, which exists (ADR-0025), and which ADR-0074 gives a button and a toast.

## Consequences

### Positive

- With the flag off nothing changed: the same editor, the same session, the same specs. The workspace is a parent of the editor and not a change to it, except that the session takes an id and no longer owns the repository.
- One Foblex canvas and one engine are alive at a time, so a learner with twenty canvases open pays for one.
- A reload brings back the strip and the canvas, and a repository that fails to open does not stop any of it: it works in memory, and says so in the same words.
- S10's share links, S11's templates and the first-run chooser find a library to ask: a template is a document and `create` takes any.

### Negative / trade-offs

- **Switching loses the undo history and the simulation of the canvas that is left.** A learner who goes to the home and back finds the canvas as saved, with the clock at 0 and nothing in the queues. It is the price of one engine, and it is easy to revisit (the library could keep a timeline for each open canvas); nothing here stops it.
- A strip with many open canvases takes more lines of the screen. A learner closes the ones that they are not using.
- The workspace is a second component that decides what is shown, next to the root, which has to be told about the flag; the root's two branches and the workspace's two views are four states to hold in tests.
- `openCanvases` is a key of the meta store that an older version of the app does not know. It ignores it, as it ignores any key it did not make.

## Alternatives considered

- **Keep an editor alive for each open canvas and hide the ones that are not shown.** Rejected: each one holds a Foblex canvas, an engine and a frame loop, and the browser would run all of them. The history and the simulation would be kept, but at a cost that grows with the strip.
- **A router with a route for the home and one for each canvas** (`/canvases`, `/canvases/:id`). Rejected for now, for the reason in ADR-0030: the Pages base path makes a deep link a 404 on the first load (the document of a deep link is a 404 on GitHub Pages on purpose), the address would have to share the hash with S10, and nothing in the plan links to a canvas from
  outside. A route can replace `library.show` without changing what is in the views.
- **The ARIA tabs pattern for the strip.** Rejected: see above. A list of buttons with `aria-current` says the same to a screen reader and holds a close button without nesting one control in another.
- **The home in a dialog over the editor.** Rejected: it is a screen with a grid, a search field, a sort and sections, and a dialog over a canvas that is still running would have two things to focus.
- **Persist the strip in `localStorage`.** Rejected: the repository is where the canvases are, and it already has the fallback for a browser that keeps nothing; a strip in another place could name canvases that the repository does not have.

## Related

- [ADR-0012](0012-multiple-canvases-and-local-persistence.md), [ADR-0019](0019-undo-through-immutable-document-snapshots.md), [ADR-0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md),
  [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md), [ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md), [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md).
- [ADR-0073](0073-the-home-is-a-grid-of-cards-from-one-read-and-a-canvas-that-cannot-be-read-is-listed-with-its-reason.md), [ADR-0074](0074-delete-clear-and-delete-all-ask-once-and-can-be-taken-back-with-an-undo-that-says-how-long-it-lasts.md),
  [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md).
- The M1 plan, sections 2.5 and 3 (S9).

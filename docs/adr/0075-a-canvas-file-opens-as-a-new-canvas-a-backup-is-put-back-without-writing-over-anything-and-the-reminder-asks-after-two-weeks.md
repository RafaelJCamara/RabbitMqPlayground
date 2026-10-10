# ADR-0075: A canvas file opens as a new canvas, a backup is put back without writing over anything, and the reminder asks after two weeks

- **Status:** Accepted. A reminder of a canvas that was never backed up counts its 14 days from the oldest canvas that has an element on it: [ADR-0076](0076-what-building-s9-settled-the-notices-are-in-the-flow-the-strip-is-the-banner-a-view-is-said-aloud-and-a-tab-can-be-renamed.md). The quiet line about the room that the canvases take is superseded by [ADR-0100](0100-the-foot-of-the-home-keeps-the-disclaimer-and-the-source-link-and-the-line-of-room-goes-the-warnings-stay.md), the warnings and the rest stand. That the session reads the promise and says it in the editor is superseded by [ADR-0101](0101-the-note-that-the-browser-did-not-promise-to-keep-the-canvases-is-on-the-home-only-and-no-editor-shows-it.md) (the home says it, the editor does not), the rest stands.
- **Date:** 2026-10-08
- **Deciders:** @RafaelJCamara
- **Extends:** "Files" and "Storage" of [ADR-0012](0012-multiple-canvases-and-local-persistence.md), the formats and the one loader of [ADR-0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md) ("what to do with an id that is taken is S9's choice"), and the promise, the room and the reminder of
  [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md) ("when to remind someone to make a backup is the app's policy (S9)").

## Context

S3 built the formats and the readers and writers (`writeCanvasFile`, `parseCanvasFile`, `writeBackup`, `parseBackup`), the repository's `put` (which keeps a record exactly as it is, "the door for an import"), the meta values for the reminder (`lastBackupAt`, `backupReminderSnoozedUntil`), and `requestPersistence`, `readUsage` and
`quotaWarning`. The session already asks the browser for its promise after the first save (S4). What S9 decides is what each act does to the canvases the learner already has, since a file can name an id that is taken; how a file gets to and from the disk; when the app reminds the learner to make a backup; and where the promise and the room are
shown now that the editor is not always on the screen.

## Decision

### Saving a canvas as a file

- **Save as file** (on the card of the home, ADR-0073) writes `writeCanvasFile({ name, document })` for the canvas **as saved**: the library first waits for the editor, if that canvas is shown, to finish writing (ADR-0072), then reads the record. The text is JSON with two spaces and a final newline, as S3 wrote it, and it is read back by the same reader before it is offered, so the app never
  writes a file that it would refuse to open.
- The file is named from the canvas: the name in lower case, every run of characters that are not letters or digits as one `-`, no `-` at either end, at most 60 characters, "canvas" if nothing is left, then `.rmq.json` (`orders-flow.rmq.json`). The extension ends in `.json`, so a file picker offers it.
- **The browser is asked through a service**, `FileDownloader`, that makes a `Blob` and a link with `download` and clicks it, and lets go of the URL a moment after. A spec gives the library a downloader that records the name and the text; a browser test waits for the `download` event and reads the file.

### Opening a file

- **A canvas file opens as a new canvas, always.** It has no id and no time (ADR-0027); the library gives it an id and the time now, the name that the file says, and the document the loader returned; it is opened in a tab and shown. It never replaces a canvas, because the file does not say which one. A learner who wants the file to replace a canvas deletes that one: it can be taken back (ADR-0074).
- **A file that the loader refuses changes nothing and says why.** The dialog is named "“orders.json” could not be opened" and holds the message of S3, root cause first: not JSON, not a canvas file ("this is a backup of several canvases… open it as a backup"), too big, invalid with its first problem and how many more, and, for a file from a newer version, that the file was
  saved by a newer version and the page should be reloaded to get it. Nothing is added to the list.
- **A file is not read if it is too big to be a canvas.** The cap of S3 is 50,000,000 characters of text, which is at most 200,000,000 bytes. A file over 200 MB is refused from its size, before `file.text()` is called, with a sentence that gives its size and the cap. A file under that is read and the loader applies the cap to its characters.

### Backing up everything

- **Back up everything** writes `writeBackup` of the canvases that `list()` could read, with `exportedAt` the time now, to `rmq-playground-backup-2026-10-08.json` (the date is the learner's own, from the injected clock and the local time zone). It then writes `lastBackupAt` to the meta store.
- **It says what it did.** "Backed up 5 canvases to rmq-playground-backup-2026-10-08.json." and, when some could not be read, "2 could not be opened and are not in the file." (ADR-0073). With no canvas that can be read it makes no file and says "There is nothing to back up: no canvas here can be opened."
- **The learner is reminded, once the file is saved, to keep it somewhere else**: a backup in the downloads folder of the same device is not a backup against losing the device. The sentence is in the notice and not in a dialog.

### Putting a backup back

- **A backup never writes over a canvas.** Each canvas of the file is read on its own (S3), and for each one that can be read:
  1. its **id is free** (no canvas has it, or only a tombstone does): it is put back as it was, with the id, the name, the times and the document of the file (`put`);
  2. its **id is taken, and the canvas that has it is the same** (the same name and the same document, compared by value and not by the order of the keys): it is **left alone** and counted as "already here", so that putting back the same backup twice makes nothing new;
  3. its **id is taken, and the canvas that has it is different**: it is made as a **new canvas** with a new id and the name "<name> (restored)", and the one that was there is untouched. The learner sees both and chooses.
- **A canvas of the file that cannot be read does not stop the others.** It is listed in the report with its place in the file (counting from 1 for a person), its name if the file gave one, and the reason from S3.
- **The browser may run out of room in the middle.** The first write that fails with `quota-exceeded` stops the restore, because the next would fail too, and the report says how many were put back and that the rest were not, with the words of S3 (export a backup, delete canvases you do not need). Any other failure is listed for that canvas and the restore goes on.
- **The report is a dialog** that says, in this order, what was put back, what was already here, what was added as a copy, and what could not be read or written, and it is also said aloud. At most 20 problems are listed, and "and 3 more" is the rest. A backup that the loader refuses as a whole (not JSON, a canvas file, a newer backup, over the cap) is the same dialog as a file that is refused.
- Restoring a backup does not touch `lastBackupAt`: it says nothing about when the learner last made one.

### The reminder

- **A learner is reminded on the home, and nowhere else**, never over the canvas, never in a dialog, and never more than once in a week if they say later.
- **It is due when** there is at least one canvas, the reminder is not snoozed (`backupReminderSnoozedUntil` is not in the future), at least **14 days** have passed since the last backup (or, if there has never been one, since the oldest canvas was made), **and** something has changed since: some canvas was edited after the last backup, or, if there has never been
  a backup, some canvas has an element on it. A learner who has only empty canvases, or who has changed nothing since a backup, is not asked.
- **The notice says why in words**: "You have not backed up your canvases since 20 September. This browser keeps them on this device only, and they can be lost if the browser is cleared or the device is replaced." (or "You have never backed up your canvases." and the same reason), with **Back up everything** and **Remind me in a week**. The second writes `backupReminderSnoozedUntil` as the
  time now plus 7 days; the first writes `lastBackupAt`. The numbers (14 and 7) are constants of one file, and the function that decides is pure and takes the time as an argument.

### The promise and the room, on the home

- **The page's storage owns them.** `CanvasStorage` (ADR-0072) asks the browser for its promise once per page and reads the room, and the session and the home both read what it has. The session still asks after the first successful save (S4), and the home asks when it is first shown if nobody has, so the promise is asked for once, whichever screen came first.
- **The home shows a line** under the actions: the room ("The canvases take 1.2 MB of the 2.1 GB that the browser allows.") and, when the browser has not promised to keep them, S3's sentence for it with **Back up everything**. At 80% and 95% of the room it shows S3's warning in the colour of a warning and of an error, and says it in words as well (WCAG 1.4.1).
  The numbers come from `readUsage`, read when the home is shown and after anything that writes.
- **When the browser keeps nothing** (a private window) the library works in memory, and the home says so at the top, in S3's words for it, and that **Save as file** and **Back up everything** are the way to keep what is built.

## Consequences

### Positive

- Nothing in this slice writes over a canvas that a learner made: a file adds one, a backup adds some and skips what it has, and the only act that removes anything is the delete, which can be taken back.
- Every refusal of a file is the loader's own sentence, so the words are the same wherever a canvas is read from (a share link, in S10, will say the same).
- The reminder is a pure function of the clock and a few numbers, so its edges (exactly 14 days, snoozed, never backed up, nothing changed) are cases of a table and not behaviour that has to be waited for.
- The promise is asked for once whichever screen comes first, and the home can show it with no editor.

### Negative / trade-offs

- A learner who restores a backup into a browser that has the same canvases, after having changed one, gets "(restored)" copies, which are noise if the intent was to go back. The alternative, to write over, loses the changes without being asked; the copy is the one the learner can undo by deleting.
- Comparing two documents by value is a walk of both. It runs once for each canvas of a backup whose id is taken, and a backup is capped at 1,000.
- A file picker cannot be driven by a unit test in jsdom; the unit specs call the library with text and a fake downloader, and the browser tests drive the real picker with `setInputFiles` and the real download.
- The reminder counts days from a clock that the learner can change. It is a nudge, and nothing depends on it.
- A backup does not hold the canvases that cannot be read (ADR-0073), and the notice says how many.

## Alternatives considered

- **Let a file name an id and replace the canvas that has it.** Rejected: a file that was edited or is old would write over newer work, and a learner who opens a file to look at it would be asked a question they did not expect.
- **Ask, for each canvas with a taken id, whether to skip, replace or keep both.** Rejected: a backup of fifty canvases would be fifty questions. "Keep both" is the choice that loses nothing, and it is the one made.
- **Ask for the promise only on the home, or only in the session.** Rejected: whichever screen is first should ask, and the answer is a property of the page.
- **Remind with a banner over the editor.** Rejected: the editor is where the learner is thinking, and a reminder that cannot be acted on from there (the backup is of everything, and its button is on the home) interrupts for nothing.
- **A backup in the format of one canvas file per canvas, zipped.** Rejected: ADR-0027 chose one JSON file, which needs no library to write and can be read by a person.
- **Download through the File System Access API when it is there.** Rejected: it is in some browsers and not others, it asks a question of its own, and `download` works in all.

## Related

- [ADR-0012](0012-multiple-canvases-and-local-persistence.md), [ADR-0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md), [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md).
- [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md), [ADR-0073](0073-the-home-is-a-grid-of-cards-from-one-read-and-a-canvas-that-cannot-be-read-is-listed-with-its-reason.md),
  [ADR-0074](0074-delete-clear-and-delete-all-ask-once-and-can-be-taken-back-with-an-undo-that-says-how-long-it-lasts.md).

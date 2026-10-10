# ADR-0074: Delete, clear and delete-all ask once and can be taken back, with an Undo that says how long it lasts

- **Status:** Accepted. The region of the notices is a strip in the flow of the page under the view, and not in the corner over it: [ADR-0076](0076-what-building-s9-settled-the-notices-are-in-the-flow-the-strip-is-the-banner-a-view-is-said-aloud-and-a-tab-can-be-renamed.md). The notices float at the bottom right and the screens leave room for them, superseded by [ADR-0097](0097-the-notices-float-at-the-bottom-right-and-every-screen-leaves-room-for-them-or-keeps-clear-of-them.md), the rest stands.
- **Date:** 2026-10-08
- **Deciders:** @RafaelJCamara
- **Extends:** "Per-canvas actions", "Clear canvas" and "Delete all canvases" of [ADR-0012](0012-multiple-canvases-and-local-persistence.md), the tombstones of [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md), and the dialog of [ADR-0047](0047-guidance-the-hint-bar-the-how-to-link-card-and-the-cheat-sheet.md)
  (the cheat-sheet, which is a CDK dialog), for what S9 ([#11](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/11)) puts behind `canvases`.

## Context

ADR-0012 asks that a learner can delete one canvas, clear one, and delete all of them, and that none of these loses work by mistake: delete "asks for confirmation, then shows an Undo toast"; clear "can be undone, and is also available as the `clear` command"; delete-all has "a confirmation dialog [that] states how many canvases will be deleted and
offers 'Export a backup first'", and "after deleting, an Undo toast appears briefly". S3 built what these stand on: a delete is a tombstone that lives 60 seconds (`softDelete`, `softDeleteAll`, `restore`, `restoreAll`, `purgeExpired`). The `clear` command exists (ADR-0025) and Undo brings everything back.

What is left to decide is the toast (nothing in the app is one yet), how long it lasts and what it does to the keyboard and to a screen reader, when its Undo stops being true, what each of the three says, and where the focus goes when what had it is gone.

## Decision

### A toast is a notice with an action that can still be true

- **`Toasts` is a service of the root, and `rmq-toast-host` is where they are drawn**, once, in the workspace: a region named "Notices", at the bottom of the screen above the status strip, that holds up to three toasts, the newest last. A fourth takes the place of the oldest.
- **A toast has a message, optionally an action (`Undo`), and a condition.** The condition is a function of signals, `stillTrue`, that the host reads: when it turns false the toast goes. The Undo of a clear is true only while the document is the one that the clear left; the Undo of a delete is true while the tombstone is not known to be gone. A button that cannot work is not left on the screen.
- **It lasts 30 seconds.** The tombstone lives 60, so a toast that goes after 30 is well inside it, and the time that is stopped while the learner is on the toast (below) does not take it past it for long; a toast that outlived the tombstone would offer a canvas that is gone. The time is a token (`TOAST_TTL_MS`) so that a spec and a browser test do not wait.
- **The time stops while the pointer is over it or the focus is inside it**, and starts again from the whole 30 seconds when it leaves (WCAG 2.2.1, 1.4.13), and the toast has a **Dismiss** button. Escape with the focus inside it dismisses it.
- **It is said once, and politely**, through the announcer (ADR-0031): the message, then "Press Control Z to undo." (or Command Z on a Mac, from the same table of shortcuts) when it has an action. The region is not itself a live region, because a toast that is both would be said twice. The buttons are in the order of the page, after the canvases, so Tab reaches them; the key is the quicker way.
- **Ctrl or Cmd+Z takes back the newest toast that has an Undo and is still true**, on the home, when the focus is not in a field of text. In the editor Ctrl+Z is the document's Undo (ADR-0035), which for the toast of a clear is the same act, and for a canvas that was deleted there is nothing in the editor to undo.
- **If the Undo itself fails, it says why and does not pretend**: a canvas whose tombstone has been purged ("'Orders' is gone for good: it was deleted more than a minute ago.") or a storage error, with the words of S3, root cause first. The toast is taken away only when the Undo worked.

### Delete one canvas

- **The learner confirms once.** **Delete** on a card opens a dialog (a CDK dialog, `role="alertdialog"`, a title that is the question: "Delete “Orders”?"), with the number of elements ("It has 12 elements") and the sentence "You can take this back for a short while after." Its buttons are **Cancel**, where the focus starts, because
  the safe act is the first one that a key reaches, and **Delete canvas**, drawn as a danger. Escape and the backdrop cancel.
- Then the library waits for the editor to finish writing (ADR-0072), puts a tombstone, closes its tab if it was open, and the toast says "Deleted “Orders”." with Undo. **Undo** restores the tombstone (`restore`), puts the tab back where it was if it was open, and says "“Orders” is back." The canvas is **not** opened by the Undo: the learner is where they were.
- A canvas that cannot be read is deleted the same way (ADR-0073), and its toast says so by the name or the id.
- If the delete itself fails (the browser refused), nothing has changed, the home says so with the cause, assertively, and no toast is made.

### Clear

- **The command is `clear`, and the button is the same command.** With the flag on, the top bar has **Clear** in the group "Edit", named "Clear canvas", that applies `clear` through the bus with the origin `toolbar`; typing `clear` in the command bar does the same with its origin. There is no confirmation: the canvas is one step of Undo from being whole, and a
  confirmation before an act that can be taken back is a step the learner pays every time.
- **It never does nothing silently.** On a canvas that has no elements, the bus has nothing to apply, and the button says "The canvas is already empty." on the status line and aloud.
- **A toast follows any `clear`** that was applied, whichever way it was asked for: "Cleared the canvas." with **Undo**, true while the document is the one that the clear left. Its Undo is the editor's Undo, so the history has one step for it, as the log of equivalent commands has one line (`clear`).

### Delete all

- **The button is on the home, and it is there only when there is something to delete** (a canvas, readable or not). It opens a dialog (`role="alertdialog"`): "Delete all 7 canvases?", what it does ("This deletes every canvas in this browser: 5 that can be opened, and 2 that this version of the app cannot open, which a backup cannot hold."), what can be done about it
  ("Export a backup first, or take it back with Undo for a short while after."), and three buttons: **Export a backup first**, **Cancel** (the focus starts here), and **Delete all 7 canvases** (a danger).
- **"Export a backup first" is a button, not a checkbox and not a step.** It saves the file (ADR-0075), and the dialog then says in a status line what was saved ("Backed up 5 canvases to rmq-playground-backup-2026-10-08.json.") and what was left out; it does not close the dialog or delete anything. A checkbox that promised a backup, and a delete that did it and then went on, would hide
  the file that the learner is asked to look after, and would delete if the backup failed. The button can be used twice; it says what it did each time.
- **Delete runs `softDeleteAll`, closes every tab, shows the home**, and a toast says "Deleted all 7 canvases." with **Undo**, which runs `restoreAll` with the ids that the delete gave, puts the tabs back, and says how many came back ("7 canvases are back.", or "5 of 7 are back: 2 were deleted for good" when some tombstones were purged meanwhile, the case that `restoreAll` was made to say).
- **The editor that was shown is gone, and its work is written first** (ADR-0072), so an Undo brings back the last thing the learner did.

### Where the focus goes (ADR-0073)

When a dialog closes the focus goes back to the button that opened it, unless that button is gone (a deleted card); then it goes to the next card's **Open**, or to the search field. After **Cancel**, or Escape, it is on the button that opened the dialog. The CDK restores the focus; the workspace chooses the other cases.

## Consequences

### Positive

- Nothing that a learner does here is final for at least 30 seconds, and every act that is not final says what it did aloud, on the page and in the words of the thing it did it to.
- The Undo of a toast is never a button that lies: it goes when it cannot work, or when it fails it says so.
- The same toast serves the next slices: a "Save a copy" in S10 and an imported backup in this one can use it without a new component.
- One confirmation for an act that is not the learner's work (delete one) and one more for the act that is all of it (delete all), and none for the act that is one step of Undo (clear): what is asked is in proportion to what can be lost.

### Negative / trade-offs

- A learner who deletes a canvas and closes the tab within 60 seconds leaves a tombstone that is purged at the next start (ADR-0028). It is not restorable from a later visit. It is what ADR-0028 chose ("the tombstone backs a toast, and is not a bin").
- Ctrl+Z on the home takes back a delete, and in the editor it takes back a change of the document: the same key in two places, with two meanings. The key is announced with each toast, and the meaning is in what the learner is looking at.
- A toast that waits for 30 seconds is a thing on the screen that was not asked for. It is small, it can be dismissed, and it is the price of an Undo that needs no mode.
- "Clear" next to "Auto-layout" is one click from emptying the canvas. The toast and the history are the answer; if a learner clears it by mistake, the Undo is in the same place.

## Alternatives considered

- **Delete at once, with the toast, and no dialog.** It is the lighter design, and the better one for most acts. Rejected here only because ADR-0012 says that delete "asks for confirmation", and an accepted decision is changed by a new ADR with a reason; the reason is not there, since the toast is as good a safety net as it is for a clear. It is a one-line change if the product owner prefers it.
- **A confirmation before a clear.** Rejected: see above.
- **The toast as a live region.** Rejected: it would be said twice, once by the region and once by the announcer, which the app already uses for everything else it says (ADR-0031).
- **A longer or no time**, for an Undo that stays until it is dismissed. Rejected: the tombstone does not live that long, and an Undo that is on the screen after the canvas is gone is the lie the toast must not tell.
- **A checkbox "Export a backup first" in the delete-all dialog.** Rejected, see above.
- **A "recently deleted" screen.** Rejected for M1 (ADR-0028 names it as the reason to change the 60 seconds if it is ever wanted).

## Related

- [ADR-0012](0012-multiple-canvases-and-local-persistence.md), [ADR-0025](0025-the-command-grammar.md), [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md), [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md), [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md).
- [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md), [ADR-0073](0073-the-home-is-a-grid-of-cards-from-one-read-and-a-canvas-that-cannot-be-read-is-listed-with-its-reason.md),
  [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md).

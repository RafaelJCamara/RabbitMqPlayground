# ADR-0099: Every notice lasts 5 seconds, and the keys of an Undo outlive its notice for 50 seconds from when it was shown

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** @RafaelJCamara
- **Supersedes:** the sentence "It lasts 30 seconds" of [ADR-0074](0074-delete-clear-and-delete-all-ask-once-and-can-be-taken-back-with-an-undo-that-says-how-long-it-lasts.md), and its rejected "A longer or no time" in what it says of a longer wait. The rest of ADR-0074 stands: the pause while the pointer or the focus is on a notice, Dismiss, Escape, and the notice that goes when its action cannot be true any more.
  It is built on [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md) (a tombstone lives 60 seconds) and [ADR-0097](0097-the-notices-float-at-the-bottom-right-and-every-screen-leaves-room-for-them-or-keeps-clear-of-them.md) (where the notices are).

## Context

- A notice waited 30 seconds, and a learner who deleted a canvas, a template, or cleared one saw a card at the corner of the page for half a minute that they had not asked for. The request: a notice should stay for **5 seconds at most, the same for every notice**.
- The 30 seconds had a reason (ADR-0074): the Undo of a delete is only offered while the canvas can be brought back, and the notice that holds the button is the way the learner learns that they can. Cutting the time to 5 seconds would also cut the keys: Ctrl+Z on the home takes back the newest notice's Undo (ADR-0074), and with the notice gone the keys would find nothing, though the canvas is in the tombstone for 55 seconds more.
- WCAG 2.2.1 (timing adjustable) is met by what ADR-0074 already has: the time stops while the pointer or the focus is on the notice, the notice has a Dismiss button, and everything that it says is also said aloud when it is shown.

## Decision

- **One time for every notice: `TOAST_TTL_MS` is 5,000.** Delete, delete all, clear a canvas, a file that was saved, a backup, and a template that was opened: they all wait 5 seconds. There is still one token, and a spec provides its own. The `e2e` build only (never the deployed one) reads `window.__rmqToastMs`, so that a browser test of three notices at once, or of an axe scan, can make them wait ten minutes (`e2e/support/hold-notices.ts`); a test of the 5 seconds themselves moves the clock by hand.
- **Pause and resume stay as they were.** The pointer or the focus on a notice stops its time, and when both have left it waits 5 seconds again (not what was left). Dismiss and Escape stay.
- **The keys of an Undo outlive its notice, for 50 seconds from when the notice was shown.**
  - `Toasts` keeps the action of a notice that **left by its time**, or that was **pushed off the screen by a fourth one** (the learner did not close it), for `UNDO_KEEP_MS` (50,000) counted from when it was shown, whatever the pointer or the focus did to its time on the screen. 50 is inside the 60 seconds that a tombstone lives (ADR-0028), so the canvas is still there.
  - A notice closed with **Dismiss** and a notice whose action worked keep nothing: the learner closed it. A kept action whose `stillTrue` is false is not offered to the keys (it is asked each time the keys are pressed, so it can come back with the condition).
  - `latestUndo()` answers the newest notice on the screen that has an action and is true; if there is none, the newest kept one that is still true.
  - When a kept action runs with no notice on the screen, its result is said aloud, since nothing else would say it: "Undone: Deleted “Orders”." politely when it worked, and the reason, assertively, when it did not (the action is then kept for another try, as the notice would have stayed).
  - Only the home hears Ctrl+Z for this (ADR-0074). In the editor the same keys are the document's Undo, through the bus, and are not touched.

## Consequences

### Positive

- A notice is a short thing on the screen, and the Undo is not lost with it: a learner who looks away for 6 seconds can still press Ctrl+Z.
- One constant, one rule, for every notice.

### Negative / trade-offs

- Five seconds is short for a long message to be read. The notice is said aloud when it is shown, it stops while the pointer or the focus is on it, and a person who needs more has those, but a notice with a long sentence may be gone before it is read once. `OPEN_QUESTIONS.md` has it.
- An Undo that is on a button for 5 seconds and on the keys for 50 is not seen: a learner who does not know the keys has only the 5 seconds. The notice says "Press Ctrl+Z to undo" in the announcement only.
- A second timer for each notice that has an action (the 50 seconds) and a small list of what is kept.

## Alternatives considered

- **Keep 30 seconds for notices that have an Undo and 5 for the others.** The request is one time for all of them.
- **Cut to 5 seconds and drop the keys with the notice.** Simple, and a delete would be final after 5 seconds in practice, with a tombstone that is there for 55 more.
- **Keep the notice's Undo as a button somewhere else** (a "Recently deleted" list). A second place to find; the tombstones are not shown anywhere today (ADR-0028), and that is a larger decision.

## Related

- [ADR-0074](0074-delete-clear-and-delete-all-ask-once-and-can-be-taken-back-with-an-undo-that-says-how-long-it-lasts.md), [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md), [ADR-0097](0097-the-notices-float-at-the-bottom-right-and-every-screen-leaves-room-for-them-or-keeps-clear-of-them.md), [docs/accessibility.md](../accessibility.md).
- Tests: `projects/app/src/app/core/ui/toasts.spec.ts`, `toast-host.spec.ts`, `projects/app/src/app/canvases/home.spec.ts`, `e2e/canvases-delete.spec.ts`.

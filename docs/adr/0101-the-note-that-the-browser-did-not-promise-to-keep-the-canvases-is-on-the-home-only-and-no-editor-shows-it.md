# ADR-0101: The note that the browser did not promise to keep the canvases is on the home only, and no editor shows it

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** @RafaelJCamara
- **Supersedes:** the parts of [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md) that make the session read the promise and say it in the editor ("the session and the home both read what it has"), and the sentence "If it is refused, the learner is told to make a backup" in "persist() is asked once" of [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md), which it extends for the editor. The rest of both stands: the promise is asked for once per page, after the first save that worked or when the home is first read, and the warning about the room stays in the status strip.

## Context

- The learner was told "The browser did not promise to keep the canvases…" in the status strip of every editor, with a Dismiss button, and the sentence **came back with every canvas**: the dismiss was a flag in `CanvasSession` (`persistRead`), and a session lives as long as one editor. The workspace makes a new editor for each canvas that is opened (ADR-0072), so each canvas asked the page again and each said it again. A learner who opened five canvases dismissed the same note five times.
- The home already says it once, as one of its notices (ADR-0075), where a learner who has not promised themselves a backup will read it. The request was that "having it in the main page is enough".

## Decision

- **The editor does not show the note.** The `persistence` note and its Dismiss are removed from the status strip (`StatusBar`), and the effect of the editor that said the note aloud is removed. `CanvasSession.persistence`, `persistRead` and `dismissPersistence` are removed. The warning about the room (`quota`) stays in the status strip, with its announcement, because it is a fact about what is about to go wrong with the work in front of the learner.
- **Asking stays as it was.** `CanvasStorage` (a service of the page) asks the browser once per page, after the first save that worked (`CanvasSession.afterSave` calls `askPersistence`) or when the home is first shown (ADR-0075). Only where the answer is **shown** changes: the home's `persistence-note` (`HomeNotices`) is as it was.
- **The cause is recorded so that it does not come back**: a thing that is about the page (the browser, the promise) belongs to a service of the page (`CanvasStorage`, in the root), and a flag about "has the learner read it" for the page must not live in a service that is made again for each canvas.

## Consequences

### Positive

- The note is said once, on the home, and the editors are not made noisy by a fact that is about the browser.
- The status strip has less in it, and the canvas is moved by it less (an old entry of `OPEN_QUESTIONS.md`: the note took 66 pixels about 300 ms after the first change).

### Negative / trade-offs

- A learner who goes straight to an editor from a link (a shared canvas is not saved, ADR-0078) or never visits the home does not read it. The status strip's warning about the room and the save state ("Not kept after you close this tab.", ADR-0072) still say the important thing when the browser keeps nothing.
- The home's note is not dismissible and has no memory between visits, as before.

## Alternatives considered

- **Keep the note in the editor, and make the dismiss a flag of the page** (`CanvasStorage`). It would show once per page in whichever screen came first; the request was for the home only.
- **Remember the dismiss between visits.** It is about the learner's data and should come back until the browser agrees (an old entry of `OPEN_QUESTIONS.md`).

## Related

- [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md), [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md), [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md), [docs/accessibility.md](../accessibility.md).
- Tests: `projects/app/src/app/core/session/canvas-session.spec.ts`, `projects/app/src/app/editor/editor.spec.ts`, `e2e/storage.spec.ts` ("the note about the browser that would not promise to keep the canvases"), `e2e/canvases-a11y.spec.ts` ("in the editor, with the warning that the room is nearly gone").

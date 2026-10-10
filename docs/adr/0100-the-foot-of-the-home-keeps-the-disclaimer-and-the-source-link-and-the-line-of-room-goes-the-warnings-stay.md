# ADR-0100: The foot of the home keeps the disclaimer and the link to the source, and the line of room goes; the warnings stay

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** @RafaelJCamara
- **Supersedes:** the bullet "The links of the placeholder go with it" of [ADR-0087](0087-the-disclaimer-moves-from-the-placeholder-to-the-welcome-and-the-foot-of-the-home.md) (only "Source code" stays), and the quiet line about the room in "The promise and the room, on the home" of [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md) ("The canvases take 1.2 MB of the 2.1 GB that the browser allows."). The rest of both stands, and so do the warnings at 80% and 95% of the room.

## Context

- The foot of the home had the disclaimer and three links, "Source code", "Design decisions" and "Progress", which came from the placeholder page (ADR-0087). A learner who is there to use the app does not need a link to the decision records or to the progress issue, and the request was to take them off.
- The home said under its actions how much room the canvases take, in every state where the room was not running out: "The canvases take 127 KB of the 2 GB that the browser allows." It is a number that a learner cannot act on, and it stays on the page all day. The request was to remove it, because "the existing alert is enough".

## Decision

- **The foot has the disclaimer (`APP_DISCLAIMER`) and one link, "Source code".** "Design decisions" and "Progress" are removed. "Source code" was not named in the request, and it is where a person who wonders about the product goes, so it stays. `data-testid="home-footer"` and the disclaimer are as ADR-0087 has them.
- **The line of room goes**: `data-testid="usage"` and the sentence are removed from the home. `quotaWarning` no longer writes a sentence for the case with room: it answers `{ level: 'ok' }` (the type `QuotaFine`), and a warning (`low` or `critical`) still carries its words. `formatBytes` stays, because the warnings use it. `CanvasLibrary.usage` is removed, since nothing reads the numbers now except the library itself, for the warning.
- **The warnings stay**, as the "existing alert": at 80% of the room (`low`) and at 95% (`critical`), on the home, and in the status bar of the editor. They are in words and in a colour, and the colour is not the only sign (WCAG 1.4.1).

## Consequences

### Positive

- The foot is the one sentence that the product owes (ADR-0087) and one link. The home says nothing of the room until it matters.

### Negative / trade-offs

- A learner cannot see how much of the browser's room the canvases take until it is running out. A learner who wants it opens the browser's own storage view.
- A link to the decision records is not on the home. The README and the source carry it.

## Alternatives considered

- **Keep the line, make it smaller.** The request is to remove it.
- **Move it to a place of its own** (a "Storage" row in a menu). A new place for a number that nobody acts on.
- **Remove all three links.** "Source code" was not named in the request, and removing the only way to the source from the product is not asked for.

## Related

- [ADR-0087](0087-the-disclaimer-moves-from-the-placeholder-to-the-welcome-and-the-foot-of-the-home.md), [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md), [docs/accessibility.md](../accessibility.md).
- Tests: `projects/app/src/app/canvases/home.spec.ts`, `home-notices.spec.ts`, `projects/persistence/src/lib/storage-manager.spec.ts`, `e2e/canvases-files.spec.ts`, `e2e/canvases-a11y.spec.ts` ("on the home, scrolled to its foot: the disclaimer and the link to the source", "on the home, with the reminder to make a backup").

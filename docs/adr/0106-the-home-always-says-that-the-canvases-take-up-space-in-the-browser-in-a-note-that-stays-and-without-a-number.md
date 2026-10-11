# ADR-0106: The home always says that the canvases take up space in the browser, in a note that stays and without a number

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** @RafaelJCamara
- **Refines:** "The home says nothing of the room until it matters" of [ADR-0100](0100-the-foot-of-the-home-keeps-the-disclaimer-and-the-source-link-and-the-line-of-room-goes-the-warnings-stay.md). The line with the numbers stays removed, and the warnings at 80% and 95% stand.

## Context

- After ADR-0100 the home said nothing about the room the canvases take until the browser was 80% full. A learner could not know, before that, that the canvases are kept in the browser's own storage and use space on the device.
- The request: the product must warn that the canvases occupy that space, in one central place, and **not as a notification** (a notice leaves after 5 seconds, ADR-0099).

## Decision

- **`HomeNotices` shows one note, `data-testid="space-note"`, whenever the canvases are kept in the browser** (that is, when there is no `memoryReason`): "**Your canvases take up space in this browser.** They are stored on this device, so delete the ones you do not need, or save them as files and back up everything."
- **It is part of the page, not a notice**: it has no timer, no Dismiss, and no `role="alert"`, and it is not announced. It is in the neutral colours of the home's other plain notes, since it is a fact and not a fault.
- **It has no number.** ADR-0100's reasons stand (a learner cannot act on it, and it changes all day). The warnings at 80% and 95% still carry their figures.
- **It is not shown when the library is in memory.** There the note that nothing is kept after the tab is closed (ADR-0075) is the truer one, and the two would contradict each other.
- **Only on the home.** The editor's status bar keeps its warning at 80% and 95% and nothing else.

## Consequences

### Positive

- The fact is always where the learner manages the canvases, and the words say what to do about it.

### Negative / trade-offs

- A sentence that is always there is easy to stop seeing.
- A learner with no canvas yet reads it before there is anything to take room.

## Alternatives considered

- **Bring back the line with the numbers.** It reverses ADR-0100, and the numbers were the part that nobody could act on.
- **Put it in the foot beside the disclaimer.** Quieter, but out of sight on a long home.
- **Also in the editor.** The editor's status bar is for what the learner is doing; the warnings reach it when they matter.

## Related

- [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md), [ADR-0099](0099-every-notice-lasts-5-seconds-and-the-keys-of-an-undo-outlive-its-notice-for-50-seconds-from-when-it-was-shown.md), [ADR-0100](0100-the-foot-of-the-home-keeps-the-disclaimer-and-the-source-link-and-the-line-of-room-goes-the-warnings-stay.md).
- Tests: `projects/app/src/app/canvases/home-notices.spec.ts`, `e2e/canvases-files.spec.ts`.

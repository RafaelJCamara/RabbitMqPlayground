# ADR-0110: The notes of the home can be closed, and stay closed in that browser

- **Status:** Accepted
- **Date:** 2026-10-20
- **Deciders:** @RafaelJCamara
- **Refines:** "It is part of the page, not a notice: it has no timer, no Dismiss" of [ADR-0106](0106-the-home-always-says-that-the-canvases-take-up-space-in-the-browser-in-a-note-that-stays-and-without-a-number.md). The note still has no timer and is still not announced, but the learner can close it. The same holds for the other notes of the home that say how the canvases are kept ([ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md), [ADR-0101](0101-the-note-that-the-browser-did-not-promise-to-keep-the-canvases-is-on-the-home-only-and-no-editor-shows-it.md)).

## Context

- Above the search, the home of My canvases can show up to five notes: that nothing is kept after the tab is closed (`memory-note`), that the canvases take up space in the browser (`space-note`, ADR-0106), that the room is running out (`quota`), that the browser did not promise to keep the canvases (`persistence-note`), and the reminder to make a backup (`reminder`).
- Only the reminder could be put away ("Remind me in a week"). The others stayed for good, so a learner who had read them saw them on every visit, above the canvases.
- The request: the notes on the home, "the canvases taking space and the browser doesn't promise to keep", should have an X that closes them. The maintainer chose that a closed note stays closed until the browser's data for the site is cleared, and not only for the visit.

## Decision

- **`memory-note`, `space-note`, `quota` and `persistence-note` each have a close button**: an icon (`close`) in the shared `BUTTON` style, at least 24 by 24 pixels (ADR-0085), with a name in words that says which note it closes ("Close the note that the canvases take up space", "Close the warning about the room", and so on), and `data-testid="<note>-close"`.
- **The reminder has none.** "Remind me in a week" is how it is put away, and a reminder that could be closed for good would never remind.
- **A closed note stays closed.** `CanvasLibrary.dismissNote` keeps the note in the repository's meta value `dismissedNotes`, a list of the notes of the home, each once (`HOME_NOTES` in `@rmq/persistence`). The home reads it with the other facts of the home, and a note closed while that read is on its way stays closed. When the canvases are in memory, the repository is in memory too, so a closed note comes back in the next tab, which is as long as anything there is kept.
- **Closing a warning never hides a worse one.** A note is closed by a key that says what it says: the room running low (`quota:low`) and running out (`quota:critical`) are two notes, and each answer of the browser that did not promise (`persistence:unsupported`, `persistence:denied`, `persistence:failed`) is one. A learner who closed the warning at 80% still sees the one at 95%.
- **Nothing opens a closed note again but clearing the site's data.** There is no "show the notes again" control.
- **After a close, the focus goes to the search**, or, when there is no canvas to search, to the button that makes one, since the button that had it is gone; and "Note closed." is said politely.
- The value is checked like the other meta values (ADR-0028): a list with a note that is not one of `HOME_NOTES`, or with one twice, is refused when written and read as not there, which is what a value of a later version looks like.

## Consequences

### Positive

- The home shows what the learner has not read yet; what they have read can be put away.
- A worse state still shows up: the warnings that matter most cannot be hidden by an old click.
- One meta value, checked like the others, and no change to the canvases or their files.

### Negative / trade-offs

- A learner who closed the note that the canvases take up space is not told it again in that browser, though the fact stands. ADR-0106 wanted it said always; this trades that for a page that the learner controls.
- The only way to see a closed note again is to clear the site's data, which also deletes the canvases. A learner who wants a note back has to wait for another browser or another device.
- The editor's status bar still says the warnings at 80% and 95% (ADR-0100); closing them on the home does not quiet the editor.

## Alternatives considered

- **Close for the visit only.** Simpler, but the notes would be back on every visit, which is what the request was about.
- **A "Show the notes again" link in the foot.** One more control for a rare need; left out unless it is asked for.
- **Let the reminder be closed for good too.** It would never remind again, and a learner who wants it quiet for a while already has "Remind me in a week".
- **One key per note, whatever it says.** Closing the warning at 80% would hide the one at 95%.

## Related

- [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md), [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md), [ADR-0085](0085-targets-are-24-pixels-nothing-that-stays-is-drawn-over-the-canvas-and-every-screen-is-checked-in-both-themes-from-a-list.md), [ADR-0100](0100-the-foot-of-the-home-keeps-the-disclaimer-and-the-source-link-and-the-line-of-room-goes-the-warnings-stay.md), [ADR-0101](0101-the-note-that-the-browser-did-not-promise-to-keep-the-canvases-is-on-the-home-only-and-no-editor-shows-it.md), [ADR-0106](0106-the-home-always-says-that-the-canvases-take-up-space-in-the-browser-in-a-note-that-stays-and-without-a-number.md).
- Code: `web/projects/app/src/app/canvases/home-notices.ts`, `canvases/library.ts` (`dismissNote`, `dismissedNotes`), `canvases/home.ts` (`focusAfterNote`), `web/projects/persistence/src/lib/repository/repository.ts` (`HOME_NOTES`, `dismissedNotes`).
- Tests: `canvases/home-notices.spec.ts`, `canvases/library.spec.ts`, `canvases/home.spec.ts`, `persistence/src/lib/repository/repository.contract.spec.ts`, `e2e/canvases-files.spec.ts`.

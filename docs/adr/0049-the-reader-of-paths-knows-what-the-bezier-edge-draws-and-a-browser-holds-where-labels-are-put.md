# ADR-0049: The reader of paths knows what the bezier edge draws, and a browser holds where the labels are put

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md) (the path that the library drew is read, and the labels are placed from it and dragged along it),
  [ADR-0043](0043-the-default-exchange-is-shown-on-request-and-is-not-in-the-document.md) (what the default exchange does not take) and
  [ADR-0036](0036-the-test-strategy-of-the-editor.md) (what each tier of tests is for), for what the mutation checks of S5
  ([#7](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/7), [`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md) section 7) showed about the labels.

## Context

ADR-0044 says that the path of an edge is read from the `d` that the library draws, cut into short straight pieces, so that a label can be put at a fraction of its length and found again from a point. The reader was written
for `M`, `L`, `C` and `Q`. The sweeps of the code and of the adapter, which change one thing at a time and ask whether a test notices, showed three things. The `Q` is for the `segment` type of edge, which draws a rounded
bend, and the app draws the `bezier` type, whose path is one `M` and some `C`, so nothing could reach that branch, and no test read its numbers. Two guards of the function that finds the point at a fraction cannot be met by a line that has a length.
And the greedy placement, the drag of a label, the card that a press takes away, the dashes of what is not a binding and each way that the default exchange is left alone were held by unit specs of the pure parts, and by no journey in a browser: 19 of the 42 hand changes
of the adapter passed every test that existed.

## Decision

- **The reader knows `M`, `L` and `C`**, which is what the `bezier` type draws (and what a straight edge would). A path that goes on with a command that it does not read is read as far as that command, as it was. `Q` is not read, and a spec says so. A slice that
  changes the type of the edges has to teach the reader the command that the new type draws, and that spec fails until it does.
- **A point at a fraction is the start for a fraction that is nothing or less, the end for one that is all or more, and by the pieces for the rest.** A line that has no length is its one point. The rest cannot land on a piece that has no length, so there is no case for one.
- **A journey in the browser holds what the adapter does with a label and with what is not the document's.** Two edges that cross at the middle of each have labels that do not meet; a label follows the pointer along its edge while the pointer is down, is kept a twentieth from each end, is put
  back when the browser cancels the drag, is not dragged by a button that is not the main one or by a press that moves less than three pixels, is dragged by a finger without panning the canvas and without the card opening for a moment, and a press takes the card away. The default exchange
  and its implicit bindings leave the right click to the browser, have no menu from the menu key, are not renamed by a double click, are not moved, and their labels stay where they are. The dashes of a link to a queue, of an implicit binding and of the node of the default exchange are
  read from the page.
- **A pointer that enters a label does not ask whether a press is on.** A label that is pressed captures its pointer, so that pointer enters no other label, and the guard of `onLabelEnter` for it could not be reached by anything that a test can make, so it is gone. The guards that say
  whether a move, a release or a cancel is of the pointer that pressed stay, because a second finger can be on the canvas while the first is on a label, and no test can make that second pointer reach the label.
- **What is left without a test, on purpose.** The 120 milliseconds that the labels wait before they are placed, which keep a label from jumping while a node is dragged: no state at the end can show that it jumped. The placing again when the geometry changes: the document changing places the
  labels again, and the geometry only matters when the library draws the paths a moment after the document, later than the wait, and either way the labels end up placed. The input of the default exchange being disabled, which the list of the targets that the rules allow already leaves out.
  They stay as what a person who reads the adapter needs to see.

## Consequences

### Positive

- The code that reads paths is the code that the app can reach, and a change of the type of the edges is caught where it matters, in the reader, and not in a label that is put in the wrong place.
- The greedy placement, which had been the one feature of S5 with no journey, has one, and so has each guard of the adapter that a unit spec cannot reach.

### Negative / trade-offs

- A slice that wants a rounded bend has a small job to do first, and a spec to change. That is the point, and it is also a cost.
- Thirteen more journeys, which take a few seconds together on a machine that runs them in parallel, and are written to wait for the canvas to be still, so that they hold on a processor six times slower.

## Alternatives considered

- **Keep `Q`, for completeness.** Rejected: code that nothing can reach is read by nobody, and a type of edge that needs it needs it with a test of its own, from the person who changes the type.
- **Measure the paths in the page** (`getPointAtLength`), which reads every command. Rejected in ADR-0044 and still: the places of the labels are a pure function that a unit test reaches, and the browser's measure is only available in a page.
- **Test the wait before the labels are placed with a clock that the page can be told.** Not done: it needs a hook in the app for the tests alone, for a thing that is a nicety of the screen.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md), [ADR-0034](0034-the-foblex-contract-suite-and-how-an-upgrade-fails-loudly.md),
  [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md), [ADR-0048](0048-what-building-s5-settled-ctrl-k-in-a-field-a-bar-that-keeps-its-draft-a-top-bar-that-fits-and-tests-that-wait.md).

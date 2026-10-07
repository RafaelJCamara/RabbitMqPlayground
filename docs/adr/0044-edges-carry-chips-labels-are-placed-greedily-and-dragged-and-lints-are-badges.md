# ADR-0044: Edges carry chips, labels are placed greedily and can be dragged, and lints are badges

- **Status:** Accepted. The reader of the paths, and the journeys that hold where the labels are put, are settled by [ADR-0049](0049-the-reader-of-paths-knows-what-the-bezier-edge-draws-and-a-browser-holds-where-labels-are-put.md). A label carries the short reason of a binding that missed when Why? is on, by [ADR-0062](0062-why-is-painted-by-the-adapter-with-classes-from-an-emphasis-and-the-reasons-are-words-on-the-labels.md). The chip of a headers binding says its mode and its first conditions, by [ADR-0070](0070-a-binding-is-made-from-a-message-by-ticking-its-headers-the-live-table-is-the-explanation-of-the-draft-and-a-chip-says-the-mode-and-the-first-conditions.md), and the bindings of a headers edge are edited as [ADR-0066](0066-a-headers-binding-is-made-in-a-popover-and-edited-in-the-inspector-from-one-draft-and-an-edit-is-one-batch.md) says.
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** "Editing" and "Readable labels" of [ADR-0010](0010-explanation-first-editor-ux.md) (labels that avoid overlapping, can be dragged, and are chips with the full text on hover; lints as
  badges), the edges of [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md) ("binding keys on an edge, as chips, are S5's") and the adapter of
  [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md), for what S5 ([#7](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/7)) draws on edges and nodes.

## Context

The document keeps where a label sits along its edge (`layout.labels`, 0 at the start and 1 at the end) and the command `move label` sets it, and `lint()` has two lints. Nothing draws either. A label has to say what an edge carries
in few words, stay readable when many edges meet, be movable without a drag (WCAG 2.5.7), and not cost the app a layer of its own that has to follow the pan, the zoom and a node that is being dragged.

## Decision

### What an edge says

- **A chip for each thing that the edge carries, in the order they were made, and the same text once.** For bindings that is the key of each: `order.*`, and `(empty key)` for an empty one that matters (a direct or a topic exchange), nothing for an empty
  key of a fanout or a headers exchange, which ignores it. A binding with header arguments is a chip `headers` (S8 gives it its conditions). A producer linked to a queue says `default exchange`, or the queue's name once the default exchange is drawn
  ([ADR-0043](0043-the-default-exchange-is-shown-on-request-and-is-not-in-the-document.md)). A subscription and a link to an exchange carry no chip.
- **Three chips at most, then "+N more".** The chips are one stack at one place on the edge, with the text cut with an ellipsis at a width, and the whole text in the card.
- **The card is the full list, on hover.** The adapter reports that a pointer is over a label, and where (an intent, `peek`), and the editor shows the list in a card of its own, over the canvas and over its nodes, which a card drawn inside the edge could not be.
  The card stays while the pointer is over the chips or over it (a short grace between them), and goes on Escape and when the pointer leaves (WCAG 1.4.13). It is for a mouse and a pen: touch has no hover and a keyboard has the inspector, which
  lists every binding of the selected edge. The chips are hidden from a screen reader, because the label of the edge says the same, with every key.
- **Lints are badges.** A node that has a lint (an exchange that nothing is bound from) has a small badge with the warning icon at its corner, and a binding that has one (`x-match=any` with no condition that counts) has it on its label. The message of the lint, which says the
  root cause and what to do, is in the inspector when the node or the edge is selected, and the label of the node says "1 warning". A lint never stops a command.

### Where a label is

- **It is the library's connection content, inside the connection** (`fConnectionContent`), so that it moves with the edge while a node is being dragged, and with the pan and the zoom, with nothing of ours following them. Its `position` is the fraction of the path
  that was drawn, by length, which the contract suite pins (about a pixel off over a long curve).
- **A label that has a place in the document is there. The others are placed greedily.** The app works out a place for each label from the path that the library drew (`d`, read when the geometry has settled, and then again a moment after it changes, and never in the middle of
  a drag): the labels that have a place are put down first, as things to avoid, and then each of the others in the order of the edges takes the first of 0.5, 0.4, 0.6, 0.3, 0.7, 0.2 and 0.8 where its box (a size worked out from the text) meets no label that is there and no node,
  or, if there is none, the one where it overlaps least. It is a pure function of the paths, the boxes and the nodes, with no solver, and the same input gives the same places. The places that it finds are never written: the document keeps only what a learner chose.
- **A label can be dragged along its edge.** A press on the chips stops the library's own start of a drag (it would pan the canvas), a move of three pixels starts one, the nearest point of the drawn path to the pointer gives the fraction (kept between 0.05 and 0.95, so that a label
  never sits on a handle), and letting go makes one `move label`, which is one step of undo with the line `move label orders -> billing at=0.25`. A press that does not move selects the edge, which the library would have done.
- **Without a drag** (WCAG 2.5.7) the inspector has a field for the place of the label of the selected edge, and the command bar has `move label`.

### Editing and deleting what an edge is

- **Selecting an edge shows each thing that it carries in the inspector.** For bindings: each one with its key in a field (a change is `unbind` and `bind` as one batch), a button that deletes that binding (`unbind`), and a button that adds another between the same two ends
  (it asks for the key as ADR-0041 does), besides the button that deletes the edge, which unbinds all of them. For the link of a producer: "Change target…" (the picker) and delete (`unlink`). For a subscription: delete (`unsubscribe`).
  Every change is a command with an equivalent line, like any other.

## Consequences

### Positive

- The label moves with everything the library moves, and the only code that follows geometry is the greedy pass, which is a pure function.
- A learner who cannot drag, or cannot hover, has the inspector and the command bar for the same things.
- Several keys on one edge stay readable, and the full list is one hover or one selection away.

### Negative / trade-offs

- The pass needs the paths that the library has drawn, which it draws a moment after the elements appear ([ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md)), so a label is first drawn at the middle and moves when the pass has run. The pass is
  run again a moment after the last change of geometry, so a label does not jump while a node is being dragged, and moves when it is dropped.
- The size of a label is estimated from its text, and not measured, so a font that is wider than the estimate can overlap by a few pixels.
- The card is a second place that the text of a label is shown in, and a card that is not fed by the label of the edge would be a text that can differ. It is made from the same chips.
- The library places the content at a fraction of its own sampled polyline, so the fraction that the app works out and the place that the library draws can differ by a pixel or two.

## Alternatives considered

- **Draw the labels in an overlay of our own.** Rejected: it would have to follow the pan, the zoom and a dragged node on every frame, which is what S6's overlay has to do for the messages and what the library already does for its own content.
- **A card drawn inside the connection**, with CSS. Rejected: the connections are under the nodes, so a list that is longer than the label is covered by the node below it.
- **A global solver for the places of the labels.** Rejected by the plan (timeboxes): greedy placement and a drag are enough, and a solver is a project.
- **Measure the chips and place them from the real sizes.** Not done: it needs a second pass after the first paint, and the estimate is good enough for the three-chip stack.
- **Tooltips from the `title` attribute.** Rejected: a delay that the author cannot set, no list, and nothing for a keyboard.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md), [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md),
  [ADR-0041](0041-the-five-ways-to-link-share-one-path-and-a-binding-asks-for-its-key-first.md).
- [ADR-0009](0009-headers-exchange-support.md): the lint for `x-match=any`.
- [WCAG 1.4.13 Content on Hover or Focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html) and [2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html).

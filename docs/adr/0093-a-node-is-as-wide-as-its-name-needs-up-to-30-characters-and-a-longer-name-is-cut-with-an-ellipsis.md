# ADR-0093: A node is as wide as its name needs up to 30 characters, and a longer name is cut with an ellipsis

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md) (the size of a node and its outline) and [ADR-0011](0011-explicit-linking-and-command-layer.md) (the auto-layout leaves room for the nodes).

## Context

- Until now a node had the size of its kind (`NODE_SIZE`: a producer and a consumer 140 by 56, an exchange and a queue 160 by 56) whatever it was called. The style cut a name that did not fit at the edge of the node with an ellipsis, and the room for the name was 72 or 92 pixels once the icon and the padding were taken off. A name such as `orders-events-eu-west` was cut on the canvas, and a learner who names things as a team does (`payments.retries.dead-letter`) could not read two nodes apart.
- A name is at most 255 bytes (ADR-0021), so a node cannot be as wide as any name. Something has to be cut, and the question is where.
- The size of a node was a constant of its kind, and four places depended on that: the auto-layout of the domain (it leaves room for the nodes), the view model of the canvas (which gives the library the size and the outline), the places where a popover or a reveal is put at the node (they need its box), and the thumbnail of a canvas on the home.

## Decision

- **A node is as wide as its name needs, up to 30 characters.** `nodeSize(kind, name)` in the domain is the size of the kind, or wider where the name needs the room: `68 + 8 × n` canvas units for `n` characters, where 68 is what the node spends on its own (the padding, the icon and the gap) and 8 is the width given to a character of the semibold 14 pixels of the canvas. The height is the height of the kind. A short name keeps the size of its kind, so the canvases and the layouts that exist look as they did.
- **A name of 30 characters or fewer is drawn whole. A longer name is drawn as its first 29 characters and an ellipsis**, which is 30 characters in all (`displayName`, the `shorten` of the explanations with 30). Characters are counted as code points, so that a pair is never cut in half. A node of any name of 30 or more characters is 308 units wide, and the node of a name of 31 characters is the node of a name of 30.
- **The whole name is never lost.** The label of the node that a screen reader says (`Queue <the whole name>`), the inspector, the log and the command language have the whole name, and a node that is cut has the whole name as its tooltip. `NodeVm` has both: `name` and `shownName`.
- **The size is found in one place and in the same way everywhere:** the auto-layout, the view model (width, height and outline), the places that anchor a popover or reveal a node, and the thumbnail all call `nodeSize` with the name. The outline is drawn at the width of the node (`shapePath(kind, { width, height })`), and the thumbnail draws each outline at its own width.
- **The width of a character is a guess, and the style is still the guard.** The domain cannot measure text, and a layout that depends on the fonts of the machine would not be the same on two machines. 8 is more than the 7 that Segoe UI takes at this size (a name of 30 ordinary characters measured 210 of the 240 that the node leaves), and about what Arial and its likes take, which were not measured. It is also the number at which a name of 9 characters, which is what `producer1` and `consumer1` are, is exactly as wide as the room that a producer and a consumer have, so a node that the toolbox adds has the size of its kind and nothing that exists moves. A name of wide capitals (`WWWW…`) is wider than the guess, and the style cuts it at the edge of the node with an ellipsis as before.
- **The default exchange** is drawn as `(default)`, which fits the width of its kind.

## Consequences

### Positive

- A name of up to 30 characters is read on the canvas, and no node is wider than 308 units, so a canvas of long names is still a diagram and not a wall.
- Nodes with short names are as they were, so no saved canvas, link or template moves.
- The auto-layout puts the columns at the same gap whatever the widths: the test that held it for the sample canvas is run again for a canvas of long names.

### Negative / trade-offs

- **The columns of a node that is added are still `COLUMN_X`**, 320 apart, and a node of 308 units that is added in a column and not arranged can touch the next column. A new node is named `queue1`, `producer2` (short), so this is reached by renaming or by the command line, and the button Auto-layout puts it right. Making the default places depend on the width of the neighbours would need the name at the time that the place is chosen, and was left.
- The width is an estimate. A font that is wider than the guess cuts a name that fits by count, with the ellipsis of the style, and a font that is narrower leaves room at the end of a name. The number can be changed in one place (`NODE_CHARACTER`), and the tests pin the widths that it gives.
- The visible text of a cut node is the start of its name followed by an ellipsis, so it is not contained in the accessible name as typed (WCAG 2.5.3). It is a prefix, which is how a cut text is read, and no machine checks the voice-control case ([docs/accessibility.md](../accessibility.md)).
- A label on an edge is placed between two nodes (ADR-0044, ADR-0071), and a wider node leaves a shorter line between two nodes that are a column gap apart. The placement of labels reads the boxes of the nodes from the view model, so it follows the new widths, and the chips are as wide as before.

## Alternatives considered

- **Measure the text in the browser and size the node to it.** It fits every font, but the auto-layout would depend on the machine, a shared link would be arranged one way for the sender and another for the reader, and the domain would need the DOM. Not chosen.
- **A node of one width, wide enough for 30 characters.** Simple, but every node would be 308 units wide, a canvas of `p1` and `q1` would be a row of wide empty boxes, and every saved canvas would change.
- **Wrap a long name on two lines.** The node would be taller, and the height is what the handles, the stats and the layout rows are made for. Not chosen.
- **Show 30 characters and then an ellipsis (31 in all).** The request was that the node fits the name until 30 characters and that after that the ellipsis is used. A name of 30 is whole, and one that is cut is 30 with the ellipsis counted, as every other cut text of the app is (`shorten`), so a node never shows more than 30.

## Related

- [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md), [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0021](0021-transient-queues-are-refused.md), [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md), [ADR-0073](0073-the-home-is-a-grid-of-cards-from-one-read-and-a-canvas-that-cannot-be-read-is-listed-with-its-reason.md).
- Tests: `projects/domain/src/lib/layout.spec.ts` (the size, the cut, the layout with long names), `projects/app/src/app/canvas/model/model.spec.ts`, `projects/app/src/app/canvases/thumbnail*.spec.ts`, `e2e/editor.spec.ts` · "journey 2: long names", `e2e/editor-a11y.spec.ts` · "with names that fill a node and a name that is cut".

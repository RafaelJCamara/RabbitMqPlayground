# ADR-0062: Why? is painted by the adapter, with classes from an emphasis, and the reasons are words on the labels

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "Route overlay (Why?)" of [ADR-0010](0010-explanation-first-editor-ux.md) (matches glow, misses dim with a short reason, click a queue to ask why not), the labels and chips of
  [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md), the adapter of [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md),
  the overlay of [ADR-0055](0055-the-overlay-draws-on-a-canvas-outside-change-detection-and-follows-the-real-paths.md) and the choice of a row of [ADR-0061](0061-the-event-log-is-a-ring-of-rows-that-puts-a-command-before-what-it-made-and-a-row-selects-what-it-explains.md),
  for what S7 ([#9](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/9)) shows on the canvas.

## Context

Three things want the canvas to show a path: a row of the log that is chosen, the Why? of a message, and the what-if tester. They show edges and nodes, and the Why? shows a short reason beside each binding that missed. The overlay of S6 paints what moves, on a canvas that takes no pointer and says nothing to a
screen reader. What is lit is not a message: it is a state of an edge and of a node that stays for as long as the learner is looking at it, follows a pan, a zoom and a dragged node, and has to be read by a test and by axe.

## Decision

### Who draws it

- **The adapter draws it, with classes.** It takes one more input, `emphasis`, a plain value from `core/explain/` (a mark for edges by their key and for nodes by their id, and a short reason for some edges), and puts a class on the library's connection and on the node that the mark says. The library draws the edge and the node
  as it always does, and the canvas follows the pan, the zoom and a drag with nothing of ours following it. Nothing of Foblex is used that was not used, so ADR-0016's rule is not touched. What the marks are made of is pure and in `core/explain/`, which the unit tier holds, and what the classes do is CSS and the browser's journeys.
- **The overlay of the messages is not used for it**, for the reasons that it was built as it was: it is a picture without text or state, and a glow on a node's own outline would have to be drawn again in a second place.

### What a mark is

- **An edge is `path`, `matched`, `missed` or `asked`.** `path` is where the message went: the producer's link, a binding that gave a queue its first copy or took it to an exchange that had not been reached, a subscription for a delivery. `matched` is a binding that matched and was not followed (the queue had its copy, the exchange had been visited).
  `missed` is a binding that was tried and did not match, which is dimmed and carries its short reason. `asked` is a binding that points at the queue that the learner is asking about, whatever came of it. Several bindings between the same two nodes are one edge, and the edge takes the strongest of their marks (`path`, `matched`, `missed`), with the short reason of the first that missed.
- **A node is `visited` (an exchange that the message reached), `reached` (a queue that got a copy), `missed` (a queue that did not) or `asked`.** Producers and consumers are `visited` where a row is about them.
- **A mark does not hide the selection.** A selected edge or node keeps its accent, and the mark is another look on the same element. A mark that is dimmed lowers the stroke and not the text, so that the words keep the contrast that axe holds them to.
- **The look is three tokens**, `--rmq-explain-hit`, `--rmq-explain-miss` and `--rmq-explain-asked`, each a pair for the light and the dark theme (ADR-0032) that `tools/theme/tokens.spec.ts` holds to 3:1 against the canvas, and each is paired with a shape that colour does not carry: a hit is thicker, a miss is lighter and has its reason as words, an asked node has a ring.

### Where the reasons are written

- **On the label of the edge, after its chips.** The label is the library's connection content (ADR-0044) and moves with the edge. A missed binding adds a chip with its short reason (at most 48 characters, and the word "no" or the mark ✗ in front, so that it is read as a miss and not as a key). An edge that has no label (a fanout with no key,
  a subscription) gets one for the reason, and so does a label that the app had not placed, at the middle of the edge. The placement of the greedy pass does not change: the reason is a line of the same chip stack, and the card, which shows the whole list on hover, shows it too.
- **The implicit bindings of the default exchange are dimmed and have no words.** A message that is published to a queue through the default exchange would otherwise write "the key is not …" on the edge of every other queue. The inspector has them, in the tree.
- **The label is still hidden from a screen reader** (ADR-0044), because the painting is decorative: the same words are text in the inspector's tree, which a screen reader reads when it is asked for, and the choice is said once, aloud, when it is made ("Showing why message 3 went to billing and audit").

### What is lit for what

| What is chosen | Edges | Nodes |
|---|---|---|
| a `published` row | the producer's link | the producer, and what it is linked to |
| a `routed` or `unroutable` row, the Why? of a message | every binding that was tried, with `path`, `matched` or `missed`, the producer's link, and the implicit bindings of the default exchange when it is shown | the exchanges that were reached, and every queue: `reached` or `missed` |
| a `refused` row | none | the exchange, when it is on the canvas |
| an `enqueued` or `dropped` row | the producer's link and the hops of the path to that queue | the exchanges on the way and the queue |
| a `delivered`, `received`, `processed`, `acked` or `requeued` row | the subscription of the queue to the consumer | the queue and the consumer |
| a `consumer.cancelled` or `channel.closed` row | the subscription, if it is still there | the consumer and the queue |
| a `queue.purged` or `queue.deleted` row | none | the queue, if it is still there |
| a command, `cleared`, `counters.reset` | none | none |
| the what-if tester | as the Why? of a message that would be published | as the Why? |
| a queue that is selected while a message is chosen | the bindings that point at it, `asked`, and, for a queue that did not get the message, the chain of bindings that stopped it, with their reasons | the queue, `asked` |

- **What is lit is worked out from the explanation of the message and the canvas as it is now.** The explanation is the one that the held document gives ([ADR-0061](0061-the-event-log-is-a-ring-of-rows-that-puts-a-command-before-what-it-made-and-a-row-selects-what-it-explains.md)), whose bindings are the canvas's by their index (`bindingIds`), and the edges and nodes are found by id, so that a rename keeps
  the mark and a delete drops it. A part of the path that has gone from the canvas is not lit, and the card says how many parts have gone.

### When it shows, and for how long

- **One thing is lit at a time**, by this order: the tester that is being typed into, a queue that is asked about, the row or the message that the learner chose, and, while the clock is stopped, the Why? of the last message that was routed. The learner's choice stays until another is chosen or it is let go (Escape in the log or the
  inspector, or the card's button), whether the clock runs or not. The Why? of the last message is for the learner who steps and publishes by hand: it follows each message as it is routed, is not offered while the clock runs, and is let go for the message that it shows by the button, and comes again for the next.
- **A card says what is lit**, over the canvas in its corner: "Why? Message 3, published to orders with key order.created: reached billing, audit", with a legend (lit means that it matched and dimmed that it did not), a button to open the message, and a button to let it go. It is a labelled group inside the canvas's region, its buttons are at least 24 pixels,
  and it is there only while something is lit.
- **The canvas that changes is followed**: the marks are worked out again when the document does, and a canvas that is opened lets everything go.

### Reduced motion

- **It changes how a mark is drawn and not what is lit.** A mark comes with a transition of a tenth of a second on the stroke and the opacity, and `prefers-reduced-motion: reduce` takes the transition away. Nothing pulses or flashes, and the tester and the log work as they did.

## Consequences

### Positive

- Nothing follows the geometry: the library does, and a test reads a class and a computed stroke.
- A mark is plain data, so that what is lit for each kind of row is a function that a spec holds, and the end-to-end journeys hold that the browser draws it.
- The reasons are in the page as text, in the label and in the inspector, and the contrast of both is checked.

### Negative / trade-offs

- The adapter has an input more, and a class on every connection and node that changes, which is two hundred and fifty classes at the most to look at for each change of what is lit, and not for each frame.
- A label with a reason is wider and taller than one without. The greedy placement estimates the size of the chips, so a reason can overlap a label by a few pixels, and the card is the place where it can be read whole.
- Marks by index depend on `bindingIds` being the order of `toTopology`, and a spec holds that.

## Alternatives considered

- **Paint it on the overlay.** Rejected above.
- **An SVG layer of our own** with the geometry of the edges. Rejected: a second copy of where the library draws them, which ADR-0055 refused for the messages.
- **The Why? as a view that replaces the canvas** with a diagram of the route. Rejected: the point is to see the learner's own canvas lit, and a second diagram would have to be kept equal to it.
- **Announce each mark.** Rejected: a Why? is twenty marks, and ADR-0055 says what a screen reader is told.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0016](0016-node-editor-library.md), [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md), [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md), [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md), [ADR-0055](0055-the-overlay-draws-on-a-canvas-outside-change-detection-and-follows-the-real-paths.md).
- [ADR-0060](0060-the-explanation-of-a-route-is-one-function-in-the-domain-and-its-text-is-what-the-golden-files-hold.md), [ADR-0061](0061-the-event-log-is-a-ring-of-rows-that-puts-a-command-before-what-it-made-and-a-row-selects-what-it-explains.md),
  [ADR-0063](0063-the-message-inspector-opens-from-a-row-a-list-or-a-marker-and-says-so-when-its-route-is-gone.md), [ADR-0064](0064-the-what-if-and-the-topic-tester-read-the-canvas-and-change-nothing-and-explain-is-one-flag-in-two-halves.md).

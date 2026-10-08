# ADR-0071: What building S8 settled: a chip fits between two nodes, a binding from a message starts with the queue that missed, and three defects were found in a browser

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0070](0070-a-binding-is-made-from-a-message-by-ticking-its-headers-the-live-table-is-the-explanation-of-the-draft-and-a-chip-says-the-mode-and-the-first-conditions.md) (the chip, and where a binding from a message starts),
  [ADR-0066](0066-a-headers-binding-is-made-in-a-popover-and-edited-in-the-inspector-from-one-draft-and-an-edit-is-one-batch.md) (what an edit says in the log), and the chips and labels of [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md), for
  what building the last of S8 ([#10](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/10)) and trying it in a browser showed that they had left to the code or had got wrong.

## Context

ADR-0066 to ADR-0070 settled how S8 edits, types, flags and draws the conditions of a headers binding, before it was built. Building it, and writing for each half of the flag the journeys that a person would do, showed one decision that did not survive a browser, three places
where the first thing that was written was a defect that a unit spec could not see, and a few choices that the ADRs had left to the code and that are worth writing down because the first one that was tried was not the one that is there.

## Decision

### A chip is no wider than the line between two nodes, and goes on to more lines

ADR-0070 gave the chip of a headers binding its own class, "wider than a key", at 300 pixels, and said that it is cut at a width like any other. Seen in a browser, on the layout that the app gives, it was drawn under the nodes at both ends of a short edge, and the end of it, which says `+N more`, was
behind one of them. Two things made that so. Nodes are laid out 160 apart, which leaves a line of 136 between the handles, and the library keeps the content of a connection inside its line, adding 18 of room of its own round it: a label that is wider than the line is not centred, it is pushed towards one
end until it is over a node. So the widest chip that stays where the placement put it is 118 wide, and a chip of a mode and three conditions is longer than that.

- **The chip is 118 wide at most, and its text goes on to the next line** where it is longer. It is not cut by an ellipsis, so nothing of what a binding asks is hidden by the width, and a value that has no space in it is broken where the line ends (`overflow-wrap: anywhere`).
- **A line ends after a dot and never begins with one**, and `+N more` is not broken in two: the text that is drawn has a space that does not break before each `·` and between `+N` and `more`. The text that is said (the label of the edge, the card) has plain spaces.
- **A chip of conditions is told from a chip of a key by how it begins**: one of the four modes and the separator. The first test of it, the separator alone, took a key that had a `·` in it for a chip of conditions.
- **The size of a label is estimated by filling lines as the browser does**, a word at a time, with a word that is wider than a line broken where it ends, and not by the length of the text, because a text of 57 characters is three lines or four by where its words end, and the places of the labels are
  worked out before anything is drawn from that height.
- The label of an edge that has two bindings is as wide as the wider chip and as high as both, as before; two edges that leave one exchange are kept clear of each other and of the nodes by the same placement.

A chip is taller than it was, two to four lines for the chip of three conditions: the cost of a mode and three conditions on a line of 118. The card still lists every condition on one line each, and the label of the edge says them all.

### A binding made from a message starts with the first queue that did not get it, then the first queue, then the first target

ADR-0070 says that it "starts as the first queue that did not get the message". A message that every queue got, and a canvas that has no queue, are not said. The target is the first queue that did not get the message, else the first queue, else the first thing that the rules allow, and the list of targets is
never empty, because an exchange may be bound to itself, so there is no state of the panel that says that there is nothing to bind to.

### What an edit says

An edit of the conditions of a binding is an `unbind` and a `bind` in one batch (ADR-0066), and the sentence for the status line and the log says it as it is: "changed the binding from exchange S to queue D", where the two halves of a batch that has the same two ends would have said "unbound" and "bound". The
binding that was edited is the last of its edge afterwards, because it was made last, and two bindings that the edit makes the same are one, which a learner is told in a sentence of its own.

### Two things that a pointer and a finger found, and an array that is the same twice

- **A hover must not take the fill from a segment that is chosen.** The mode is a group of radio buttons drawn as segments. A press chose one and left the pointer on it, and the colour of the surface under a pointer was drawn over the accent, with the words in the colour for words on the accent: white on light grey. Axe found it, in both
  themes, in every state in which a mode had just been pressed. A segment that is chosen keeps the accent when it is hovered.
- **The ticks of a binding made from a message are 24 pixels**, which is what WCAG 2.2 asks of a target that has others a few pixels from it, and not the 16 of a native checkbox.
- **The headers of one message can be the same array as those of the next.** The engine keeps one array for every message that a producer sends while its message is not changed, so the ticks that started again "when the headers change" did not start again for the second message of a producer. They start again with the number of
  the message as well. Any state of a panel that is meant to be forgotten for another message is keyed by the message and not by what it holds.

### The names of the page

The rows of headers have names that a screen reader says (`Name of condition 1`, `Type of header 2`), and the field that names a node is called `Name`: the page object of the end-to-end tests asks for it exactly, since a name that is asked for by what it contains finds all of them. The chips of the page object leave out the reason that a lit
canvas puts on the label of a binding that missed, which is a chip of its own.

### How it was measured

The big canvas of 200 nodes and 500 edges has a variant in which every fourth exchange reads headers, whose bindings have three conditions in a mode that changes from one to the next, laid out on a grid so that a node is not a speck at the zoom that fits it (the nodes that a canvas makes for itself are in a line that fits at 3.7%,
where a press does not find a node). With the flags `editor`, `simulation`, `explain` and `headers` it is drawn in 831 ms against the budget of three seconds, with the chips of a hundred bindings on it, and after a burst of a thousand messages to a headers exchange the popover that asks for the conditions of a link, with its
table of the last ten of the thousand, is there 155 ms after the target is chosen, and works the table out again as a condition is typed within the same budget. Both are in `e2e/performance.spec.ts`.

## Consequences

### Positive

- A chip of what a binding asks is drawn between the two nodes, whole, at the layout that the app gives, and a long value is broken and not hidden.
- Axe is clean in both themes in every state that S8 added, and a mode that has just been chosen is readable.
- A binding made from a message is made on the queue that the message did not get to, which is the one that a learner who opens the panel is asking about.

### Negative / trade-offs

- A chip of three conditions is up to four lines tall, and a label that has two of them is as tall as eight lines. A canvas whose nodes are laid out further apart could have wider chips, and does not.
- The estimate of a chip's lines is worked out, and not measured, so it can be a line out for a font that is not the one it was worked out for; the places of the labels are as good as the estimate, and a label that is dragged goes where it is put.
- A very long header value is broken at any letter. A learner who reads it from the chip has to put the lines together, and has the card, the label of the edge and the editor for the whole.

## Alternatives considered

- **Keep the chip at 300 and lay the nodes further apart.** The layout is the learner's, and the default one is the gap of the auto-layout, which would grow for every edge that has a long label; and the label is still pushed over a node on a canvas that has the nodes where they are now.
- **Draw the labels above the nodes.** The library draws the content of a connection in the layer of the connections, under the nodes, and a label over a node covers its name and its handle.
- **One chip for the mode and one for each condition.** A binding with six conditions would use up the three chips of an edge, and the second binding of the edge would be "+N more". The chip of a binding is the unit that a learner counts.
- **Cut the chip with an ellipsis, as the chip of a key is.** It would hide the conditions that the chip exists to say; the count of what is hidden is `+N more` inside the text, and the text that is cut by the width is not counted by anyone.
- **Measure the labels, and place them from what is drawn.** The placement is a pure function of the lines, the boxes and the nodes (ADR-0044), and is tested as such; a measured size would make it a function of the browser.

## Related

- [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md), [ADR-0049](0049-the-reader-of-paths-knows-what-the-bezier-edge-draws-and-a-browser-holds-where-labels-are-put.md).
- [ADR-0066](0066-a-headers-binding-is-made-in-a-popover-and-edited-in-the-inspector-from-one-draft-and-an-edit-is-one-batch.md), [ADR-0067](0067-a-value-is-typed-by-how-it-is-written-one-function-reads-it-for-the-editor-and-the-grammar-and-a-type-is-changed-by-rewriting-the-text.md),
  [ADR-0068](0068-a-row-says-what-is-wrong-under-itself-a-duplicate-stops-the-commit-an-x-key-is-told-by-what-the-mode-does-with-it-and-a-lint-stays-a-lint.md), [ADR-0069](0069-the-headers-flag-has-three-halves-the-producers-table-commits-row-by-row-and-s8-adds-no-key.md),
  [ADR-0070](0070-a-binding-is-made-from-a-message-by-ticking-its-headers-the-live-table-is-the-explanation-of-the-draft-and-a-chip-says-the-mode-and-the-first-conditions.md).

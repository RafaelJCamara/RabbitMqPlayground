# ADR-0042: A drop on nothing opens the create menu, and what it makes is one batch

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** "After a drop" of [ADR-0011](0011-explicit-linking-and-command-layer.md) (dropping a handle on empty canvas offers "new exchange / queue / consumer"),
  [ADR-0039](0039-the-context-menu-stays-open-through-the-end-of-the-click-that-opened-it.md) (a menu that a pointer opens) and [ADR-0041](0041-the-five-ways-to-link-share-one-path-and-a-binding-asks-for-its-key-first.md)
  (one path to one command), for the intent `link-to-empty` that S4 reports and does nothing with but say so.

## Context

A link that ends on empty canvas has no target. The adapter tells it from a drop on a node that the rules refuse (a hit test, [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md)) and reports where it was,
in the coordinates of the canvas (`at`) and of the page (`client`). ADR-0011 says that the learner is offered something new to link to. It does not say what is offered, where the new node is put,
how the key of a binding is asked for when its target does not exist yet, or how many steps of undo it is.

## Decision

- **What is offered is what could be linked to.** For the node that the link started from, each item of the toolbox is tried on the document: add it, and ask the rules whether the source may be linked to it (`linkVerdict`).
  A producer is offered each exchange and a queue, an exchange each exchange and a queue, a queue a consumer. It is derived from the rules and not written as a table, so that a rule that changes
  changes the menu with it. A node with nothing to offer shows no menu and says so, in the words of the rule.
- **It is a menu at the point where the link was let go**, the CDK's, with the items of the toolbox in its words ("New queue", "New topic exchange"), a name for a screen reader ("Create and link from exchange orders"),
  the arrow keys, type-ahead and Escape. It holds the end of the click that follows a drop, as the context menu does ([ADR-0039](0039-the-context-menu-stays-open-through-the-end-of-the-click-that-opened-it.md)): a drag that ends on the canvas is followed by a `click`, and so is a tap.
  It is the same component, given other items, and not a second one.
- **A choice makes one batch**: the declaration of the new node, a `move` that puts the middle of the node where the link was let go (as a node dropped from the toolbox is), and the link
  command that `LinkFlow` makes for it. So it is one step of undo, and its equivalent command is the line that a learner would type, `declare queue queue1; move queue1 x=412 y=220; bind orders -> queue1 key=order.*`.
- **A new node takes the name of the toolbox** (`queue1`, the smallest number that is free), and is selected and brought into view.
- **The key is asked for before anything is made.** From a direct or a topic exchange, the popover of ADR-0041 opens where the new node will be, and Enter makes the whole batch with the key. Escape makes nothing.
  From a fanout, a headers exchange, a producer or a queue, the batch is made at once.
- **Click to connect, and touch, are the same.** A tap on a handle and then on empty canvas reports `link-to-empty` as a drag does, and the menu opens for it. The keyboard cannot end on nothing, because its targets are
  the nodes that the rules allow, so a learner without a pointer creates with the toolbox, which the keys reach, and then links with `L`.
- **Escape, or a click elsewhere, closes the menu and makes nothing.** The focus goes back to the canvas.

## Consequences

### Positive

- Drag, drop, choose is one gesture and one step of undo for a new node and its link.
- The menu cannot offer what the rules would refuse, and the refusal for a node with nothing to offer is the rule's own sentence.
- The same menu and the same hold serve the context menu, the create menu and any later menu that a pointer opens.

### Negative / trade-offs

- The menu is tried against the document each time it opens, which is a few calls of `applyCommand` on a scratch copy. It is as cheap as the list that lights the handles.
- A new node is put where the link was let go, and not in the column of its kind, so a learner who drops far from the others makes a node that is far from the others. Auto-layout is one button away.
- The sentence for the step (`describeBatch`) has to say two things, the node and the link.

## Alternatives considered

- **A menu of every kind of node.** Rejected: it would offer a consumer for an exchange, and the refusal would come after the choice.
- **Make the node and the link as two steps.** Rejected: undo would take the link and leave a node that nobody asked for, and the log would have two lines for one gesture.
- **Put the new node in the column of its kind** (`defaultPosition`). Rejected: the learner pointed at a place, and ADR-0033 puts a dropped node where the preview was.
- **Open the popover after the node exists.** Rejected: a key that is given up would leave a node with no binding, which the learner did not ask for either.

## Related

- [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md), [ADR-0039](0039-the-context-menu-stays-open-through-the-end-of-the-click-that-opened-it.md),
  [ADR-0041](0041-the-five-ways-to-link-share-one-path-and-a-binding-asks-for-its-key-first.md).
- [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md): a batch is atomic and is one step of undo.

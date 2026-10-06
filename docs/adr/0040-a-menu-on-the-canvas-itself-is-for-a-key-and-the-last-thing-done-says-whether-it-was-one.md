# ADR-0040: A menu on the canvas itself is for a key, and the last thing done says whether it was one

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md) (the adapter, which reports a menu
  as an intent) and [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md) (the menu key and Shift+F10 open a menu for what is
  selected), for what a change made by hand to the adapter showed when S4
  ([#6](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/6)) was checked for what its tests do not notice.

## Context

The menu key and Shift+F10 send `contextmenu` to the canvas itself, `f-flow`, and the menu that follows is for the one thing that is
selected. The adapter took an event for a key's when its target was the flow, and for a pointer's when the target was something on the
canvas, a node or an edge.

A right click on the empty part of the canvas has the flow as its target as well: nothing is on top of it there. So with one node selected,
which is what adding a node leaves, a right click on nothing opened the menu of that node at the middle of the node, and kept the browser
from showing its own. No test noticed. A change that was made by hand, the removal of the check of the target, made no test fail, which
meant that the check told nothing, and a test that right-clicks the empty canvas with a node selected found the bug behind it.

## Decision

- **The last thing that the learner did tells a key from a pointer.** A press sets it to "pointer" and a key to "keyboard", in the capture
  phase of the page, before the library hears either. The adapter keeps it already, to say how a link was made. A menu on the canvas itself is
  for the selection only when the last thing was a key.
- **A right click on the empty canvas is left to the browser.** The page does not prevent its default, and no menu of ours opens. A menu of
  our own there ("Add here") is a feature for later, and S9 may want it.
- **A menu for a node or an edge does not depend on this.** The target says what was pointed at, and the default is prevented.
- **The contract suite says all three.** With one node selected, the page does not take a right click on nothing, and takes one on a node and
  one on an edge; a key opens the menu for the selection, and Escape gives the focus back.

## Consequences

### Positive

- A right click on nothing is no longer taken for a key, and the menu that opens is the one that was meant.
- What decides is what the person did, and not which element the library happens to put on top.

### Negative / trade-offs

- A `contextmenu` that a script, or an assistive technology, sends with no key and no press since the last press is taken for a pointer's, and
  left alone. The keys do open the menu, and the learner who uses them has pressed one.

## Alternatives considered

- **The button of the event** (2 for the right button, 0 for a key). Rejected: a Control click on a Mac is a press with the button at 0, and
  the last thing done says that it was a press.
- **The type of the pointer of the event.** Rejected: not every browser sends the event as a pointer event, and the ones that do leave it empty
  for a key, which a test cannot rely on in all of them.
- **The element under the pointer.** Rejected: it is the flow, which is what made the check useless.

## Related

- [ADR-0017](0017-canvas-keyboard-model.md), [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md),
  [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md),
  [ADR-0039](0039-the-context-menu-stays-open-through-the-end-of-the-click-that-opened-it.md).

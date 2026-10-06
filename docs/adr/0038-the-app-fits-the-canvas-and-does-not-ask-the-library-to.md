# ADR-0038: The app fits the canvas, and does not ask the library to

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md) (the adapter, which reads the
  transform of the canvas for its first workaround), for what S4
  ([#6](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/6)) found when it fitted the canvas.

## Context

ADR-0033 lists what the adapter reads from the library and what it reports. A canvas is also *fitted*: when it is first drawn, when a node
that is added is out of view, when the learner presses Fit or F, and after the auto-layout. The first build asked the library to do it
(`fitToScreen`). That call waits until the library has drawn the connections for the nodes that it has registered, and for a canvas that
has no edges that did not always come, so a node that was added to an empty canvas was sometimes left at its edge, half out of sight, and
the fit was done later, or never. A learner who clicked "Queue" saw nothing, or half a queue.

## Decision

- **The app works out the viewport itself.** It knows where each node is and how big it is drawn (the view model), so a pure
  function, `fitViewport`, gives the viewport that shows them all: in the middle of the canvas, with 40 pixels all round, and never
  zoomed in past 100%, so that a few small nodes are not blown up. Nothing waits on what the library has measured.
- **The adapter writes it, and draws it.** It sets the scale and the position of the canvas's transform and clears the offset that
  zooming leaves, calls the library's own `redraw()`, and has the library say that the canvas changed (`emitCanvasChangeEvent()`), which is
  what keeps the percentage of the zoom right. These are what the library's fit does itself once it has its measures.
- **A node that was added is brought into view after the render that draws it**, so that the view model that the fit reads has it.
- **A contract test pins what this depends on**: after a fit, every node is painted inside the canvas where the transform says, and the zoom
  that is reported is the zoom that was written. If an upgrade changes how the transform is drawn, that test fails.

## Consequences

### Positive

- A fit is the same every time. It does not depend on a race inside the library, and it is covered by unit tests of the arithmetic.
- The first node of a canvas is in the middle of it, which is where a learner who has just added it looks.

### Negative / trade-offs

- The adapter now writes the transform as well as reads it. Both are fields that the library's typings make public and its documentation
  does not mention, and the contract suite is what notices a change.
- The app's fit and the library's would differ if the library measured a node at another size than the app draws it. They are the same
  numbers (the size of a node is the domain's `NODE_SIZE`, [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md)).

## Alternatives considered

- **Wait for `fNodesRendered` and then ask the library to fit.** Rejected: that is the wait that did not always end for a canvas with no edges.
- **Set the `position` and `scale` inputs of the canvas.** Rejected: they act only when their value changes, so a fit to the same numbers
  after the learner has panned would do nothing.
- **Centre on the new node, with `centerGroupOrNode`.** Rejected: it hides what is already there, and it waits on the same measures.

## Related

- [ADR-0016](0016-node-editor-library.md), [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md),
  [ADR-0034](0034-the-foblex-contract-suite-and-how-an-upgrade-fails-loudly.md).

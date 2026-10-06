# ADR-0033: The Foblex adapter: one component, intents out, and the four workarounds

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0016](0016-node-editor-library.md) (its integration rules and its workarounds, which S4
  ([#6](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/6)) builds) and [ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md)
  (the folder that holds the adapter).

## Context

ADR-0016 chose Foblex Flow, said that all of it sits behind one adapter, and named the workarounds that the spike needed. It did
not say what the adapter takes in and what it gives back, how each workaround is built, or what building it showed that the spike
had not. The editor (S4), the linking UI (S5) and the message overlay (S6) all stand on the answer.

## Decision

### The shape

- **One component draws the canvas**: `FlowCanvas`, `rmq-flow-canvas`, in `canvas/flow/`. It is the only file of the app that
  imports Foblex, and no import reaches into the library's folders (ESLint, [ADR-0018](0018-workspace-layout-and-dependency-rules.md)).
- **It takes in what to draw, and nothing that is the library's**: a view model (`CanvasVm`: nodes with kind, name, position, size,
  shape and the label that a screen reader speaks, and edges with their key, ends and kind), the selection in ids, and the link
  rules of the document. It makes no decision about what is on the canvas.
- **It gives out one thing, an intent** (`canvas/model/intents.ts`): `select`, `move`, `delete` (each says whether a pointer or a key
  did it), `link`, `link-invalid` and `link-to-empty` (each says whether it was made by dragging, by clicking, or from the keyboard),
  `context-menu`, `rename` and `drop-new`. Points are in the coordinates of the canvas, except the ones called `client`. The
  library never changes what is on the canvas: the editor turns an intent into commands ([ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md)),
  and the document that results is drawn again.
- **What the rest of the app asks of it** is a service, `FlowViewport` (in `canvas/model/`, so that it has no library in it): the live
  viewport, a point of the page on the canvas, fit, zoom in, zoom out, reset, select, focus, bring a node into view, the path of
  an edge, how far it is zoomed and which edges have been drawn. The adapter attaches a driver to it when the canvas starts.
  Until one is attached, every call does nothing, so that the rest of the app is tested without a library.
- **What can be pure is outside the folder.** The conversion of a library event into an intent, the hit test, the classification of
  a drop, the lists of valid targets, the arithmetic of the viewport and the guard of the keys are in `canvas/model/` with unit tests.
  What is left in the adapter is the part that cannot run without a browser, and it is covered by the contract suite
  ([ADR-0034](0034-the-foblex-contract-suite-and-how-an-upgrade-fails-loudly.md)) and the editor's journeys.

### The four workarounds of ADR-0016, as built

The numbers are the ones in the contract suite, where each is a group of tests.

1. **A live viewport.** The adapter reads the transform of the canvas when it is asked (`position + scaledPosition`, and the scale), and
   not from the event of the library, which fires when a gesture ends. `FlowViewport.live()` is what the overlay of S6 and the
   conversion of a pointer to a point of the canvas use. The event is used for one thing only, the percentage on the zoom button.
2. **The list of valid targets is read when a drag starts.** The library reads `fCanBeConnectedTo` once, when the drag begins, and an
   empty list means every connector. So the adapter puts the node that is pressed in the lists on the capture-phase `pointerdown`
   of the page, before the library's own listener, and renders it at once, so that the list is in the page when the drag starts.
   A node with no valid target gets a list with one entry that no connector has, because an empty list would mean "everything".
   For a link that starts from the keyboard there is no press, so the node that is selected alone is the one that is armed.
3. **Edges are drawn after their elements exist.** The library draws a path a moment after the element appears (a debounce, a Web
   Worker and a few frames). The adapter watches the container of the connections and reports which edges have a path, and which
   have gone. `data-edge` is the key of an edge in the page, and `data-edge-id` is added when its path is drawn. A test, or the
   overlay, waits for it. The canvas also says when it has been drawn and fitted (`data-ready`), because that moves everything.
4. **An invalid drop and a drop on nothing both come as "no target".** The adapter asks which node is under the pointer when the
   link ends, and so can say a valid link, a link that the rules do not allow (and to which node), or a link to nothing (and where).

### What building it showed

- **The selection is the editor's.** The library keeps a selection of its own, which the adapter sets from the editor's after the
  nodes that it names are drawn, and reports every change of as a `select`. Neither is told twice.
- **A node's size is drawn on its body.** The library rewrites the `style` of a node, and only the position survives, so the size is
  on the element inside it.
- **A double click on a node renames it, and on the empty canvas does nothing.** The library's double-click zoom is switched off.
  Zoom goes from 25% to 200%.
- **An edge cannot be reconnected by dragging its end** (the library offers it, and it is switched off). Changing an edge is
  deleting it and linking again, which S5 builds as commands.
- **The toolbox is the library's external item**, applied to our buttons as a host directive. The library finds the item that is
  pressed with `closest('[fExternalItem]')`, and a host directive does not put that attribute on the element, so the directive
  puts it there. Without it a drag never starts and nothing is said. A drop reports where the middle of the preview was, in the
  coordinates of the canvas, because the library's own pointer position is in the coordinates of the page, and is given only when
  the drop is on a node. When the canvas is not at 100% the library puts the preview off the pointer (it measures the item as if it
  were inside the zoomed canvas), so the node is put where the preview was, which is what the learner saw.
- **A document-level listener, in the capture phase, runs before the library's.** The two that the adapter has are the press that
  arms a node (workaround 2) and the guard of the keys ([ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md)).
- **Geometry runs in a Web Worker made from a Blob URL**, so a Content Security Policy must allow `worker-src blob:`
  ([ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md)).

## Consequences

### Positive

- The library is behind one door. A later slice that needs something of the canvas adds a method to the service or a kind of
  intent, and does not import the library.
- The rest of the app is unit-tested with a canvas that is a fake with the same inputs and the same output.
- The workarounds are in one folder, each with a name, a number and a group of tests.

### Negative / trade-offs

- The adapter is outside the unit coverage and is covered by tests in a browser, which are slower and which need the timing of the
  library to be waited for, not assumed.
- Each of these is a fact about version 19.3.0 that is not in its documentation. An upgrade can change any of them, which is why the
  contract suite exists.
- A node that is dropped from the toolbox lands where the preview was, not under the pointer, when the canvas is zoomed. The
  difference is small at the zooms that a learner uses and grows towards the ends of the range.

## Alternatives considered

- **Read the state that the library documents** (`getState()`, `fCanvasChange`). Rejected: it is current only when a gesture ends,
  so the overlay would lag in the middle of a pan.
- **Leave `fCanBeConnectedTo` empty and refuse an invalid link after the drop.** Rejected: nothing lights while the learner drags,
  which is how a learner finds out what can be linked (ADR-0011), and the broker's rule would be learned only after a mistake.
- **Write the drag from the toolbox ourselves**, with pointer events. Not done: the library's works, with touch, and the quirk
  above is small. It is the first thing to replace if the library's drag keeps costing workarounds.
- **Let the adapter decide what a gesture means** (make the commands itself). Rejected: that is the logic that the unit tests
  must reach, and the adapter is the part that they cannot.

## Related

- [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0016](0016-node-editor-library.md), [ADR-0017](0017-canvas-keyboard-model.md),
  [ADR-0018](0018-workspace-layout-and-dependency-rules.md).
- [ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md), [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md),
  [ADR-0034](0034-the-foblex-contract-suite-and-how-an-upgrade-fails-loudly.md), [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md).

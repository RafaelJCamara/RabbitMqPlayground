# ADR-0055: The overlay draws on a canvas, outside change detection, and follows the real paths

- **Status:** Accepted. How the colours are read, what wakes the loop and the frame that cannot jump are settled by [ADR-0057](0057-what-building-s6-settled-folders-that-run-one-way-a-strip-that-is-a-region-frames-that-cannot-jump-and-colours-read-through-a-probe.md).
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "Simulation controls" and "Visual language and accessibility" of [ADR-0010](0010-explanation-first-editor-ux.md), "Rendering contract" of [ADR-0007](0007-deterministic-simulation-engine.md) (the UI interpolates the events against the
  virtual clock, reduced motion changes only how events are drawn, a crowd is grouped under a "×N" badge), [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md) and
  [ADR-0049](0049-the-reader-of-paths-knows-what-the-bezier-edge-draws-and-a-browser-holds-where-labels-are-put.md) (the path that the library drew is read and a point is found at a fraction of it), for the animation of S6
  ([#8](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/8)).

## Context

The plan names the risk: the spike drew the messages and ran at 39 frames a second. The remedies it lists are that the counters are signals of their own, that the overlay runs outside change detection, that a crowd is grouped, and that a check says that 200 nodes and 500 edges
are drawn in three seconds. The app is zoneless, so a callback of the frame loop does not start a pass of change detection by itself, and one that sets a signal does. ADR-0044 decided against an overlay for the labels because it would have to follow the pan, the zoom and a dragged
node on every frame, which "is what S6's overlay has to do for the messages". This is the decision of how.

## Decision

### What is drawn, and where

- **One `<canvas>` of 2D, over the canvas of the editor and under its menus, cards and popovers**, as large as the canvas's host and as sharp as the screen (`devicePixelRatio`), kept the right size by a `ResizeObserver`. It has `pointer-events: none`, so that nothing that the learner does
  is taken by it, and `aria-hidden="true"`: it is a picture of what the engine says, and the engine's counts are text elsewhere.
- **A message is drawn along the edge that it is on, and the edge is the one that the library drew.** The overlay asks `FlowViewport` for the `d` of the path (`edgePath`, which reads it from the page), reads it with `polylineOf`, finds the point at a fraction of its length with `pointAtFraction` (ADR-0049), and
  puts it on the screen with the live transform of the canvas, which is read on every frame. So a pan, a zoom, a dragged node and an edge that the library draws again are followed with no copy of the geometry, and with no wait. A path that has not been drawn yet is not drawn on, and the message is
  shown at the end that it is going to.
- **What is on which edge comes from `flights()`** ([ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md)), which is a function of the engine's state and so needs nothing remembered:
  - the **publish** leg is the link of the producer (`p>x`, or `p>q` for a queue, through the default exchange), for `publishMs`;
  - the **broker** leg is the hops of each path of `routed`, which share `brokerMs` equally: a path of one hop takes all of it, a path of two takes half on each (the same latency on every path, as ADR-0007 says). A hop is the binding edge between two nodes (`x>q`, `x>x`), or, from the default exchange, the implicit edge
    (`~default>q`) when the default exchange is shown. When it is not, the message waits at the end of its last edge, which is what a message that is inside an exchange that is not drawn is;
  - the **deliver** leg is the subscription (`q>c`), for `deliverMs`.
  The edges are told by the ids of the nodes, which the document knows from the names (an exchange and a queue by name, a producer and a consumer by id), as the view model of the canvas keys its edges.
- **A burst is one picture.** The messages that are on the same edge in the same window are drawn as one, with a **×N** badge: a burst of 20 is one marker with "×20", and one message is a marker with its key. When more than 500 messages are in flight the rest are grouped by edge and by thirty-second of the way, so that a
  thousand are never more than a few hundred shapes. The grouping is a pure function that is tested, and the drawing is a few lines.
- **The colour of a message is its routing key's**, one of eight that are told apart in both themes, with the key as a short word beside the marker while there are few of them. A message that is redelivered has a ring. Colour is never the only sign: the ring, the badge and the word say it too, as the shapes of the nodes do (ADR-0032).

### One loop, outside change detection

- **One `requestAnimationFrame` loop drives everything that moves**: it advances the engine by the time that passed times the speed, and then draws. It is started by whatever can make something move (play, a step, a publish, a command that changed the document, a pan, a zoom, a resize, a change of theme or
  of the preference for motion), it asks to be called again only while something moves, and it **stops when the clock is stopped and nothing is in flight**, or when it is running and nothing is scheduled. A canvas at rest costs no frames. A stopped clock with messages in flight is drawn once, and again
  when the canvas moves.
- **It sets a signal only when a count changed**, and the counts are per node ([ADR-0056](0056-counters-stacks-and-slots-are-signals-of-their-own-and-the-controls-are-a-strip-under-the-top-bar.md)), so that a frame that moves messages and finishes none costs no pass of change detection at all.
- **A step moves the picture over a short time**, a quarter of a second, from where it was to where the step put it, so that a learner who steps sees what happened and not a jump. It is the picture that takes the time: the engine's clock jumps. With reduced motion it does not.
- **The clock is the engine's, with the fraction that the engine does not keep** ([ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md)): the loop adds `dt × speed` to a real number, gives the engine its floor, and draws at the real number, so that a message is
  a smooth thing and the engine's events are on whole milliseconds.

### Reduced motion changes how, not when

`prefers-reduced-motion: reduce`, read when the page starts and when it changes, makes the overlay draw a message **still**, at the middle of the edge that it is on, for as long as the leg lasts, with an outline, and not slide along it. The engine does not know: the times, the counts, the events, the order
and what the log says are the same, which a test holds by running the same session both ways and comparing the events. The step does not tween either. Nothing is added that flashes.

### What a screen reader is told

The overlay says nothing: it is decorative, and a message for each message would drown everything else. What is said is what the learner did, once, as for any command, by the bus (ADR-0031): "Playing at 1×", "Paused", "Stepped: sender published message 3", "Published 3 messages from
sender", "Purged 4 messages from billing", "Cleared the messages", "Counters reset", "Speed 2×". What a producer that repeats does is not said. The counts that a sighted learner reads off the nodes are text for the others: the inspector of a queue lists its messages and says how many are ready and unacknowledged, and the inspector of a consumer says how
many it holds of how many it may, in words, and both are read when they are asked for and not on every change.

### What a test can see

The end-to-end build has one more read-only name on the debug handle, `overlayFrame`, which gives what the last frame drew (each marker's edge, its place on the host, its count, and whether the preference for reduced motion was on). The bundle check refuses it in the build that is deployed. The
drawing itself is a few lines over that, and is held by it and not by pixels. The positions, the grouping, the legs and the stopping of the loop are pure and have unit tests.

## Consequences

### Positive

- A pan, a zoom and a dragged node need no code in the overlay, and there is no second copy of where an edge is to be wrong.
- A canvas that is at rest, or paused, draws nothing and wakes nothing, and a busy one costs one canvas and one loop.
- Reduced motion is a way of drawing, so that it cannot change what the simulation does, and a test says so.

### Negative / trade-offs

- The overlay reads the page for the path of each edge that has a message on it, on every frame while it runs. That is one query for each edge that is busy, and the paths are kept as lines until their `d` changes. If a canvas with hundreds of busy edges is slow, the answer is to read the paths once
  for each change of the canvas and not for each frame, which the loop can do because it knows when the canvas moved.
- A message that is on an edge that has no path yet is not drawn on it. The library draws a path a moment after an edge appears (ADR-0033), and a learner who publishes in that moment sees the message appear at the end.
- The overlay is a picture that a screen reader and a test of pixels cannot read, so what it draws is also in `overlayFrame`, which only the e2e build has.

## Alternatives considered

- **SVG elements for the messages, inside the library's canvas.** Rejected: hundreds of nodes of the DOM that move every frame, and a layer that the library sorts; the spike's 39 frames are what that was.
- **WebGL.** Rejected: the shapes are circles and short words, Canvas 2D does 500 of them in a frame easily, and a context of WebGL is a cost and a failure mode.
- **Animate with CSS or the Web Animations API along the path** (`offset-path`). Rejected: the position of each message would be the browser's and not the clock's, so pause, speed and step would each need a way to drive it, and reduced motion could not change only the drawing.
- **The overlay keeps its own sprites from the events.** Rejected in ADR-0052.
- **Announce each message to a screen reader.** Rejected: the polite region of a screen reader reads each one, and a burst of 20 is a minute of speech.

## Related

- [ADR-0007](0007-deterministic-simulation-engine.md), [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md), [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md),
  [ADR-0049](0049-the-reader-of-paths-knows-what-the-bezier-edge-draws-and-a-browser-holds-where-labels-are-put.md).
- [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md), [ADR-0056](0056-counters-stacks-and-slots-are-signals-of-their-own-and-the-controls-are-a-strip-under-the-top-bar.md).
- [M1 plan](../plans/m1.md), section 6 (performance).

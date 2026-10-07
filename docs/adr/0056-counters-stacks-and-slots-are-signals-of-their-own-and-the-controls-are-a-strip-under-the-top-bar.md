# ADR-0056: Counters, stacks and slots are signals of their own, and the controls are a strip under the top bar

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "Layout" and "Simulation controls" of [ADR-0010](0010-explanation-first-editor-ux.md) (a top bar with the play controls, a per-node set of counters), the nodes of
  [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md) and [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md), the top bar that fits of
  [ADR-0048](0048-what-building-s5-settled-ctrl-k-in-a-field-a-bar-that-keeps-its-draft-a-top-bar-that-fits-and-tests-that-wait.md) and the debug handle of
  [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md), for what S6 ([#8](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/8)) puts on the screen besides the messages.

## Context

ADR-0010 puts the play controls in the top bar and lists the counters of a node (published, routed, unroutable, depth, consumed). The plan adds queue stacks with their ready and unacknowledged counts, prefetch slots on consumers, a list of the messages of a queue with purge, a composer for a producer and the settings of a consumer.
The top bar of S5 fits one row at 1280 pixels and no more: it was made to fit, and the canvas moved 40 pixels under a drag when it did not. The adapter's `@for` over a few hundred nodes is the template that must not be checked by a simulation that changes a number a second.

## Decision

### The controls are a strip under the top bar

- **A strip of its own, `rmq-simulation-bar`, a row under the top bar and above the canvas**, with `role="toolbar"` and the name "Simulation", and only when the flag `simulation` is on. It is there from the first frame, so that the canvas has the same height before and after the first message (ADR-0048). It holds, in the order that a
  learner reaches for them:
  **Play/Pause** (one button whose name says what it will do, with its key), **Step** (with `.`), **Speed** (a group of five buttons, 0.25× to 4×, the one in use pressed), **Clear messages**, **Reset counters**, and at the right a readout of the virtual time and of how many messages are on their way, which is text and not a
  live region.
- Every button calls the bus (ADR-0054), with the origin `toolbar`, and says what it does by its name and not by its icon alone. A button that cannot do anything is disabled with its reason in the title (`Step`, when nothing is scheduled).

### Counters are signals of their own, for each node

- **One store of stats, a signal for each node**, set from `view()` after each batch of events, and only when what it holds is not what it held. A node's component reads its own signal and nothing else, so a burst of messages to one queue checks the component of that queue, and not the template of
  the adapter or the other 199 nodes. A test counts the signals that a burst sets, and a journey of the browser holds that 200 nodes and 500 edges are still drawn in three seconds with the flag on.
- **Each kind shows what it can say.**
  - A **producer**: how many it has sent, and an icon when it repeats.
  - An **exchange**: how many it routed and how many were unroutable (and refused, when there were any).
  - A **queue**: a **stack**, a column of up to eight small squares that stands for what it holds, full for ready and hollow for unacknowledged, and **+N** for what does not fit, with the text `3 ready · 1 unacked`.
  - A **consumer**: **slots**, a row of up to eight places for what it may hold at once, full for what it holds, `∞` for no limit and for a consumer that acknowledges by itself, with `holds 2 of 3`, how many it has finished with, and how many wait in it.
  The stack and the slots are drawn under the node's own box and not inside it, so that the box keeps the size that the layout has room for (ADR-0032), and they take no pointer.
- **A count is text with its words**, and the picture beside it is `aria-hidden`: the stack and the slots say nothing that the words do not.

### The rest of the screen of the simulation

- **Messages and purge**, in the inspector of a queue: the number ready and unacknowledged, the first fifty messages with their number, key, a cut of the payload and whether they are redelivered or held by whom, and **Purge**, which is `purge <queue>` (it takes the ready messages, and the button says
  that the unacknowledged stay).
- **The composer**, in the inspector of a producer: payload, routing key, how many in a burst, whether it repeats and how often, and **Publish** (`publish <producer>`). The fields are the commands that already exist (`set <producer> payload=… key=… burst=… every=… repeat=…`, ADR-0025), with the same refusals under the field. The headers of the message
  are a count and a note that the table is S8's.
- **The consumer's settings**, in the inspector of a consumer: how it acknowledges, its prefetch (0 is no limit) and the time that it takes for a message, each a `set <consumer> …`.
- These are components of a folder of their own, `simulation/`, that the inspector hosts and that read the stores; none of them calls the engine.

### What a test can read

The e2e build gets one more read-only name on the debug handle, `simulationState`: the clock, whether it runs, the speed, when the next event is, and the view of the engine. It is behind `RMQ_E2E` and in the list that the bundle check refuses.

## Consequences

### Positive

- The top bar is not touched, the canvas does not move when the first message is sent, and a busy simulation checks only the components whose numbers changed.
- A learner can read a queue, a consumer and a producer off the canvas, in words and in a picture, and the same numbers are in the inspector for a keyboard and a screen reader.
- The composer and the settings are the commands that were already there, so each field's refusal and each log line is the one that the grammar has.

### Negative / trade-offs

- The strip costs a row of the window (about 44 pixels) for every learner who has the flag, whether or not they ever press play.
- A stack and a row of slots that hold up to eight are an approximation: a queue of 3,000 is a full column and "+2,992". The text has the number.
- Two places say the same count, the node and the inspector, and a test has to hold that they are the same number.

## Alternatives considered

- **The controls in the top bar.** Rejected: it does not fit (ADR-0048), and making room by taking the labels off the buttons that are there undoes what S5 made.
- **A floating bar over the canvas.** Rejected: it covers nodes, and it has to be moved out of the way.
- **The stats on the view model of the node**, so that the adapter's template reads them. Rejected: every change of a count would make a new view model for the whole canvas.
- **Draw the stacks on the overlay.** Rejected: they belong to the nodes and move with them in the library's own layer, with no work for the overlay, and the overlay is for what moves.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md), [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md),
  [ADR-0048](0048-what-building-s5-settled-ctrl-k-in-a-field-a-bar-that-keeps-its-draft-a-top-bar-that-fits-and-tests-that-wait.md).
- [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md), [ADR-0054](0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md),
  [ADR-0055](0055-the-overlay-draws-on-a-canvas-outside-change-detection-and-follows-the-real-paths.md).
- [M1 plan](../plans/m1.md), sections 3 (S6) and 6.

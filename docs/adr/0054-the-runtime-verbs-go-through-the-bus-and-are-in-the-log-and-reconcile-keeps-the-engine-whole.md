# ADR-0054: The runtime verbs go through the bus and are in the log, and `reconcile` keeps the engine whole

- **Status:** Accepted. What the bar and the bus do with them while the flag is off is settled by [ADR-0057](0057-what-building-s6-settled-folders-that-run-one-way-a-strip-that-is-a-region-frames-that-cannot-jump-and-colours-read-through-a-probe.md).
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "The verbs of M1" of [ADR-0025](0025-the-command-grammar.md) (the runtime verbs "have slices of their own"), "One command layer" of [ADR-0011](0011-explicit-linking-and-command-layer.md) and
  [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md) ("`reconcile` ... producers and consumers have no engine command until the simulation arrives (S6)"), the bus of
  [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md) and the log of [ADR-0046](0046-the-equivalent-command-log-and-the-tests-that-hold-gestures-and-commands-together.md),
  for what S6 ([#8](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/8)) had to decide to give the learner the simulation by hand, by key and by typing.

## Context

ADR-0011 lists `publish`, `pause`, `step`, `speed`, `clear messages` and `reset counters` among the commands and the keys `P`, Space and `.`; ADR-0025 says that they "join the same registry" in S6. ADR-0046 made the typed command and the gesture one door for the canvas, with a
property that holds it. The runtime has to be the same, or a lesson that says "press P" and one that says "type `publish sender`" are two things, and the log that teaches the commands is missing the ones that matter most while a simulation runs. ADR-0026 left
`reconcile` with the topology only, and a producer and a consumer that nothing tells the engine about do nothing.

## Decision

### The verbs

| Command | Does | Syntax |
|---|---|---|
| `publish` | sends the message of a producer now, as many as its burst says, or one message to an exchange, with no producer | `publish <producer>` · `publish <exchange> [key=<text>] [payload=<text>] [header:<name>=<value>...]` |
| `purge` | takes the ready messages out of a queue, and not the unacknowledged ones | `purge <queue>` |
| `play`, `pause` | lets the virtual clock run, or stops it | `play` · `pause` |
| `step` | runs the one event that is next, and moves the clock to it | `step` |
| `speed` | how fast the clock runs, from 0.25 to 4, where 1 is a virtual millisecond for each real one | `speed <factor>` |
| `clear messages` | takes every message out of the simulation, and leaves the canvas as it is | `clear messages` |
| `reset counters` | zeroes the counters, and leaves the messages | `reset counters` |

- **They are in the registry**, with `scope: 'runtime'`, which is the third value of `CommandSpec` and the one that the plan gives to what runs the simulation (`app` is for what answers about the history and the commands: `undo`, `redo`, `help`). They are parsed, formatted, completed, helped and
  documented like every other command, and `docs/commands.md` is generated from them. Their type is `RuntimeCommand`, which is a `Command` and not a `DocumentCommand`, so that `applyCommand` cannot be handed one. They stand alone and cannot be one of several commands in a
  batch, as `undo` and `help` cannot: a batch is one change of the document, and a runtime verb is not.
- **`speed` reads one number**, positional, as `rename` reads a name (`speed 2`, `speed 0.25`), from 0.25 to 4, and the buttons offer 0.25, 0.5, 1, 2 and 4. `step` takes no count: each is one event, and a learner who wants ten types or presses ten times.
- **A refusal says the root cause first**, as always: a producer that has no target has nowhere to publish (`link sender -> orders`), an exchange that is internal cannot be published to (the broker's `403` after the sentence), a name that is not on the canvas gets the suggestions of the grammar.

### One door

- **`CommandBus.run(command, origin)` is the door of the runtime**, as `apply` is the door of the document and `undo` and `redo` are of the history. The bus hands the command to the simulation service, which runs it against the engine and answers what it did, and the bus tells the learner on the
  status line and aloud, as it does for every command, and tells the listeners. The buttons, `P`, Space, `.`, the composer's Publish button, the purge button of a queue and the speed buttons all call it, with the origin that says which they are, and the typed line calls it through the same
  `CommandRunner`. No component calls the engine.
- **The log has them.** A runtime command that changed the simulation is a line of the same log, in the same order with the commands that changed the canvas, written as the learner would type it (`publish sender`, `pause`, `step`, `speed 2`). One that changed nothing is not: a `pause` while paused, a
  `speed` that is the speed, a `step` when nothing is scheduled, a `purge` of a queue with nothing ready, a `clear messages` of an empty simulation. S7's event log shows these lines beside the events, from the same store, as ADR-0046 says.
- **Space is one key and two commands.** It runs `play` when the clock is stopped and `pause` when it runs, and the log has the one that it was. `.` is `step`, and `P` is `publish` of the selected producer, and does nothing, and is not offered, for anything else. The three work on the canvas, like
  every key of a single character (ADR-0035), and each row of the table says that it is for the flag `simulation`, so that without the flag the keys are the page's and the hint bar and the cheat-sheet do not show them.
- **The simulation starts running**, at 1×, and sits still while nothing is scheduled, so a canvas that has nothing to do costs nothing. The tests pause it first.
- **Undo restores the design, not the simulation** (the plan, 2.3). An undo that deletes a queue that holds messages loses them, and the line that says what was undone says so when there were any.

### `reconcile` keeps the whole engine equal to the document

`reconcile(previous, next)` returns, besides the topology commands of ADR-0026, the commands that make the engine's producers, channels and settings those of `next`, by the ids of the document, because a producer and a consumer are not a broker's names and a rename of one is not a new thing.
`null` is still an engine with nothing in it, and so starts with `sim.configure`, which the engine takes twice with the same effect.

- **A producer** that is new or has changed anything the engine keeps is a `producer.set` (its target by the name of the exchange, or of the queue, whose default exchange it is published through; its message; its burst; whether it repeats and how often), and one that is gone is a `producer.remove`. A change of
  the message or of the burst does not move a tick that is waiting; a change of the interval does.
- **A consumer** is a channel named by its id. It is a `channel.open` with its prefetch and the time that it takes, and a `basic.consume` for each queue that it is subscribed to, with the tag `<channel>/<queue>`. A removed subscription is a `basic.cancel`, a removed consumer a `channel.close`,
  a change of prefetch or of time a `channel.set`, and a change of the ack mode a close and an open ([ADR-0053](0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md)). A queue that is deleted and declared again, which is what a rename or a change of a flag is
  (ADR-0026), has lost its consumers in the engine, so the consumers that the next document still subscribes to it consume again.
- **The order** is the one in which each command is valid for what the ones before it made: unbind, producers that go, subscriptions and channels that go, delete, declare, bind, channels and subscriptions that come, producers that come or change, and the settings.
- **The settings** are the seed and the three latencies of the canvas, `sim.configure`, and the engine's own `timing` is theirs.
- **The property of S2 is now about the engine.** After any run of commands, undos, redos and loads, an engine that was fed by `reconcile` holds the topology, the producers and the channels of the document, which it says in `view()`, and an engine that went through the whole run holds the same as one
  that was made from the end document alone. The oracle in `@rmq/testing` that stood in for the engine is no longer needed, and goes.

### The replay holds the runtime too

The property of ADR-0046 plays what the app can do (now with the runtime commands among them, and with steps of the clock, which are `step` commands, since a typed line cannot say "an hour passed"), logs it, and types the log into a second editor. The two documents are equal, as before, and now the two engines
are: **the same seed and the same runtime commands give the same events**, in the same order, and the same view.

## Consequences

### Positive

- A lesson, a template, a test and a learner all say `publish sender`, and what the learner learned by pressing `P` is in the log as a line that they can type.
- The gesture and the line cannot drift for the runtime, and the property that held it for the canvas holds it for the simulation.
- The engine is always what the document says, so an undo, a load, a rename and a delete need no code of their own in the simulation.

### Negative / trade-offs

- A command that changes the simulation and not the canvas is in the log, which ADR-0046 described as the log of what changed the canvas. The log is the learner's record of what they did, and this is a thing that they did.
- A change of ack mode, and of the name of a queue, loses what was in the engine for that consumer or queue, which a learner may not expect. The message of the undo, and the log, say what was done.
- `scope: 'runtime'` is not what the first sketch of this slice said (`app`). The plan's `CommandSpec` has the third value for this, and `app` would have put `publish` next to `help`.

## Alternatives considered

- **The runtime verbs are not commands, only buttons.** Rejected: ADR-0011 and ADR-0025 promise them, a lesson could not say them, and the log would be missing the lines that explain what the learner just saw.
- **The simulation service is called by the buttons, and the bus only by the bar.** Rejected: two doors are what ADR-0046 was written against, and the property would have nothing to hold.
- **The verbs are `scope: 'app'`.** Considered, and refused for the reason above.
- **The simulation starts stopped.** Rejected: a learner who presses `P` and sees nothing moves would have to find out why. The tests pause it, and a template of S11 can say `pause` at its start.
- **`reconcile` compares the engine's own state.** Rejected again, as in ADR-0026: the document is the only thing that can be diffed without the engine, and the property proves the two equal.

## Related

- [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0025](0025-the-command-grammar.md), [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md), [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md),
  [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md), [ADR-0046](0046-the-equivalent-command-log-and-the-tests-that-hold-gestures-and-commands-together.md).
- [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md), [ADR-0053](0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md).
- [`docs/commands.md`](../commands.md), generated from the registry. [M1 plan](../plans/m1.md), sections 2.3 and 3 (S6).

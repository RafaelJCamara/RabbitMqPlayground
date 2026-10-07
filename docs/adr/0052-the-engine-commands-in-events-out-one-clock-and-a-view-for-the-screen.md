# ADR-0052: The engine: commands in, events out, one clock, and a view for the screen

- **Status:** Accepted. The records of its view have no prototype, and a message in the broker says which producer sent it, by [ADR-0057](0057-what-building-s6-settled-folders-that-run-one-way-a-strip-that-is-a-region-frames-that-cannot-jump-and-colours-read-through-a-probe.md).
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0007](0007-deterministic-simulation-engine.md) (a pure, deterministic, discrete-event engine), section 2.2 of the [M1 plan](../plans/m1.md) (the sketch of `createEngine`) and
  [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md) ("the engine's command types are in `@rmq/engine`", whose `dispatch` S6 writes), for what S6
  ([#8](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/8)) had to decide to build them.

## Context

ADR-0007 fixes the style: a priority queue ordered by (virtual time, sequence number), a virtual clock, a seeded PRNG, serialisable commands in and events out, routing in one step, and one fixed latency inside the broker. The plan sketches
`createEngine({ seed, timing })` with `dispatch`, `advanceTo`, `step`, `now`, `view`, `snapshot` and `restore`, and a list of events. It does not say what a step is, which of the three latencies a message pays where, what an event carries, how a message is
numbered, what the screen reads, or what a snapshot is. S1 gave the engine `route()` and the types of the topology commands. [ADR-0050](0050-the-simulator-has-no-connections-a-consumer-owns-a-channel-and-a-refusal-is-a-result.md) says what a refusal is, and
[ADR-0053](0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md) how a queue gives a message to a consumer.

## Decision

### The shape

- **`createEngine({ seed, timing, vhost? })`** answers an `Engine` of plain functions, in `@rmq/engine`, which imports nothing and reads no clock, no timer and no global (the lint of ADR-0018 holds it). `timing` is `{ publishMs, brokerMs, deliverMs }`, and `vhost`
  is `/` unless the canvas says otherwise. The engine runs on the main thread, and nothing in its API is a function, a handle or a class instance, so that it can move to a Web Worker without a change: commands go in, events and plain views come out.
- **The methods:** `dispatch(command)`, `advanceTo(time)`, `step()`, `now()`, `nextAt()`, `view()`, `flights()`, `messages(queue, limit)`, `snapshot()` and `restore(snapshot)`.
- **The commands** are the topology commands of ADR-0026 (`exchange.declare`, `exchange.delete`, `queue.declare`, `queue.delete`, `bind`, `unbind`) and, named like the conformance steps, `queue.purge`, `channel.open`, `channel.set`, `channel.close`, `basic.consume`,
  `basic.cancel`, `basic.ack` and `basic.publish`, and the commands of the simulation itself: `producer.set`, `producer.remove`, `producer.publish`, `sim.configure`, `sim.clearMessages` and `sim.resetCounters`. A channel is named by a string that the caller chooses,
  and so is a consumer tag and a producer. Exchanges and queues are named by their names, as the broker has them.
- **`dispatch` answers** `{ ok: true, events }` or `{ ok: false, code, text, events }` ([ADR-0050](0050-the-simulator-has-no-connections-a-consumer-owns-a-channel-and-a-refusal-is-a-result.md)). A declaration that repeats, an unbind of nothing and a delete of what is not there are accepted
  and change nothing ([ADR-0051](0051-a-declaration-that-repeats-is-idempotent-an-unbind-of-nothing-changes-nothing-and-a-406-names-the-attribute.md)).

### One clock

- **Time is whole virtual milliseconds.** `now()` starts at 0. `advanceTo(t)` takes a number, floors it, never goes back, runs every scheduled event that falls at or before it in the order of (time, sequence number), and leaves `now()` at `t`. `step()` runs the
  **one** event that is next, puts `now()` at its time, and answers what it did. The caller owns the fraction of a millisecond, so that the engine's clock never depends on what a frame took.
- **`dispatch` runs nothing that is scheduled.** It does what the broker does at once, which takes no time: a message that an ack or a new consumer or a closed channel makes deliverable is delivered, inside the command, and its events are in the answer. What takes time is
  put on the heap: the arrival of a message at the broker, its arrival in a queue, its arrival at a consumer, the end of a consumer's work, and the next publish of a producer that repeats. Every one of those emits at least one event when it runs, so a step is always something to see.
  The heap holds data, not functions, so it is part of a snapshot.
- **The latencies are the plan's, and ADR-0007's:**

  | Leg | Takes | Notes |
  |---|---|---|
  | A producer to the broker | `publishMs` | none for a `basic.publish` that no producer sent, which is already there |
  | Inside the broker, from the arrival to the queues | `brokerMs` | the same on every path, so that the order in a queue is the order of arrival |
  | The broker to a consumer | `deliverMs` | counted from the moment that the broker gives it away, which is when it counts against the prefetch |
  | A consumer handling a message | the channel's `processingMs` | one message at a time, in the order they arrived, and `null` for a channel that handles nothing by itself, and is told to ack: the consumers of the conformance scenarios |
  | An acknowledgement | nothing | it reaches the broker at the time that the consumer sends it |

  A change of `timing` is a `sim.configure` and applies to what is sent after it: what is on its way keeps the times that it was given. A message is routed **when it arrives**, with the topology that the broker has then, so a queue that is gone by the time the message gets to it
  is a `dropped`, and an exchange that is gone is a `refused`, which is what a broker does with a message that was on the wire.
- **The PRNG is held and nothing draws from it.** M1 has no failures, no jitter and no random keys, and the order of events that happen together is the order that they were scheduled in, which is a total order. The seed of the canvas is the engine's (`sim.configure`
  reseeds), its state is in the snapshot, and the first slice that draws a random number draws it from here. This is said so that nobody looks for a use that is not there.

### Events

Every event is a plain object with `type`, `seq` (counted from 1 over the life of the engine, and in the snapshot) and `at` (the virtual time). A message is told by the number that the engine gave it, from 1, in the order of publishing, never used twice, not even after a
clear. `published` carries the whole message (`id`, `producer`, `exchange`, `key`, `headers`, `payload`), and the others carry its `id`, because whoever follows the events has the message from that one. A queue is named by its name, a channel and a consumer by the strings that
were given, and the ids of the document are the caller's business (ADR-0026): the app makes a consumer's id the name of its channel.

| Event | When | Also carries |
|---|---|---|
| `published` | a producer or a `basic.publish` sends a message | the message, `arrivesAt` |
| `routed` | it arrives and reaches a queue | `exchange`, `queues`, `paths` (the hops of `route()`), `trace`, `enqueueAt` |
| `unroutable` | it arrives and reaches none | `exchange`, `trace` |
| `refused` | it arrives at an exchange that is not there or is internal | `exchange`, `code`, `text` |
| `enqueued` | its copy reaches a queue, once for each | `queue`, `depth` |
| `dropped` | its copy finds that the queue is gone | `queue` |
| `delivered` | the queue gives it to a consumer | `queue`, `consumer`, `channel`, `redelivered`, `autoAck`, `arrivesAt` |
| `received` | it reaches the consumer | `queue`, `consumer`, `channel` |
| `processed` | a consumer that takes time has finished with it | the same |
| `acked` | a consumer acknowledged it, by itself after its work or by a command | the same |
| `requeued` | an unacknowledged message goes back to its queue as redelivered | `queue`, `consumer`, `channel` |
| `consumer.cancelled` | `basic.cancel`, or its queue was deleted | `consumer`, `channel`, `queue`, `reason` |
| `channel.closed` | a channel was closed | `channel`, `reason`, `requeued` |
| `queue.purged` | its ready messages were removed | `queue`, `count` |
| `queue.deleted` | a queue and what it held went | `queue`, `ready`, `unacked` |
| `cleared` | `sim.clearMessages` | `removed` for each place that held messages |
| `counters.reset` | `sim.resetCounters` | |

`routed` and `unroutable` keep what `route()` made, the paths and the trace, unchanged, because that is what the overlay follows and what S7 explains ([`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md), question 6).

### What the screen reads

- **`view()`** is one plain object of counts that are kept as it goes, so that it costs the number of nodes and not the number of messages: for each queue its `ready`, `unacked`, `enqueued` and `delivered`; for each exchange `routed`, `unroutable` and `refused`; for each producer
  `published` and whether it repeats; for each channel its prefetch, its processing time, what it has `received` and `consumed`, what waits and what is being handled, and for each of its consumers the queue, the ack mode, the unacknowledged count and whether it was cancelled. It
  also has `now`, the seed, the timing, how many messages are travelling, and the topology the engine holds, which is what the property of `reconcile` compares with the document.
- **`flights()`** are the messages that are on the move, read off the heap: each is a leg (`publish`, `broker` or `deliver`), the message, its key, where it goes from and to by name, the hops of the paths for a leg in the broker, and the two times. It is the whole of what the overlay
  draws ([ADR-0055](0055-the-overlay-draws-on-a-canvas-outside-change-detection-and-follows-the-real-paths.md)), and a function of the state, so a restored engine, a cleared one and a step all draw right with no list of sprites to keep in step.
- **`messages(queue, limit)`** lists what a queue holds, ready first and then unacknowledged, for the list of messages and for purge. It is a query and not part of the view, because a queue may hold thousands.
- **`reset counters`** zeroes `routed`, `unroutable`, `refused`, `published`, `consumed`, `enqueued` and `delivered`, and not what a queue holds. **`clear messages`** takes every message out of the engine, those on their way, in the queues, held by consumers and waiting in their
  buffers, and leaves the topology, the producers, the channels and their subscriptions as they are.

### A snapshot is plain, versioned JSON

`snapshot()` is `{ version: 1, seed, prng, timing, vhost, now, next… , topology, queues, channels, producers, heap, counters }`: everything that decides what the engine does next, and nothing that it has only said. `restore(snapshot)` replaces the whole state, checks the version, and
throws a `RangeError` that says what is wrong for a snapshot that it cannot read. An engine restored from a snapshot, given the same commands and the same advances, gives the same events as the one that it was taken from: that is a property, and it is why S10 can share a canvas with its
messages. `JSON.parse(JSON.stringify(snapshot))` is the same snapshot.

## Consequences

### Positive

- A test, a replay of the fixtures, the app and a worker all drive the engine in the same way, by commands and by time, and the same seed and the same commands give the same events, bit for bit, which a property checks.
- The overlay is a pure function of `flights()` and the clock, so that it needs no memory of its own, and a step, a clear and a restore need no special case.
- A step is always visible, so the control that steps has something to show.

### Negative / trade-offs

- `view()` asks the engine for more than the screen needs on some frames. It is cheap, and it is read after a batch of events and not on every frame; `flights()` is read on every frame while something moves, and costs the number of messages on the move.
- The engine keeps counters as it goes, which is state that a snapshot must hold and a property must check against the events.
- Routing at the arrival, and not at the publish, means that a topology change while messages are on the wire has an effect on them. It is how a broker is, and the log says `dropped` or `refused` where it happens.
- A `processingMs` of `null` is a second mode of the same consumer, the scripted one, which only the tests and the replays use.

## Alternatives considered

- **Route at the publish and replay the route as an animation**, as ADR-0007 can be read. Rejected: the broker routes what it receives, a message that is deleted from under itself would have a route that it cannot follow, and the second leg of the overlay would have no honest place to start.
- **`dispatch` runs everything that is due, so that a command is complete.** Rejected: a step would then be a command and a clock at once, and a test could not stop between a publish and its arrival. `advanceTo(now())` is the one call that does it.
- **The overlay keeps its own list of sprites from the events.** Rejected: it would be a second state that has to be kept equal to the engine's through a clear, a close, a restore and a requeue, and a bug in it would be seen and not tested. A function of `flights()` cannot be wrong in that way.
- **Real-valued time.** Rejected: float sums are not the same in every order, and "bit for bit" is the contract.
- **A class with methods.** Rejected: a plain object of functions and plain data crosses a worker as it is.

## Related

- [ADR-0007](0007-deterministic-simulation-engine.md), [ADR-0008](0008-rabbitmq-fidelity-baseline.md), [ADR-0018](0018-workspace-layout-and-dependency-rules.md), [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md).
- [ADR-0050](0050-the-simulator-has-no-connections-a-consumer-owns-a-channel-and-a-refusal-is-a-result.md), [ADR-0053](0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md),
  [ADR-0054](0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md).
- [M1 plan](../plans/m1.md), sections 2.2 and 5.

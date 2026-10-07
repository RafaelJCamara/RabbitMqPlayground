# ADR-0007: Deterministic discrete-event simulation engine

- **Status:** Accepted. The engine as built is settled by [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md), and delivery by [ADR-0053](0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md).
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

The simulator must be **faithful** ([ADR-0008](0008-rabbitmq-fidelity-baseline.md)), **explainable**
([ADR-0010](0010-explanation-first-editor-ux.md)), **testable**
([ADR-0015](0015-testing-strategy-and-definition-of-done.md)) and **smooth**, with hundreds of messages in flight.

The original mixed simulation and rendering in one Processing.js sketch. Messages moved, and routing happened when they
arrived. That design led to timing bugs:

- the first message was delivered to two consumers
  ([#10](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/10));
- messages kept going to a consumer that had been deleted
  ([#18](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/18)).

It also taught a wrong mental model, in which routing happens hop by hop as a message travels.

## Decision

**A pure TypeScript library**
- The engine lives in its own workspace library, with **no Angular, DOM or browser dependencies**.
- It runs the same way in the browser, in a Web Worker and in Node test runners.

**Discrete-event simulation**
- Pending events sit in a priority queue ordered by *(virtual time, sequence number)*, which gives a strict total order.
- A **virtual clock** drives time, and every random choice uses a **seeded PRNG**. Random choices include failure rates,
  randomly chosen routing keys and jitter.
- Same seed + same commands ⇒ the same event stream, bit for bit.

**Commands in, events out**
- **Input:** serialisable **commands** such as `declare`, `bind`, `publish`, `ack`, `cancel`. These are the same
  commands the command layer uses ([ADR-0011](0011-explicit-linking-and-command-layer.md)).
- **Output:** typed, serialisable **events** such as `published`, `routed`, `unroutable`, `enqueued`, `delivered`,
  `acked`, `nacked`, `returned`, `confirmed`, `dead-lettered` and `expired`.
- Routing events carry a full **explanation**: which bindings were considered, the result of each match, and the
  reasons.

**Routing is atomic**
- When a message is published, the engine computes its full set of destinations, following exchange-to-exchange bindings and
  alternate exchanges, in one step.
- The UI then **replays** that route as an animation. Exchanges never hold messages.

**Timing model**
- The time a message spends inside the broker is one fixed latency, the same on every path. This keeps per-queue order
  intact.
- The network legs (producer→broker and broker→consumer) and each consumer's processing time can be configured.

**Pure query functions**
- Routing is also exposed as a function with no side effects. It powers the what-if tester, the route overlay and the
  inline topic tester.

**State**
- The **topology document** can be undone and is saved ([ADR-0012](0012-multiple-canvases-and-local-persistence.md)).
- The **runtime state** (queue contents, messages in flight, counters) can be reset.
- Periodic **runtime snapshots** make it possible to scrub through the timeline (M2).

**Rendering contract**
- The UI subscribes to engine events and interpolates them against the virtual clock (wall time × speed).
- Pause, speed and step act on the virtual clock.
- Reduced motion changes only how events are drawn, never their timing.
- When more than ~500 messages are in flight, the UI groups them under a "×N" badge.

**Threading**
- The engine starts on the main thread. Because commands and events are serialisable, it can move to a Web Worker
  without any change to its API.

## Consequences

### Positive

- Tests are deterministic, golden fixtures are possible, and any bug can be reproduced from its seed and command log.
- Explanations come built in, because they are produced at the moment a decision is made.
- The engine can be tested fast and in isolation, with no UI, and reused by lessons, challenges and code generation.

### Negative / trade-offs

- More design work up front: an event schema, its versioning, and the snapshot strategy.
- Keeping the UI's interpolation in step with the virtual clock needs care, especially when scrubbing.

## Alternatives considered

- **Animation-driven simulation, as in the original.** Rejected: it is non-deterministic, hard to explain, and teaches
  hop-by-hop routing.
- **Running a real broker behind a backend.** Rejected: it would need a server
  ([ADR-0006](0006-client-only-app-dotnet-api-when-needed.md)), it can't be stepped or scrubbed, and it is out of scope
  ([ADR-0014](0014-broker-interop-via-definitions-json.md)).

## Related

- [ADR-0008](0008-rabbitmq-fidelity-baseline.md): the rules this engine implements.
- [ADR-0011](0011-explicit-linking-and-command-layer.md): the command layer.
- [ADR-0015](0015-testing-strategy-and-definition-of-done.md): how the engine is tested.

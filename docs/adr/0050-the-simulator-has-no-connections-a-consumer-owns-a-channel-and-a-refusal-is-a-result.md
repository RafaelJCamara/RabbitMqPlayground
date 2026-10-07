# ADR-0050: The simulator has no connections, a consumer owns a channel, and a refusal is a result

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "Commands in, events out" of [ADR-0007](0007-deterministic-simulation-engine.md), "Delivery" of [ADR-0008](0008-rabbitmq-fidelity-baseline.md) and the refusals of
  [ADR-0021](0021-transient-queues-are-refused.md), [ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md) and [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md),
  and answers question 2 of [`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md).

## Context

The plan's `dispatch` answers `{ ok: false; code; text }` and its events include `channel.closed`. A broker closes the channel that a refused command came on, and the refusal of a transient queue (`541`) closes the whole connection, with
every channel and exclusive queue on it. S1 reproduced the publishes that are refused (`403` and `404`), S2 the declarations and bindings, and the type of a refusal code is `403 | 404 | 406 | 541` so that either answer would fit. S6
([#8](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/8)) gives the engine its dispatcher and its consumers, so it has to say what is open, what a refusal closes, and what the learner sees.

## Decision

- **There are no connections.** Nothing in M1 needs one: exclusive queues are not modelled (ADR-0021, ADR-0024), nobody logs in, and a consumer that is deleted from the canvas is all that a closed connection would stand for. Every recorded refusal keeps
  its `level` in the fixtures, and nothing reads it: the replays check the code and the text.
- **A consumer is a channel.** It is opened when the consumer is on the canvas and closed when it is deleted or restarted. The channel holds the prefetch and the time that the consumer takes to handle a message, and a consumer tag for each queue that the
  consumer is subscribed to, which is what the prefetch is counted by ([ADR-0053](0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md)). The engine names a channel by whatever string it is given, the
  fixtures' `ch1` and the app's id of the consumer alike.
- **A producer has no channel that anything can close.** It publishes, and a publish that the broker refuses when it arrives (the exchange was deleted while the message was on its way, or it is internal) is the event `refused`, with the broker's code and
  text, and the producer goes on. A producer that a refusal had killed would need a "reconnect" that a canvas has no place for, and the refusal is the learner's to mend and not to be locked out by.
- **The declarations of the canvas are made on a channel of the canvas's own**, which no refusal closes: a refused `queue.declare` or `bind` changes nothing and ends nothing, and the next command is as good as the last.
- **A refusal is a result.** `dispatch` answers `{ ok: false, code, text, events }` for a command that the broker refuses, with the code and the text of the functions of `refusal.ts`, which the fixtures check. `events` are what the refusal did, which is
  nothing except for the next point. The `541` of a queue that is not durable is a refusal like any other declaration: it changes nothing, and nothing is closed.
- **A command on a channel that the broker refuses closes that channel.** There are two: `basic.consume` from a queue that is not there (`404`), and `basic.ack` of a delivery that the consumer does not hold (`406 PRECONDITION_FAILED - unknown delivery tag N`,
  seen on 4.3.6, [ADR-0051](0051-a-declaration-that-repeats-is-idempotent-an-unbind-of-nothing-changes-nothing-and-a-406-names-the-attribute.md)). The channel is closed as `channel.close` closes it (what it holds goes back to its queues, redelivered),
  and `channel.closed` says why: `{ kind: 'closed' }` when it was asked for, `{ kind: 'refused', code, text }` when the broker did it. The app never makes either command wrongly, so the second is for scripts, tests and the day that a worker sends commands that the page did not check.
- **A message that no client could send is a mistake of the caller, and throws a `RangeError`**: a routing key of more than 255 bytes, or a header value that is not exact. It is `route()`'s rule, and the commands of the domain refuse them before they get here.
- Question 2 is answered and leaves `OPEN_QUESTIONS.md`.

## Consequences

### Positive

- One word for what is closed, and it is the one that the plan and the fixtures use. `channel.closed` has something to carry, and the app can say why a consumer stopped.
- A refusal is data. The overlay, the log and the tests read it as they read an event, and a script of commands does not have to catch anything.
- The producers of a canvas cannot be left dead by a mistake that the learner can mend in a second.

### Negative / trade-offs

- A learner who wants to see "the connection closes" cannot: the simulator does not have the thing that closes. If M3 adds exclusive queues and lifecycles, connections arrive with them, with their own ADR, and `level` is already in the fixtures.
- A refused publish does not stop the producer, where a real client would see its channel closed and would have to open another. That is the kind side of the difference, and the log says `403` or `404` where it happens.

## Alternatives considered

- **Connections, with channels inside them.** Rejected: nothing in M1 can be shown by them, they would be a node or a hidden list that every consumer and producer points at, and a refusal that closed a connection would take every consumer that was made from the same canvas
  with it.
- **Close the producer's channel when a publish is refused.** Rejected: see above. The `refused` event says everything that the broker says.
- **Throw for a refusal.** Rejected, as in ADR-0026: a refusal is an expected answer, and a UI shows it.

## Related

- [ADR-0007](0007-deterministic-simulation-engine.md), [ADR-0008](0008-rabbitmq-fidelity-baseline.md), [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md).
- [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md): the engine; [ADR-0053](0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md): delivery.
- [M1 plan](../plans/m1.md), section 2.2.

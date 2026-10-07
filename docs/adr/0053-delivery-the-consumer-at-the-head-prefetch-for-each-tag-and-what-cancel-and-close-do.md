# ADR-0053: Delivery: the consumer at the head, prefetch for each tag, and what cancel and close do

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "Delivery" (rules 13 to 16) of [ADR-0008](0008-rabbitmq-fidelity-baseline.md) and "Dispatch" of section 2.2 of the [M1 plan](../plans/m1.md), for what S6
  ([#8](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/8)) had to decide to write them, with the 14 delivery fixtures as the evidence.

## Context

ADR-0008 says that each message goes to one consumer, that consumers with room are served in turn, that prefetch is per consumer and ignored by a consumer that acknowledges by itself, and that cancel keeps what a consumer holds while close gives it back as redelivered. The plan adds
that the consumer at the head is served and then goes to the back, that a blocked consumer rejoins at the tail, and that prefetch is counted for each consumer tag. It does not say when a consumer becomes blocked, where a requeued message goes back to, what a consumer does with a message
while it is handling another, or what the app does when a learner changes a consumer. The five fixtures of S0 settled little, so nine more were recorded on the pinned image ([ADR-0051](0051-a-declaration-that-repeats-is-idempotent-an-unbind-of-nothing-changes-nothing-and-a-406-names-the-attribute.md)),
and one of the plan's own sentences did not survive them as it was written.

## Decision

### Who gets the next message

- **Each queue has a turn: an ordered list of the consumers (tags) that can be given a message.** A consumer that starts consuming goes to the back of it. While the queue has a ready message, the one at the head is tried. If it has room it is given the message, and goes to the
  back. If it has none it leaves the turn, to be put at the back again when an acknowledgement gives it room, and the next is tried. If the turn is empty, the message stays where it is.
- **A consumer is found to be full only when it is tried.** Its window closing does not take it out of the turn. This is what the broker does, and it is not what the plan says (a consumer that is blocked "rejoins at the tail" is true, but it is blocked later than the plan
  suggests). `acknowledging-does-not-change-the-order-in-which-consumers-are-served` shows it: three consumers that each hold one message and are not tried again are served in their old order after they acknowledge in another, and
  `a-consumer-that-was-full-comes-back-behind-the-others` shows the other half: one that was tried, found full and put out comes back behind the one that was not.
- **Prefetch is counted for each consumer tag**, which is each subscription of a channel to a queue, and not for the channel or for the queue (`prefetch-is-counted-for-each-consumer-of-a-channel`). `0` is no limit. A consumer that acknowledges by itself (`ack: auto`) is not counted at all, and
  is given everything (`auto-ack-ignores-prefetch`). A message counts against the window from the moment that the broker gives it away and not from the moment that it arrives, so a slow network does not let a consumer take more than its prefetch.
  A change of prefetch applies to every consumer of the channel at once, where a broker applies it to the ones that start later, and it never takes back what was given.
- **What a consumer is given is out of the queue.** For a manual consumer it is held, unacknowledged, until it acks. For an automatic one it is gone from the broker, and what the consumer has not finished with is the consumer's own, in its buffer. This is what makes the lesson of
  the second tutorial visible: with automatic acknowledgement a slow consumer is given as many messages as a fast one, and they wait in it, and with a manual one and a prefetch of 1 it holds one and the rest stay in the queue.
- **A consumer that joins late is served in its turn** (`a-consumer-that-joins-late-takes-its-turn`), and a message is delivered once from each queue that has a copy (`each-queue-has-a-copy-and-each-copy-goes-to-one-consumer`).

### What a consumer does with it

- **A consumer takes one message at a time**, in the order they arrived, and the time that each takes is the channel's `processingMs`. When it is done, a manual consumer acks, at that time, and the broker gives it the next message that it has room for. A consumer with a prefetch
  above 1 therefore has a message ready when it finishes one, which is what a prefetch is for, and a prefetch of 1 costs the time that a message takes to arrive. The messages that have reached it and wait are the `waiting` of the consumer in the view.
- **A channel with `processingMs: null` handles nothing by itself.** It holds what it is given until it is told to ack. It is how the conformance scenarios consume, and it is what a test uses to hold a consumer full for as long as it wants.

### Cancel and close

- **`basic.cancel` takes the consumer out of the turn and does nothing to what it holds.** Its unacknowledged messages stay with it, it can still ack them, and the messages that the broker had already given it arrive. When the last one is acknowledged the tag is gone. Cancelling a
  consumer that is not there is accepted (`cancel-keeps-unacked-messages`).
- **Closing a channel gives back everything that its consumers hold**, whether they were cancelled or not (`closing-a-channel-requeues-what-a-cancelled-consumer-still-held`): every unacknowledged message goes back to its queue as `redelivered`, **in the place that it had**, which is the order that
  the copies came into the queue in, so that the messages of a closed channel are ahead of what came after them and in their old order (`requeued-messages-go-back-in-their-places`). The redelivered flag stays on the message for as long as it lives. What an automatic consumer had received and not
  finished with is lost, because the broker had already forgotten it. The channel's tags leave every turn, what is on its way to it is called back, and the broker serves the other consumers at once, inside the command (`issue-18-a-removed-consumer-gets-nothing-more`).
- **Deleting a queue** cancels its consumers (`consumer.cancelled`, `queue-deleted`) and takes what it held, with an event that says how much. **Purging** takes the ready messages, and not the unacknowledged ones.
- **What the app asks for.** A consumer on the canvas is a channel named by its id, and each of its subscriptions is a tag named by the channel and the queue. Subscribing is `basic.consume`, unsubscribing is `basic.cancel`, deleting the consumer is `channel.close`, a change of prefetch or of
  processing time is `channel.set`, and a change of the ack mode, which a consumer cannot make on a broker, closes the channel and opens it again, so that what it held goes back to the queue. This is `reconcile`'s ([ADR-0054](0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md)).

### How it is held

- **The properties** of ADR-0015, at 100 runs in the hook and 5,000 in the Nightly run, with a model of the queues that is built from the events and is compared with the engine's own counts after every command: every published message is accounted for (a message ends as refused, unroutable,
  or a copy for each queue that it reaches, and each copy as acknowledged, handed to an automatic consumer, purged, dropped, cleared, deleted with its queue, or still held); no copy is held by two consumers, or delivered again without first being requeued; no consumer holds more than its prefetch;
  nothing is delivered to a tag after it was cancelled, or to a channel after it was closed; and the same seed and commands give the same events.
- **The named regressions** of the original simulator are tests of their own, in the engine and in the browser: **#10**, the first message goes to one consumer and not to both, and **#18**, a consumer that was deleted is given nothing more, and its message is requeued as redelivered.
- **The fixtures are replayed through `createEngine`**, all 14 of delivery and the routing ones, each with the timing at zero and with the timing of a new canvas, and what each consumer received and what each queue holds are compared with what the broker did. Interleaving between consumers
  is not compared, because a real broker does not make it observable.

## Consequences

### Positive

- The order in which consumers are served is the broker's, and it is checked against the broker on 14 cases and not argued from the documentation.
- A learner can see the difference between a fast and a slow consumer, and between automatic and manual acknowledgement, which is the main thing that a work queue teaches.
- The messages of a consumer that is deleted go back where they were, so that nothing is lost and nothing is served out of order, and the learner sees them redelivered.

### Negative / trade-offs

- A consumer that handles messages one at a time, with an acknowledgement that takes no time to arrive, is a model of a consumer and not of every consumer: one with a thread for each message would have a prefetch that is also its concurrency. The simulator teaches the other half.
- A change of ack mode restarts the consumer, and a learner who flips it sees its messages go back and come again as redelivered. It is the honest picture, and a surprise the first time.
- A change of prefetch applies at once to consumers that already exist, where a broker applies it to those that start later. A learner who tries it on a real broker will find it slower to take effect.

## Alternatives considered

- **Take a consumer out of the turn when its window closes.** What the plan says. Rejected, with the two fixtures that show the broker not doing it.
- **One window for the channel.** Rejected by `prefetch-is-counted-for-each-consumer-of-a-channel`.
- **Process every message that arrives at once.** Rejected: a prefetch of 5 would be five workers, and the lesson of a prefetch of 1 against a prefetch of 5 would be lost.
- **Put a requeued message at the back, or at the front of the queue.** Rejected by `requeued-messages-go-back-in-their-places`: the broker puts it back in its place.

## Related

- [ADR-0008](0008-rabbitmq-fidelity-baseline.md), [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0050](0050-the-simulator-has-no-connections-a-consumer-owns-a-channel-and-a-refusal-is-a-result.md),
  [ADR-0051](0051-a-declaration-that-repeats-is-idempotent-an-unbind-of-nothing-changes-nothing-and-a-406-names-the-attribute.md), [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md).
- The original simulator's [#10](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/10) and [#18](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/18).
- RabbitMQ: `deps/rabbit/src/rabbit_queue_consumers.erl`.

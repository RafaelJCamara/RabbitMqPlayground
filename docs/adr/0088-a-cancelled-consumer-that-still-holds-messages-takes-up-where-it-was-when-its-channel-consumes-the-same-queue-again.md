# ADR-0088: A cancelled consumer that still holds messages takes up where it was when its channel consumes the same queue again

- **Status:** Accepted. What the consumer is when its tag is taken again ("takes up where it was") is superseded by [ADR-0089](0089-a-tag-taken-again-after-a-cancel-is-a-new-consumer-whose-window-starts-at-nothing-and-counts-every-ack-under-the-tag.md), and the rest stands
- **Date:** 2026-10-09
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0008](0008-rabbitmq-fidelity-baseline.md) (rule 16, cancel against close), [ADR-0050](0050-the-simulator-has-no-connections-a-consumer-owns-a-channel-and-a-refusal-is-a-result.md) (a consumer is a channel, and a tag is `<consumer>/<queue>`), [ADR-0053](0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md) (what cancel leaves) and [ADR-0054](0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md) (`reconcile` makes only commands that are valid for the engine).

## Context

- `basic.cancel` leaves what the consumer holds with it (rule 16). The consumer is gone from the engine only when the last message that it holds is acknowledged, and until then its tag is in the engine, flagged `cancelled`.
- `reconcile` names a tag `<id of the consumer>/<name of the queue>`, the same string every time that the canvas says that the consumer is subscribed to that queue. An undo and a redo of a subscription, or a link that is deleted and made again, is therefore a `basic.cancel` and later a `basic.consume` with one tag.
- The engine refused every `basic.consume` for a tag that was in it at all, with a `RangeError`. For a consumer that acknowledges by hand and holds a message, the second command threw, and `reconcile` is held to make only commands that are valid for the engine as it is (ADR-0054, and the app's `feed`, which throws on a refusal, as for a bug, and lets a `RangeError` through as it is).
- The Nightly of 2026-10-09, with a random seed (1791540518, 5,000 runs), found it: the property "reconcile keeps the engine equal to the document, with messages on their way and held by consumers when the canvas changes" failed after 1,816 scripts. Its smallest case is a queue with a name of 255 characters, a manual consumer that is subscribed, messages published and held, two undos and a redo (the example test in `reconcile.spec.ts`). A learner reaches it with a consumer that acknowledges by hand, the clock stopped between "received" and "finished", and the link of the consumer deleted and made again.

## Decision

- **A `basic.consume` for the tag of a consumer that was cancelled, and still holds messages, takes that consumer up again, where it was**, when the channel, the queue and the way of acknowledging are the same as before. It stops being cancelled, goes back into the turn of its queue, and keeps what it held, which counts against its prefetch as before, so that it is given more only when it has room. Nothing is emitted for it: `consumer.cancelled` was said when it was cancelled, and the command log has the subscription.
- **Every other use of a tag that is in the engine is a mistake, as before**, and throws the same `RangeError`: a consumer that is not cancelled, and a cancelled one asked for from another channel, for another queue or in another way of acknowledging. A cancelled consumer that held nothing is gone at once, so its tag is free for anything.
- **`reconcile` does not change.** It works from two documents and cannot know what the engine holds, which is why the engine takes the command that it will make.

## Consequences

### Positive

- The property holds again, and so does the promise of ADR-0054 for this case: whatever the canvas goes through, the commands that `reconcile` makes are valid.
- Nothing moves: no message is put back, no task that is on its way is called back, and the snapshots and their checks (ADR-0077) are not touched, because tags stay unique by name.
- It is a small change, held by four tests in `delivery.spec.ts`, one in `reconcile.spec.ts`, and the property that found it.

### Negative / trade-offs

- **RabbitMQ does it a little differently, and that has not been recorded.** In the broker a consumer that starts with a tag that a cancelled consumer had is a new consumer: the old deliveries stay unacknowledged on the channel, and the prefetch of the new one starts at none. Here it is the same consumer, so what it held counts against its prefetch. The same messages go to the same consumers except at the edge of the prefetch, where the broker would give the new consumer a full window and this gives it what is left. A scenario for the conformance recording (a manual consumer holding messages, cancel, consume with the same tag, publish more) would settle it, and is not in `fixtures/conformance`.
- The log of events does not say that the consumer took up again, because `basic.consume` emits nothing for any consumer. The command log and the view of the channel (`cancelled: false` again) do.

## Alternatives considered

- **Give back what the cancelled consumer held, redelivered, when its tag is taken.** It is what closing the channel does, but it moves messages that a learner is watching, and it needs everything that closing needs: the messages that are on their way, those that wait in the channel and the one that is being handled, called back one by one.
- **Let a cancelled consumer and a new one share the tag, the old one retired under another key.** The engine, its snapshot and the strict check of a snapshot that comes in a link (ADR-0077) are keyed by tag, and each would change for a case that this solves with one condition.
- **Make `reconcile` name the tag with a count.** It could not: it has two documents, and the count would have to come from what the engine holds.
- **Answer with a refusal of the broker, not a throw.** The property and `feed` ask that `reconcile` never meets a refusal, and a channel that is closed by a refusal would take everything else that the consumer holds with it.

## Related

- [ADR-0008](0008-rabbitmq-fidelity-baseline.md), [ADR-0050](0050-the-simulator-has-no-connections-a-consumer-owns-a-channel-and-a-refusal-is-a-result.md), [ADR-0053](0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md), [ADR-0054](0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md), [ADR-0077](0077-a-share-link-is-v1-and-the-deflated-envelope-in-base64url-it-fails-in-words-and-its-messages-are-checked-before-they-are-restored.md).
- The Nightly that found it: run 37915699909 on `8138ccc`.

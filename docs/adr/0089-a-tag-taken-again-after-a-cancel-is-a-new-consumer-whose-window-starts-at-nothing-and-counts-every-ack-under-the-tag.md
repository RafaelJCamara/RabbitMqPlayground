# ADR-0089: A tag taken again after a cancel is a new consumer whose window starts at nothing and counts every acknowledgement under the tag

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** @RafaelJCamara
- **Supersedes:** the choice of [ADR-0088](0088-a-cancelled-consumer-that-still-holds-messages-takes-up-where-it-was-when-its-channel-consumes-the-same-queue-again.md) that the consumer "takes up where it was". What ADR-0088 settled stays: the command is accepted and not refused, for the same channel, queue and way of acknowledging, and any other use of a tag that is taken is a `RangeError`.
- **Extends:** [ADR-0008](0008-rabbitmq-fidelity-baseline.md) (rules 15 and 16, prefetch and cancel), [ADR-0053](0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md) (prefetch is counted for each tag) and [ADR-0077](0077-a-share-link-is-v1-and-the-deflated-envelope-in-base64url-it-fails-in-words-and-its-messages-are-checked-before-they-are-restored.md) (the check of a snapshot).

## Context

- ADR-0088 let the engine take a cancelled consumer that still holds messages up again when its channel consumes the same queue under the same tag, and said in its own words that "RabbitMQ does it a little differently, and that has not been recorded", with a conformance scenario to settle it.
- It was recorded on 2026-10-09 against RabbitMQ 4.3.6 (the pinned image, a classic queue, a channel with a prefetch of 1). Three scenarios are in `fixtures/conformance/4.3/delivery/`, and they say:
  1. A manual consumer `c1` holds `m1`. It is cancelled and its channel consumes the queue again under `c1`. **The broker gives the new consumer `m2` at once**, although `m1` is not acknowledged, and then gives it nothing more (`m3` waits). The new consumer is a new consumer, with an empty window.
  2. The same, and then `m1` is acknowledged: **`m3` is given.** The broker counts the acknowledgement of a message that the old consumer held against the new consumer, because the count is made by the tag.
  3. The same, but `m1` is acknowledged before anything else is published: **`m2` and `m3` are both given**, with a prefetch of 1. The count does not stop at nothing. It is the deliveries to the tag since the tag was taken, less the acknowledgements under it, and it can be below nothing. (Probes with a prefetch of 2 gave three messages in the same case.)
- The engine of ADR-0088 would give `m2` to the new consumer only after `m1` was acknowledged, and so differs from the broker in the first case, and in the others.

## Decision

- **A tag that its channel consumes again, in the way that ADR-0088 allows, is a new consumer that starts with an empty window.** What the old consumer held is still held by the tag, can still be acknowledged (by order or by number) and is given back when the channel closes, as before. It is not counted against the prefetch of the new consumer when the tag is taken.
- **The window is what the tag holds less `uncounted`**, a number of the tag: the messages that it held when it was taken again. A tag that is made new has `uncounted` 0, so nothing changes for it. An acknowledgement of any message under the tag, the old consumer's included, takes one off what is held and so one off the window, which **can be below nothing**, as in the broker (case 3). Clearing the messages sets it to 0 with everything else that is held.
- **Taking the tag again sets `uncounted` to what the tag holds then**, so a consumer that is cancelled again before it has settled what it held and is then consumed again counts from nothing again.
- **The snapshot carries `uncounted` only when it is more than 0**, so every snapshot, link and golden file that was made before this decision is the same bytes and is read as it was. The reader of a link (`readSnapshot`) knows the field as a whole number, and the engine's check of a snapshot (`snapshotIssue`) asks that it is not more than the number of copies that the tag's queue has given out, which is the most that a consumer could have held.
- **The conformance harness can start a consumer again under its name once it is cancelled**, on the same channel, queue and way of acknowledging (a scenario that does it elsewhere is refused by `validateScenario`, because the engine refuses it too). The session keeps what the name was given and has not acknowledged across the two, so that an acknowledgement by name finds the oldest, as the broker's channel does.

## Consequences

### Positive

- The engine does what the broker did in the three recorded scenarios, and the replay of the fixtures (`fixtures.spec.ts`, `conformance.spec.ts`) holds it from now on, with the live run (`npm run test:conformance`, and the Nightly) checking that the broker still does it.
- The promise of ADR-0054 and ADR-0088 holds still: whatever the canvas goes through, `reconcile` makes only commands that are valid for the engine. `reconcile` does not change.
- It is a small change: one number for each tag, one comparison in `hasRoom`, one line in `consume`, one in the clearing of messages.

### Negative / trade-offs

- **A consumer can hold more than its prefetch**, because what it held before is not counted: with a prefetch of 1 the consumer can hold two messages ("holds 2 of 1" in the counter of a consumer on the canvas). That is true to the broker and it is true to the counter, and it needs a sentence if a learner asks.
- **The window can be below nothing**, which reads as a quirk of the broker and is not an invention. It is reached only by a consumer that is cancelled and consumed again under its tag while it holds a message, and then acknowledges what it held: an undo and a redo of a subscription, or a link that is deleted and made again, while a message is held and the clock is stopped.
- The log of events does not say that a consumer started again, as for any `basic.consume` (it emits nothing).
- The conformance scenarios record a classic queue. A quorum queue may count differently, and M1 has only classic queues.

## Alternatives considered

- **Keep ADR-0088 and write down the difference.** It was a sentence in an ADR, and a learner who watched the canvas would see a consumer wait for an acknowledgement that a broker would not wait for, in the very case that a learner reaches by undoing a link.
- **Remember the old consumer's messages as a list of copies, not counted until acknowledged, and give no room for their acknowledgement.** It is what the first version of this change did, and the recording disproved it: the broker takes one off the count for any acknowledgement under the tag.
- **Stop the window at nothing.** Case 3 disproves it.
- **Retire the old consumer under another key and give the tag a new state.** The engine, its snapshot and the strict check of a snapshot that comes in a link are keyed by tag, and every one would change (and a link written by the new engine would not read in the old one). One number does the same, and a link without it reads as before.

## Related

- [ADR-0008](0008-rabbitmq-fidelity-baseline.md), [ADR-0053](0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md), [ADR-0054](0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md), [ADR-0077](0077-a-share-link-is-v1-and-the-deflated-envelope-in-base64url-it-fails-in-words-and-its-messages-are-checked-before-they-are-restored.md), [ADR-0088](0088-a-cancelled-consumer-that-still-holds-messages-takes-up-where-it-was-when-its-channel-consumes-the-same-queue-again.md).
- The recording: `delivery/a-tag-taken-again-after-a-cancel-starts-with-an-empty-window`, `delivery/a-tag-taken-again-is-given-room-by-an-ack-of-what-the-old-consumer-held` and `delivery/a-tag-taken-again-has-a-window-below-nothing-when-the-old-message-is-acked-first`.

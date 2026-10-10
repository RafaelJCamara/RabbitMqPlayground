# ADR-0104: A new consumer acknowledges by hand, so that its prefetch holds it to what it says

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0053](0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md) (prefetch is counted for each consumer, and an automatic consumer is given everything). It is built on [ADR-0025](0025-the-command-grammar.md) (the commands that make a consumer and set it) and [ADR-0008](0008-rabbitmq-fidelity-baseline.md) (rule 15). The engine and the conformance fixtures are not touched.

## Context

- A learner who added a consumer, set its **Prefetch** to 1 and published several messages saw the consumer **take all of them**: "it's getting all the messages from the queue. That's not how it works."
- It is not a defect of the engine. A new consumer was made with `ack: 'auto'` (`NEW_CONSUMER`), and RabbitMQ **ignores prefetch for a consumer that acknowledges automatically** (ADR-0008 rule 15, ADR-0053, the recorded fixture `fixtures/conformance/4.3/delivery/auto-ack-ignores-prefetch.json`): the broker gives it everything and the messages wait in the consumer. With `ack: 'manual'` the window holds messages back as the learner expects (`hasRoom` in `engine/queues.ts`). So the engine is faithful, and it surprised the learner, because the control that says Prefetch did nothing on a consumer that had never been told how to acknowledge.
- The fix that was asked for is the default only: no new wording.

## Decision

- **`NEW_CONSUMER` is `{ ack: 'manual', prefetch: 0, processingMs: 500 }`.** A consumer that was just added spends half a second on a message and then acknowledges it, and is held to its prefetch. `0` is still no limit, so a new consumer with no prefetch takes what it is given one after another. A learner who sets Prefetch to 1 sees one message held and the rest left in the queue.
- **Saved canvases and share links are not changed**: a document always stores the `ack` of each consumer, so a consumer that was automatic stays automatic. Only a consumer that is made now is manual.
- **The templates follow the new default.** Work Queues already sets `ack=manual prefetch=1` on both of its consumers, and the other five have consumers that are told nothing and so are manual now. Their texts, and the steps of the tour (ADR-0083), were read for a sentence that assumes automatic acknowledgement and none does: "the consumer takes it" is still true.
- **The engine, the fixtures and the commands are not touched.** `set <consumer> ack=auto` is still how a learner chooses the other, and the conformance suite is as it was.

## Consequences

### Positive

- Prefetch does what its label says on the first try, and "a slow consumer with prefetch 1 holds one and the rest stay in the queue" (ADR-0053) can be seen without first changing how the consumer acknowledges.
- Each message of a new canvas now shows as held (unacknowledged) while the consumer handles it, which is what a real consumer with manual acks does.

### Negative / trade-offs

- A learner who wants to see automatic acknowledgement has to set it. The inspector says in words what each choice does.
- A canvas that was built with commands from a script (the lessons of M5, or a learner's own) that added a consumer and never set `ack` now has a manual consumer; its messages are held for half a second.

## Alternatives considered

- **Make the engine hold an automatic consumer to its prefetch.** Not RabbitMQ's behaviour, and the fixture would fail.
- **Leave the default and say in the inspector that prefetch is ignored for automatic acknowledgement.** Asked not to: no new wording.
- **Default the prefetch to 1.** It would change what a new consumer does with every message in the first tutorial; the request was about the acknowledgement.

## Related

- [ADR-0008](0008-rabbitmq-fidelity-baseline.md), [ADR-0053](0053-delivery-the-consumer-at-the-head-prefetch-for-each-tag-and-what-cancel-and-close-do.md), [ADR-0025](0025-the-command-grammar.md), [ADR-0083](0083-the-tour-is-six-steps-in-the-editor-that-the-learner-does-and-the-document-ticks-off-by-whichever-way-of-linking.md).
- Tests: `projects/domain/src/lib/commands/declare.spec.ts` ("add consumer"), `e2e/simulation-screen.spec.ts` ("a consumer that was just added").

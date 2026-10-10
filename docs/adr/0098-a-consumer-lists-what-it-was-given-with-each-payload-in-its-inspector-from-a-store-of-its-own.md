# ADR-0098: A consumer lists what it was given, with each payload, in its inspector, from a store of its own

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0056](0056-counters-stacks-and-slots-are-signals-of-their-own-and-the-controls-are-a-strip-under-the-top-bar.md) (the inspector of a consumer and the lists of the inspector), [ADR-0061](0061-the-event-log-is-a-ring-of-rows-that-puts-a-command-before-what-it-made-and-a-row-selects-what-it-explains.md) (the log listens from the moment that the editor opens, and its rows are of text) and [ADR-0063](0063-the-message-inspector-opens-from-a-row-a-list-or-a-marker-and-says-so-when-its-route-is-gone.md) (a row of a list opens the message).
  It is built on [ADR-0050](0050-the-simulator-has-no-connections-a-consumer-owns-a-channel-and-a-refusal-is-a-result.md) (a consumer owns a channel, and the channel of a consumer is its node's id) and [ADR-0089](0089-a-tag-taken-again-after-a-cancel-is-a-new-consumer-whose-window-starts-at-nothing-and-counts-every-ack-under-the-tag.md) (a tag that is taken again is the same node). The engine is not changed, so the conformance suite is not affected.

## Context

- A learner who publishes a message with a payload and watches it go through the topology could see the payload in the list of a queue (ADR-0056), in the log, and in the message inspector once its row was found. There was no way to see, at the consumer, **what the consumer was sent**: where a message ends, which is the place a person looks for it.
- The data is there. The engine says `published` with the whole message (payload included), then `delivered` for the consumer's channel, and then `received`, `processed`, `acked` or `requeued`. The log keeps them as rows of text, which do not carry the payload as data, and holds the messages of only the last 2,000 published, as one list for the whole canvas.
- A consumer's inspector is the place for it, as the queue's inspector has the messages of the queue.

## Decision

- **A store of its own: `ConsumerInbox`.** It is provided with the explanation (`EXPLAIN_SERVICES`) and listens to the simulation from the moment that the editor opens, as the log does, so that nothing that was given is missing when a consumer is chosen. It keeps:
  - the **messages that were published**, as the engine said them, in a bounded map of 5,000 (as many as the log has rows, `LOG_CAP`), so that a row can say what it carried without depending on the 2,000 of the log;
  - for each consumer, by the id of its node, a list of **rows**, at most **100**, the oldest going first. A row is added for each `delivered` event, with the number of the message, the queue, the virtual time, whether it is redelivered and the message as it was published. It then moves on with the events of the engine for that message and that consumer: **on its way**, **received**, **processed**, **acked**, or **requeued**. An event for a message that has no row is ignored.
- **A message that is given again is a new row.** A message that goes back to its queue and is given to the consumer again (`delivered` with `redelivered`) is another row, marked redelivered, and the older row keeps the state that it had. An event of the engine moves the **latest** row of that message, so the old one is not rewritten. A consumer whose tag is taken again is the same node (ADR-0089), so its list goes on.
- **It follows the canvas.** A canvas that is opened empties the inbox, as it empties the log. A consumer that is deleted takes its rows with it, and an event about a consumer that is not on the canvas gives it no row. The engine is not changed, and the document is not changed: nothing here is saved or shared.
- **The component `rmq-consumer-received`** is in the inspector of a consumer, after its settings. It has a heading **Received** and an ordered list named "Messages received by <name>", **newest first**. Each row is one button, named by its content, that opens the message in the message inspector, with what the row knows of it for the case that the log has stopped holding it (as the list of a queue does, ADR-0063), and that is `aria-current` when that message is the one that is open. A row says the time (in seconds, as the log does), `#number`, the key (`(no key)` when there is none), where the message is, whether it is redelivered, and the **payload** in the face of code, cut at **80 characters** with an ellipsis, `(empty payload)` when there is none, and `(payload no longer kept)` when the inbox does not hold the message any more. Where the 100 are full, it says that the last 100 are kept. With no row it says **No messages received yet.**
- **It is read and not announced.** The list is not a live region, because a burst of messages would be read out message by message. The announcements of the simulation (ADR-0056) are as they were.

## Consequences

### Positive

- A learner sees at the consumer what arrived, the payload of each, and what became of it, and can open any of them in the message inspector.
- The log and its 2,000 are not asked to carry what a node needs, and a consumer that is slow does not make the log hold more.

### Negative / trade-offs

- A second record of the messages exists beside the held messages of the log. It is bounded, at 5,000 messages and 100 rows for each consumer, and both are emptied when a canvas is opened.
- A message that is older than the last 5,000 published has a row without its payload, and says so in words.
- The list is read again each time that something is said in a turn, for the consumer that is chosen; with 100 rows at most that is the whole cost, and it is only paid while a consumer is selected.
- Deleting a consumer and undoing the delete brings the node back without its rows: they are the session's, and the node is a new one for the engine.

## Alternatives considered

- **Read the log.** Its rows are text, and it holds the messages of the canvas as a whole, at most 2,000. A consumer's list would depend on what other consumers and producers did.
- **Show the payload on the node.** A node is a small drawing (ADR-0056), and a payload is as long as the learner wrote it.
- **A new region of the page for "what was delivered".** The inspector of the consumer is where its other numbers are, and a second place would have to be found.
- **Put the rows in the engine's view.** It would change the engine and its snapshot for what is only a view; the conformance suite and the share links would have to carry it.

## Related

- [ADR-0008](0008-rabbitmq-fidelity-baseline.md) (what a consumer is given, and when), [docs/accessibility.md](../accessibility.md).
- Tests: `projects/app/src/app/core/explain/consumer-inbox.spec.ts`, `projects/app/src/app/simulation/consumer-received.spec.ts`, `projects/app/src/app/editor/inspector.spec.ts`, `e2e/simulation-screen.spec.ts` ("what a consumer received, in its inspector") and its axe state in both themes.

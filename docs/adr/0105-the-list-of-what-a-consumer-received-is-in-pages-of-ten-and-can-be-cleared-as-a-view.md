# ADR-0105: The list of what a consumer received is in pages of ten and can be cleared, as a view

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0098](0098-a-consumer-lists-what-it-was-given-with-each-payload-in-its-inspector-from-a-store-of-its-own.md) (the list of what a consumer was given, with each payload, in its inspector). The cap of 100 rows, the rows, their order, the states and "it is read and not announced" are as ADR-0098 has them; this adds the pages, Clear and one state. It supersedes nothing.

## Context

- A consumer that was given 100 messages showed 100 rows in its inspector, one under the other, and there was no way to get rid of them: "there should be a way to clean the messages that a consumer gets, so it doesn't clutter", and "if the consumer gets 100 messages, the 100 messages will be visible in the consumer. We should paginate those."
- "Clear messages" in the simulation bar takes every message that is on its way, ready, held or buffered out of the simulation, and says it with one `cleared` event. The inbox did not read that event, so the rows of the messages that it dropped stayed "on its way" or "received" for good.

## Decision

- **A page has ten rows (`RECEIVED_PAGE`), the newest first**, so the first page is the newest ten. Below the list, when there is more than one page, a `nav` named "Pages of what <name> received" has **Previous** and **Next**, which are the buttons of the app (at least 32 pixels tall, more than the 24 that ADR-0085 asks), switched off at the ends, and the words **"Page 2 of 10 · messages 11–20 of 96"**. With one page there is no `nav`. The note "The last 100 are kept." stays.
- **A page is not a live region (ADR-0098).** The words are text that is read. Changing the page is announced once and politely through the `Announcer` ("Page 2 of 3, messages 11–20 of 25."), and the focus stays on the button that was pressed; when that button has no page left to go to and is switched off, the focus goes to the other one, once the page is drawn.
- **The page asked for is the learner's.** It goes back to the first when another consumer is chosen, and when the list is cleared. It is kept inside the pages that there are. New messages do not change the page number: the rows on a later page shift down as new ones come in at the top, which is what a list that is newest first does.
- **Clear is a button beside the heading "Received".** `ConsumerInbox.clear(id)` empties the rows of that consumer and counts as a change. It is **a view only**: there is no command, no undo and nothing in the log of commands, and the engine, the document, the other consumers and what the queue holds are as they were. The button is switched off while there are no rows, and its title says why ("There is nothing to clear: no messages have been received.") or what it does ("Empties this list. The messages and the simulation are not changed."). After it the list says "No messages received yet.", the page says "Cleared what <name> received." politely, and the focus goes to the heading (which can take it), since the button has nothing to do now. What the engine says later of a message whose row was cleared is ignored, and what the consumer is given afterwards starts a new list.
- **"Clear messages" marks the rows that it took away as `cleared`.** On a `cleared` event the inbox marks every row of every consumer that was **on its way** or **received** (not yet finished with) as `cleared`, and leaves the finished ones (`processed`, `acked`, `requeued`) as they were.

## Consequences

### Positive

- The inspector of a consumer is as long as ten rows however many messages it was given, and a learner can empty it to look at what comes next.
- The rows no longer say "on its way" about a message that is not anywhere.

### Negative / trade-offs

- A learner who clears a list cannot get it back (it is not in the document), though the log and the message inspector still hold the messages for as long as they do.
- Paging hides the older rows: a learner looks for message 3 on the third page. The heading and the words say how many there are.
- `cleared` is also what a row of a consumer that acknowledges automatically says after "Clear messages" if its message was in the consumer's buffer. The event does not say which consumer, so all the unfinished rows are marked.

## Alternatives considered

- **A scroll with a fixed height.** It hides the same rows, and a keyboard user has to scroll inside a box.
- **Load more at the foot.** The list can only grow to 100, and the learner asked for pages.
- **A Clear that is a command with an undo.** There is nothing to undo that is in the document, and the log of commands is a record of what changed the canvas (as "Clear filters" in the log is not).

## Related

- [ADR-0098](0098-a-consumer-lists-what-it-was-given-with-each-payload-in-its-inspector-from-a-store-of-its-own.md), [ADR-0085](0085-targets-are-24-pixels-nothing-that-stays-is-drawn-over-the-canvas-and-every-screen-is-checked-in-both-themes-from-a-list.md), [docs/accessibility.md](../accessibility.md).
- Tests: `projects/app/src/app/core/explain/consumer-inbox.spec.ts`, `projects/app/src/app/simulation/consumer-received.spec.ts`, `e2e/simulation-screen.spec.ts` ("the list of what a consumer received, in pages and with Clear") and its two axe states in both themes.

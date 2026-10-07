# ADR-0063: The message inspector opens from a row, a list or a marker, and says so when its route is gone

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "Message inspector" of [ADR-0010](0010-explanation-first-editor-ux.md) (open a message from the log or a queue's message list, or by clicking a moving one while paused; payload, headers, properties, the route trace), the inspector of
  [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md) and [ADR-0056](0056-counters-stacks-and-slots-are-signals-of-their-own-and-the-controls-are-a-strip-under-the-top-bar.md) (the messages of a queue, "the payload is whole in the message inspector of S7"), the overlay of
  [ADR-0055](0055-the-overlay-draws-on-a-canvas-outside-change-detection-and-follows-the-real-paths.md) and `QueueMessage` of [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md), for what S7
  ([#9](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/9)) shows about one message.

## Context

A learner wants to open a message from three places that know different things about it. The log has its events and the held message ([ADR-0061](0061-the-event-log-is-a-ring-of-rows-that-puts-a-command-before-what-it-made-and-a-row-selects-what-it-explains.md)), the list of a queue has what the engine holds of it, and a marker on the canvas is a picture that takes no pointer (ADR-0055). The inspector region
shows what is selected on the canvas, and a message is not on it. And the log keeps 2,000 messages, so a message that was published long ago can be opened from a queue that still holds it.

## Decision

### Three ways in, and one choice

- **From a row of the log**: choosing a row that is about a message opens it. **From the list of a queue**: each message of the list is a button (`#3`, its key, a cut of its payload) that opens it. **From the canvas, while the clock is stopped**: a press on a marker opens it.
  All three set the one thing that the inspector reads, the message that is chosen (`ExplainState.chosen`), so that there is one place that says what is open, and a spec for each way in.
- **A press on a marker is found by looking where the last frame drew.** The overlay takes no pointer and stays so (ADR-0055). The editor listens to the press in the capture phase on the canvas's region, before the library, asks the overlay what shape is under the point (`overlayFrame` already says where each was drawn, and now also which messages each stands for), and, if there is one and the clock
  is stopped, opens the message, takes the press (so that the edge under the marker is not also selected) and says so aloud. A shape that stands for several messages (a crowd) opens none, and says that it stands for N and that the log and the list open one. It is for the mouse and the finger only, and an equivalent that a keyboard has is the log and the list, which
  are a few keystrokes away. A press that is not on a marker is the library's, as it was.
- **It is a part of the inspector region**, above what is selected, a section named "Message 3" that is read in its place, closed by its button or by Escape in it, and does not change what is selected: the learner can select a queue and keep a message open, which is how "why didn't it get here?" is asked.

### What it says

- **Properties**, as text in a list: its number, the exchange it was published to (the default exchange is said as such) and the key, the producer (or "you", for a message that was published by a command), the time that it was published, where it is now, and whether it was redelivered. The **payload** is whole, in a box that scrolls, and the **headers** are a list of name, type
  and value (the table that edits them is S8's).
- **Where it is** is worked out from the engine and not from the log: on its way to the broker, in the broker, on its way to a queue, ready in a queue (in what place of how many), held by a consumer and not yet acknowledged, or finished with. A message that went to several queues has a line for each copy. It is read again when the engine says something, and not on every frame.
- **The route is the tree of the explanation** ([ADR-0060](0060-the-explanation-of-a-route-is-one-function-in-the-domain-and-its-text-is-what-the-golden-files-hold.md)) for the topology that routed it: the exchange it was published to, each binding with its verdict, its sentence and, for a topic key, the alignment word by word as a table with the words that matched, the one that did not and the ones
  that were missing, and, for a headers binding, each condition ✓ or ✗ with its reason (S8 deepens that). Below it, the queues that did not get it, each with a button, "Why didn't it get here?", that opens the reasons in place.
  A button, "Show it on the canvas", is the Why? of [ADR-0062](0062-why-is-painted-by-the-adapter-with-classes-from-an-emphasis-and-the-reasons-are-words-on-the-labels.md).
- **A message that has not been routed yet** (it is on its way to the broker) says so, and shows what would happen if it arrived now, under that heading and with the canvas as it is: the route is decided when the message arrives (ADR-0052), and a topology can change before.

### When its route is no longer held

- **The log holds the last 2,000 messages.** A message from the list of a queue that is not among them is opened with what the engine knows of it, which now includes where it was published and what headers it carries (`QueueMessage` has `exchange`, `producer` and `headers`, which the engine already held and the list did not say). The inspector then
  says what it cannot tell (when it was published, and the document that routed it), and **routes the message again on the canvas as it is now, and says that it did**: "Its route is not kept any more. This is where it would go on the canvas as it is now." A message that is in no list and not held is not opened from anywhere, so there is no case for it.
- **A message that the log holds and whose nodes have changed** is explained with the document that routed it, and its marks are put on the canvas as it is: what has gone from the canvas is not lit, and the card says so.

## Consequences

### Positive

- The three ways in end in one place, and the explanation of a message is the same wherever it was opened.
- The canvas needs no new element for a marker, and no pointer on the overlay: the one thing that is added is a question to it.
- A learner can still ask about a message that is long gone from the log, as long as a queue holds it, and is told what is a guess.

### Negative / trade-offs

- The press on a marker is a hit test of the last frame, so a crowd cannot be opened from the canvas, and a marker that moved between the frame and the press is missed. It is optional (the plan), and it is only for a clock that is stopped, where nothing moves.
- A press that is taken by a marker is not a press for the edge or the node under it, which a learner may not expect the first time. The card and the sentence say what happened.
- `QueueMessage` is three fields longer, for a list that has fifty messages at most.

## Alternatives considered

- **Give the overlay a pointer for its markers.** Rejected: it would take every press on the canvas for itself, and then give back the ones that miss, which is the library's job.
- **A DOM element for each message** that is on the move. Rejected in ADR-0055, for the cost.
- **The inspector replaces what is selected.** Rejected: "why didn't it get here?" needs a queue selected and a message open together.
- **A modal dialog.** Rejected by ADR-0010: no modal dialogs for editing, and a message is looked at while the canvas is.
- **Keep the traces of every message.** Rejected in [ADR-0059](0059-a-topic-miss-is-aligned-from-both-ends-and-explainmiss-gives-each-exchange-once.md): the route is a function of the topology and the message.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md), [ADR-0055](0055-the-overlay-draws-on-a-canvas-outside-change-detection-and-follows-the-real-paths.md), [ADR-0056](0056-counters-stacks-and-slots-are-signals-of-their-own-and-the-controls-are-a-strip-under-the-top-bar.md).
- [ADR-0060](0060-the-explanation-of-a-route-is-one-function-in-the-domain-and-its-text-is-what-the-golden-files-hold.md), [ADR-0061](0061-the-event-log-is-a-ring-of-rows-that-puts-a-command-before-what-it-made-and-a-row-selects-what-it-explains.md),
  [ADR-0062](0062-why-is-painted-by-the-adapter-with-classes-from-an-emphasis-and-the-reasons-are-words-on-the-labels.md).

# ADR-0061: The event log is a ring of rows that puts a command before what it made, and a row selects what it explains

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "Explanation" and "Layout" of [ADR-0010](0010-explanation-first-editor-ux.md) (a filterable, colour-coded log in a collapsible bottom panel; a click highlights the path), the log of equivalent commands of
  [ADR-0046](0046-the-equivalent-command-log-and-the-tests-that-hold-gestures-and-commands-together.md) ("S7's event log shows these lines beside the events, from the same store"), the events of
  [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md) and `Simulation.onEvents` of S6, and the folders of
  [ADR-0057](0057-what-building-s6-settled-folders-that-run-one-way-a-strip-that-is-a-region-frames-that-cannot-jump-and-colours-read-through-a-probe.md), for what S7
  ([#9](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/9)) builds first.

## Context

A busy canvas says thousands of events (a burst of a thousand messages is about eight thousand), the learner's own commands are lines of another store with no time on them, and the plan wants the two in one log that is filtered, coloured, virtualised and
cheap. Three things follow from how the pieces report. The bus tells its listeners of a command after the simulation has said what the command made, so a line would come after its own effects. The engine's events name queues and exchanges as they were and producers and consumers by id, and
renames and deletes happen. And a log that a screen reader reads aloud row by row would drown everything else ([ADR-0055](0055-the-overlay-draws-on-a-canvas-outside-change-detection-and-follows-the-real-paths.md)).

## Decision

### Rows

- **A row is `{ seq, at, family, text, message, nodes }`**, plain data. `seq` is one counter for the canvas that is open, from 1, never used twice, and shared by the engine's events and the learner's command lines, so that the order of the log is one order. `at` is the engine's virtual time in
  milliseconds on every row, and the log shows it in seconds to a tenth. A line of a command has the time that the clock had when it was run. A canvas that is opened empties the log and starts it again, as the log of commands does.
- **The text is made when the row is added**, from the names of the canvas that the event is about, and it keeps it. A log is a record: a queue that was renamed or deleted later was called what the row says when it happened. `Simulation.onEvents` tells its listener the events with the document that they are about: the one the engine
  routed with, or, for what a change of the canvas did (a queue that was deleted, a consumer that was closed), the one before the change, which still has the names. A producer or a consumer that has gone is not left as an id.
- **A row names the nodes that it concerns as `kind:name`** for an exchange and a queue and `kind:id` for a producer and a consumer, which is what the filter by node reads, and the number of the message when there is one.
- **The text of an event is its own sentence**, worded for the log (`describeEvent` is the sentence of a step, which is joined to others), with the key and the exchange where they help, and the line of a command is the equivalent command, as written for the log of commands, with what the learner used.

### Order, size and cost

- **A command's line comes before what it made.** The bus tells its listeners after the simulation has said what the command did, so the log keeps what was said in the same turn, and puts the line of the command before the events that it made. What the clock makes between commands has no line.
- **The log keeps 5,000 rows.** The oldest go, the count of what went is kept, and the panel says it ("4,213 earlier rows were dropped") above the list. `seq` goes on counting.
- **Appending a row costs a record, and nothing is worked out for a panel that is closed.** The rows are a ring that is written to in place, and one signal says that it changed, set once for each turn in which the engine said something, which is once for each frame at most. What is on the screen is the part of the filtered list that the
  scroll shows (below), so a burst costs the work of its events and not of its size. A spec counts the signals that a burst sets, and the journey of the 200 nodes and 500 edges holds its three seconds with all three flags on.
- **The log keeps the last 2,000 messages that it saw published**, each with the document that routed it (the one of its `routed`, `unroutable` or `refused` event, and until then the one it was published under) and how far it has got. That is what an explanation is worked out again from
  ([ADR-0059](0059-a-topic-miss-is-aligned-from-both-ends-and-explainmiss-gives-each-exchange-once.md), [ADR-0063](0063-the-message-inspector-opens-from-a-row-a-list-or-a-marker-and-says-so-when-its-route-is-gone.md)), so that a canvas that changed since says what it said at the time. It is its own store and not the rows, which are
  a record of what was said and not a way to ask.

### Filters

- **Four filters, all at once**: by family of event, by node, by message number and by text. The families are *commands*, *publishing* (published), *routing* (routed), *problems* (unroutable, refused, dropped), *queues* (enqueued, purged, deleted), *delivery* (delivered, received, processed, acknowledged, requeued),
  *consumers* (cancelled, closed) and *simulation* (cleared, counters reset), all on to begin with. The text is a case-insensitive part of the sentence. The filter is kept by the log, so that closing the panel does not lose it, and it is a function of the row, which a spec holds on every kind of event.
- **A filter says how many rows it shows and how many there are**, and a filter that shows none says so, with a button that clears it. An empty log says what to do (press P, or play).

### How a row looks without colour alone

- **A row has the colour of its family, a mark of its own shape, and the name of the event as a word.** The colours are the tokens that a producer, an exchange, a queue and a consumer already have, and the two of a problem and a warning (ADR-0032, which `tools/theme/tokens.spec.ts` holds to 3:1 in both themes); the mark is an icon of the family;
  the word is the type of the event (`routed`, `delivered`), which is in the row as text. The lines of commands are set apart by their own mark and the letters of the command in a fixed-width font.

### A row selects what it explains

- **Choosing a row (a click, or Enter on it) does two things**: it **highlights the path** that the row is about on the canvas ([ADR-0062](0062-why-is-painted-by-the-adapter-with-classes-from-an-emphasis-and-the-reasons-are-words-on-the-labels.md)), and, if it is about a message, **opens that message** in the inspector ([ADR-0063](0063-the-message-inspector-opens-from-a-row-a-list-or-a-marker-and-says-so-when-its-route-is-gone.md)). The row is the learner's choice
  until another is chosen or it is let go with Escape or its button. A row that is about no path (a command, a clear) is chosen like any other and highlights nothing, and the sentence that is said says so.

### The panel, and what a screen reader is told

- **A region of its own** (`<section>` named "Event log"), at the bottom of the editor above the command bar, a few rows tall, with its heading, the count, the filters and a close button. It is opened and closed by a button in the strip of the simulation (`aria-expanded`, `aria-controls`) and by the key `E` on the canvas, and
  opening gives the focus to its list, and closing, or Escape in it, gives it back to the canvas.
- **The list is one stop for the keyboard**, a listbox with `aria-activedescendant`: the arrows, Home, End, Page Up and Page Down move through the rows, Enter and Space choose one, and the rows have `aria-posinset` and `aria-setsize`, because only the rows that the scroll shows are in the page. It is not a live region, so that nothing is read when rows
  arrive. **What is said**, once and politely: the row that was chosen (its sentence), and how many rows a filter shows when it changes. The learner who wants the whole log reads it, and the one who wants the news has the status line that every command already speaks.
- **It shows the rows that the scroll shows**: a window of a fixed row height (measured from the first row that is drawn, so that a larger text size is followed), a few rows over, and spaces above and below that make the scrollbar the size of the whole list. It follows the newest row while the scroll is at the bottom, and
  stays where it is when the learner has scrolled up. The window is a function of the count, the height, the scroll and the size of the viewport, which a spec holds.

### What the log needs, and where it lives

- **The log needs both flags**: `explain` for it, `simulation` for the events. Without the simulation there is nothing to say, and the strip that opens it is not there.
- **Two folders, `core/explain/` and `explain/`.** What the strip, the keyboard, the editor and the adapter all read is state and pure parts, which are `core/`'s (ADR-0030): the log, its filters and its window, the held messages, what is chosen, the emphasis and the functions that make it. What is drawn is components, which sit
  between `simulation/` and `editor/` and are hosted by the editor: the panel, the part of the inspector for a message, the tree of an explanation, the testers. The order of the folders is `core`, `canvas/model`, `canvas/overlay`, `canvas/flow`, `command-bar`, `simulation`, `explain`, `editor` (ADR-0057), and the lint and `tools/boundaries/eslint.spec.ts` hold it.

## Consequences

### Positive

- One list, in one order, of what the learner did and what the engine said because of it, with a time on every row, and a command's line is read before its results.
- A burst does not slow the simulation, and a panel that is closed is free.
- A log that outlives a rename or a delete still reads as it did, and what it explains can still be worked out as it went.

### Negative / trade-offs

- The ring forgets the oldest rows, and the held messages forget the oldest messages. Both say so.
- A row's text is frozen, so a learner who renames a queue sees the old name in old rows. It is true, and the filter by node uses the name of the canvas as it is now and so does not find them; a node that was renamed keeps its id for a producer and a consumer, and not for an exchange and a queue, which the engine knows by name.
- The bus tells the log of a command after its events, and the log has to put the line first. If the order of the bus changes, the log has a test that says so.
- Two sentences for an event, the step's and the log's, are two places to word it. They share the names, and each has its spec.

## Alternatives considered

- **Re-word the rows with the canvas as it is now.** Rejected: a deleted node would be an id, and the log would say things that were never true.
- **The rows as a `signal` of an array that is copied for each event.** Rejected: a thousand events in a frame would copy the array a thousand times. A ring and a signal that says that it changed cost the events.
- **A live region for the newest row.** Rejected: ADR-0055, at a rate of eight thousand rows for a burst.
- **A table with a row for each cell of a column.** Rejected: a row is one sentence, a mark and a time, and a listbox of options says that better than a grid.
- **The CDK's virtual scroll.** Rejected: it measures a viewport that jsdom does not have, so that nothing about it could be tested before the browser, and a function of five numbers can.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md), [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md), [ADR-0046](0046-the-equivalent-command-log-and-the-tests-that-hold-gestures-and-commands-together.md),
  [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md), [ADR-0054](0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md), [ADR-0055](0055-the-overlay-draws-on-a-canvas-outside-change-detection-and-follows-the-real-paths.md),
  [ADR-0057](0057-what-building-s6-settled-folders-that-run-one-way-a-strip-that-is-a-region-frames-that-cannot-jump-and-colours-read-through-a-probe.md).
- [ADR-0062](0062-why-is-painted-by-the-adapter-with-classes-from-an-emphasis-and-the-reasons-are-words-on-the-labels.md), [ADR-0063](0063-the-message-inspector-opens-from-a-row-a-list-or-a-marker-and-says-so-when-its-route-is-gone.md), [ADR-0064](0064-the-what-if-and-the-topic-tester-read-the-canvas-and-change-nothing-and-explain-is-one-flag-in-two-halves.md).

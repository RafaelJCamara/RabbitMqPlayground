# ADR-0065: What building S7 settled: the key of the log names both flags, a tester that is open is what is lit, and a tester follows the text that is typed

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0061](0061-the-event-log-is-a-ring-of-rows-that-puts-a-command-before-what-it-made-and-a-row-selects-what-it-explains.md), [ADR-0062](0062-why-is-painted-by-the-adapter-with-classes-from-an-emphasis-and-the-reasons-are-words-on-the-labels.md) and
  [ADR-0064](0064-the-what-if-and-the-topic-tester-read-the-canvas-and-change-nothing-and-explain-is-one-flag-in-two-halves.md), and the table of shortcuts of [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md), for what building the last of S7
  ([#9](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/9)) showed that they had left to the code.

## Context

ADR-0059 to ADR-0064 settled what S7 explains and how, before it was built. Building it, and testing in a browser the half of the flag that needs the explanation alone, showed one place where the code did not say what an ADR said, and six where an ADR had left the choice to the code and the choice
was worth writing down, because the first one that was tried was wrong and nothing failed loudly.

## Decision

### The key of the log names both flags

ADR-0064 says that `E` "does nothing and is not offered while the simulation is off", and gives its row `flag: 'explain'`. The table read one flag, so with the explanation alone the hint bar and the cheat-sheet said a key that did nothing. A row of the table may now name several flags, and is there when all of them are on. The row of `E` names `simulation`
and `explain`. The action still answers `false` when there is no log, which leaves the key to the page, as a second guard.

### What a tester lights comes before everything else that is lit

ADR-0062 says that one thing is lit at a time. The order is now: the what-if tester while it is open and its message can be read; a queue that is selected while a message is chosen; the row or the message that the learner chose; and, while the clock is stopped, the message that was routed last. What a learner is asking
of the tester is what they are looking at, whatever else they chose before it. The card says `What if? To orders with the key "order.new"`, and its button says "Close the tester", and what "let go" does to what a tester lights is to shut the tester. The card is there with `explain` alone, for the tester, and says nothing of messages.

### A tester follows the text that is typed, and not what the document has

The key of a binding is changed when its field is left, in one step of undo (ADR-0044), so a tester that read the document would answer for the key that the binding had, one key behind. The topic tester takes the text of the field as it is typed: in the popover from its own field, and in the inspector from the field that has the cursor, which is the one
field that has a tester at a time, and which has none when the cursor leaves it. A learner can try a pattern before they commit it, and the document is as it was while they do. In the inspector the tester is under the field of a binding of a topic exchange, and not under the others.

### The line that sends a message is offered where a command can say it

`publish <exchange> <message>` names an exchange of the document. The what-if offers the line when the simulation is on, which is when there is a verb to say, and not for the default exchange, which a command does not name. The line is the text that the learner wrote after the exchange, as it was written, so that what they paste is what they tried.

### What is said aloud

The answer of the what-if is a status: a learner who types a message wants the answer, so the live region holds the answer and nothing else, and a sentence that does not change makes no change to the region, so it is not said twice. The topic tester says nothing aloud: its two lists follow the field in the reading order, and a screen reader that spoke every sample at every key would say more
than the key. The card of what is lit says what the canvas shows, in words, and is a labelled group that is read where it is, and not a live region either.

### The window of a long list is padding of an inner wrapper

The log draws the rows that the scroll shows and keeps the room of the others. The first way, padding on the box that scrolls, makes a box of a fixed height taller by its padding in a browser, so a list of five thousand rows was five thousand rows in the page. The room is the padding of a wrapper inside the box, which has `role="presentation"`, and the box has `overflow-anchor: none`, because a browser that anchors the scroll
to a row moves it when the rows that are drawn change. While the list follows the newest event the row that the keyboard is on is the newest one, so that `aria-activedescendant` never names a row that the scroll has taken out of the page.

### The transition of a mark is on what is marked

ADR-0062's tenth of a second is on the elements that carry `data-emphasis` and on no others. A transition on every stroke made a change of theme read, for a tenth of a second, in the colours of the theme before it. A journey holds that it is only there, and not there for a learner who asked for less motion.

## Consequences

### Positive

- A hint is never for a key that does nothing, and a flag half that cannot work is not on the screen, which is what ADR-0064 meant.
- The testers answer for what the learner is typing, and the card says which tool is lighting the canvas.
- The log's cost does not grow with what it holds, and a keyboard user is never on a row that is not there.

### Negative / trade-offs

- The table of shortcuts has one more shape of row, and a row with two flags is read in two places (the hint bar and the cheat-sheet), which a spec of each holds.
- A tester that is open keeps the Why? of a message from the canvas until it is shut, which a learner who forgot that it was open may take for a bug; the card says so, in its title and with its button.
- A learner who types a key in the inspector and does not leave the field has not changed the binding, and the tester says what the text matches and not what the binding does.

## Alternatives considered

- **Leave `E` with `flag: 'explain'` and let the action refuse.** Rejected: it is the bug.
- **A debounce on what the testers answer.** Rejected in ADR-0064, and a what-if on a canvas of 200 nodes and 500 edges is answered, lit and said in its card within the budget of the page, which a journey holds.
- **Padding on the box that scrolls, and a transition on every stroke.** Both were tried and are the two paragraphs above.
- **Say every sample of the topic tester aloud as it changes.** Rejected: it says more than the key.
- **A tester that takes the key from the document.** Rejected: it is one key behind what is typed.

## Related

- [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md), [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md), [ADR-0057](0057-what-building-s6-settled-folders-that-run-one-way-a-strip-that-is-a-region-frames-that-cannot-jump-and-colours-read-through-a-probe.md).
- [ADR-0061](0061-the-event-log-is-a-ring-of-rows-that-puts-a-command-before-what-it-made-and-a-row-selects-what-it-explains.md), [ADR-0062](0062-why-is-painted-by-the-adapter-with-classes-from-an-emphasis-and-the-reasons-are-words-on-the-labels.md),
  [ADR-0063](0063-the-message-inspector-opens-from-a-row-a-list-or-a-marker-and-says-so-when-its-route-is-gone.md), [ADR-0064](0064-the-what-if-and-the-topic-tester-read-the-canvas-and-change-nothing-and-explain-is-one-flag-in-two-halves.md).

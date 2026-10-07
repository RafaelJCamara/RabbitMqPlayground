# ADR-0070: A binding is made from a message by ticking its headers, the live table is the explanation of the draft, and a chip says the mode and the first conditions

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "Bindings built from data" and "Canvas label" of [ADR-0009](0009-headers-exchange-support.md), the chips of [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md) ("a binding with header arguments is a chip
  `headers`, S8 gives it its conditions"), and the message inspector and the sentences of [ADR-0063](0063-the-message-inspector-opens-from-a-row-a-list-or-a-marker-and-says-so-when-its-route-is-gone.md) and
  [ADR-0060](0060-the-explanation-of-a-route-is-one-function-in-the-domain-and-its-text-is-what-the-golden-files-hold.md), for what S8 ([#10](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/10)) draws from messages and on edges.

## Context

ADR-0009 promises three things that come from data and not from typing: "Create binding from this message" (tick the headers of a real message to turn them into conditions), a small live table that shows recent messages against each condition, and a compact chip on the canvas with
the full list on hover. The message inspector of S7 already shows the headers of a message with their types, and says each condition of a headers binding, held or not, with the reason. It has to be settled where the gesture is, what it makes, what "recent" is, what a row of the table
shows and what it is made with (it must not be a second matcher), and how a condition is written in a chip.

## Decision

### Bind from this message

- **It is a section of the message inspector**, "Bind from this message", after the headers of the message, shut until its button is pressed (`aria-expanded`). Every door to a message (a row of the log, a list of a queue, a marker) leads to that inspector, so
  the gesture is reached from all of them. It is in the half of the flag that has messages (ADR-0069).
- **Which headers become rows: the ones that are ticked.** The headers of the message are listed as a table with a tick for each, all ticked, with their names, types and values exactly as the message has them (`n` is the integer 1, `s` is the string "1"). A row is
  made of the name and the value as a command writes it (`formatValue`), so `1`, `1.0`, `"1"` and `true` are kept apart, and a header that is ticked is a condition that the message itself holds.
- **What the target is.** The *exchange* is chosen from the headers exchanges of the canvas, and starts as the one the message was published to when that is a headers exchange, and as the first otherwise. The *destination* is chosen from what the rules allow from that
  exchange (the list that the picker of ADR-0041 offers), and starts as the first queue that did not get the message, so that the binding is one that would have made a difference. The *mode* is `all`.
- **It makes one `bind`, and shows it first**: `bind docs -> pdf x-match=all format=pdf n=1`, as text, under the section. "Create binding" applies that command through the bus, with the origin `inspector`, so it is one step of undo and one line in the log. It then selects the
  new edge, so that the inspector below shows the binding and its editor, where it can be changed (ADR-0066). If the binding is there already the learner is told ("Already bound with those conditions.") and nothing is made.
- **A message with no headers** has nothing to tick: the section says so ("This message has no headers, so there is nothing to make a condition of. Give the producer some in the table under its routing key, publish again, and open the new message") and offers nothing else.
- **A message that went to another type of exchange** (a direct exchange does not read headers) gets a sentence ("This message was published to the direct exchange orders, which does not read headers. The binding is made on the headers exchange you choose, and a message
  published there is checked by it"), and the form is for the exchange chosen. A canvas with **no headers exchange** says so, and has no form.
- **Nothing ticked is a binding with no conditions**, and the sentence says what that is (it matches every message); it is allowed, as it is in the editor (ADR-0068).

### The live table

- **"Recent" is the last ten messages that were published to the exchange, or to an exchange that leads to it through bindings, newest first.** It reads the messages that the log holds (ADR-0061; the last 2,000), keeps those whose exchange is one that can reach this one
  (worked out from the bindings of the canvas), and shows ten, with "the last 10 of 37" when there are more. A message published to another exchange never reached the binding, so it is not in the table.
- **A row is a message, and a column is a condition.** The table has a caption, `th` cells for the columns and for the message of each row. A row has the number of the message and its headers as the grammar writes them, one cell for each condition, and the result.
  A cell says **✓ holds**, **✗ missing**, **✗ value differs**, **✗ type differs** or **– not counted**, with an icon and a word, and the whole sentence of the explanation (the one the message inspector says) as its title. The result is **Matches** or **Does not match**,
  with an icon and the words, and the table says in a sentence under it what the binding asks. Nothing is told by colour alone (WCAG 1.4.1).
- **It follows the draft.** The columns are the conditions of the draft as they are typed, and a row is worked out again when the draft changes, when the canvas changes, and when the log says something (once for each turn in which something was said). There is no timer, and
  nothing is worked out for a table that is not on the screen. A burst of thousands of messages costs one scan of the held messages for each turn while the editor is open, and nothing while it is shut, which a journey on the big canvas holds.
- **It reads the explanation, and it is not a matcher.** A cell is a `ConditionResult` of the engine's `matchHeaders` said by `conditionLine` of `headers-words.ts` (ADR-0060), and the result of a row is the one of the binding as the engine judges it. The domain function
  that makes the table has a property: for any topology and message, the verdict of a headers binding in the table is the one `explainRoute` gives that binding. The words of a cell are the words of the message inspector.
- **It lives in `explain/`**, as a component that is given the model and draws it, and the editor hosts it in the popover, in the inspector and in the section above. Its model is made in the domain, and the choice of the messages in `core/explain/`.

### Chips

| A binding | Its chip |
|---|---|
| `x-match=all`, `format=pdf`, `n=1` | `all · format=pdf · n=1` |
| `x-match=any`, `s="1"`, `f=1.0`, `exists(g)` | `any · s="1" · f=1.0 · exists(g)` |
| `x-match` left out, `x-foo=1` | `all · x-foo=1 (ignored)` |
| `all-with-x`, `x-foo=1` | `all-with-x · x-foo=1` |
| five conditions | `all · a=1 · b=2 · c=3 · +2 more` |
| no conditions | `all · no conditions` |

- **A condition is written as the grammar writes it** (`formatCondition`): `n=1` is an integer, `n=1.0` a float, `s="1"` a string, `exists(f)` a header that only has to be there, and a name that needs quotes has them. Which type a value has is in the chip, as it is in the line.
- **The mode is always written, first,** also when `x-match` was left out (it is `all`), as in the chip of ADR-0009. `x-match=` is not repeated: the chip is compact, and the card and the label of the edge spell it.
- **Three conditions at most, then "+N more" in the chip.** A chip is cut at a width like any other, and the count of what is hidden is in the text, where the cut cannot take it. A condition that the mode does not count is followed by `(ignored)`.
- **One chip for each binding between the same two nodes**, in the order they were made, and three chips at most on an edge, then "+N more" (ADR-0044). A text that two bindings share is once.
- **The card shows every chip in full**, one line each, for an edge that has more than it shows: more chips, or a chip whose conditions were cut. It is the same card, with the same rules for hover and Escape (WCAG 1.4.13).
- **The label of the edge says everything**, because the chips are hidden from a screen reader: `Binding from exchange docs to queue pdf, x-match all: format=pdf, n=1`, and `; x-match any: s="1"` for another binding.
- **With `headers` off** a binding that has arguments is the chip `headers`, once, and the label says "with header arguments", as before. A headers binding with no conditions has no chip then.

### Debug names

None are added. A journey reads the table, the chips and the sentences from the page, and the explanation through the two names that S7 added.

## Consequences

### Positive

- A learner can build a binding from a message that did not get where they wanted, in the order that a person would think of it: the message, the headers, the queue.
- The table is the explanation put beside the conditions that are being typed, in the words that the learner will meet in the inspector, and cannot say something else, because there is no second matcher to say it.
- A chip says the mode and the first conditions with their types, and the whole is a hover, a card and a label away.

### Negative / trade-offs

- The live table and the binding from a message need the log, so they are not there with the simulation alone.
- The table reads the last 2,000 messages and shows ten, so a message that is older is not in it.
- A chip with `+2 more` inside it and the edge's own "+N more" are two counts. The first is of conditions, and the second of bindings.
- A canvas that has an exchange which leads to the headers exchange shows messages that are published there, though an upstream binding may stop them. The table is what the binding would do with them, not what reached it.

## Alternatives considered

- **A button on each message of a queue's list.** Rejected: the lists are a button each already, and it would be a second door to the same form; the inspector has the headers and room.
- **Untick by deleting a row.** Rejected: a row that is taken off cannot be got back without typing it, and the message is open beside it.
- **Show the last ten messages whatever exchange they were published to.** Rejected: a message that never reached the binding is not an example of it.
- **Compute the table with a scratch topology and `explainRoute`.** Rejected: a topology for a draft that is not in the document, and a whole route for each row, to get a verdict that `matchHeaders` gives. The property above holds the two together.
- **Write only the keys in the chip, or only `headers`.** Rejected: the chip exists to say what the binding asks, and the types are the lesson.

## Related

- [ADR-0009](0009-headers-exchange-support.md), [ADR-0025](0025-the-command-grammar.md), [ADR-0041](0041-the-five-ways-to-link-share-one-path-and-a-binding-asks-for-its-key-first.md),
  [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md),
  [ADR-0060](0060-the-explanation-of-a-route-is-one-function-in-the-domain-and-its-text-is-what-the-golden-files-hold.md),
  [ADR-0061](0061-the-event-log-is-a-ring-of-rows-that-puts-a-command-before-what-it-made-and-a-row-selects-what-it-explains.md),
  [ADR-0063](0063-the-message-inspector-opens-from-a-row-a-list-or-a-marker-and-says-so-when-its-route-is-gone.md).
- [ADR-0066](0066-a-headers-binding-is-made-in-a-popover-and-edited-in-the-inspector-from-one-draft-and-an-edit-is-one-batch.md),
  [ADR-0067](0067-a-value-is-typed-by-how-it-is-written-one-function-reads-it-for-the-editor-and-the-grammar-and-a-type-is-changed-by-rewriting-the-text.md),
  [ADR-0068](0068-a-row-says-what-is-wrong-under-itself-a-duplicate-stops-the-commit-an-x-key-is-told-by-what-the-mode-does-with-it-and-a-lint-stays-a-lint.md),
  [ADR-0069](0069-the-headers-flag-has-three-halves-the-producers-table-commits-row-by-row-and-s8-adds-no-key.md).
- [M1 plan](../plans/m1.md), sections 3 (S8) and 7.

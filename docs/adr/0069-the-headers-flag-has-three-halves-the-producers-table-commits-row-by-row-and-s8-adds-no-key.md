# ADR-0069: The `headers` flag has three halves, the producer's table commits row by row, and S8 adds no key

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** the flags of [ADR-0004](0004-trunk-based-development-on-main.md), "Producer" of [ADR-0009](0009-headers-exchange-support.md) (a typed table of headers, and the routing key that "is not greyed out"), the composer of
  [ADR-0056](0056-counters-stacks-and-slots-are-signals-of-their-own-and-the-controls-are-a-strip-under-the-top-bar.md), and the way that [ADR-0064](0064-the-what-if-and-the-topic-tester-read-the-canvas-and-change-nothing-and-explain-is-one-flag-in-two-halves.md)
  and [ADR-0065](0065-what-building-s7-settled-the-key-of-the-log-names-both-flags-a-tester-that-is-open-is-what-is-lit-and-a-tester-follows-the-text-that-is-typed.md) split one flag, for what S8 ([#10](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/10)) puts behind `headers`.

## Context

S8 is one flag, `headers`, and it is not one thing. Some of it reads only the canvas (the editor, the chips). The table of a producer's headers is in the composer, which is the simulation's. The live table and the binding made from a message
read messages, which the log holds, and the log needs the simulation and the explanation. S7 found, by writing the journey of the half that has no log, that a hint can offer a key that does nothing; the same can happen here with a button.
The producer's table also has to be committed in some way, and the plan leaves open what the what-if tester gets.

## Decision

### Three halves

| Half | Flags that are on | What is there |
|---|---|---|
| **Conditions** | `editor`, `headers` | The conditions popover when a headers exchange is linked to, the editor in the inspector for the bindings of an edge from a headers exchange, the chips and the label of the edge with the conditions, the sentence, the problems and the notes of the rows, the lint in the editor |
| **The producer's table** | and `simulation` | The table of headers in the composer, and the note under the routing key when the producer publishes to a headers exchange |
| **Messages** | and `simulation`, `explain` | The live table in the editor, and "Bind from this message" in the message inspector |

- **A part needs the flags that give it what it reads, and no more.** The producer's table is in the composer, which is the simulation's (ADR-0056), and the message of a producer, its payload and key included, is edited nowhere else, so the table cannot be there without
  `simulation`. The live table and the binding made from a message read the messages that the log holds (ADR-0061, ADR-0063), which need both `simulation` and `explain`. The first half needs nothing of them: it reads the canvas.
- **What cannot work is not on the screen.** Without `simulation` the editor has no live table and no composer; without `explain` the message inspector, and so "Bind from this message", is not there. Nothing is drawn to say that it is missing, and no button,
  hint or sentence offers what the flags do not give (ADR-0065).
- **With `headers` off nothing of S8 shows.** A link to a headers exchange binds at once with no conditions, the chip says `headers`, the inspector says that header arguments are written with the command bar, and the composer says how many headers a message
  has. The typed commands and the grammar are not behind the flag: `bind … format=pdf` works as it did.
- **Each half is tested in the unit tier and in a browser.** The unit specs give the components the flags they are meant for, and the combinations either side of each (`headers` alone, `headers` with `simulation`, the three with `explain`, and `explain` and
  `simulation` without `headers`). The browser runs `?ff=editor,headers`, `?ff=editor,simulation,headers` and `?ff=editor,simulation,explain,headers`, and asserts what is there and what is not.
- **The descriptions of the flags say it.** `headers` says its three halves, and `explain` says its testers and what needs the simulation too.

### S8 adds no key

The table of shortcuts, the hint bar and the cheat-sheet are not touched. The editor is reached by the five ways to link, and by selecting an edge, and everything in it is a stop of Tab; a single-character key for it would be a key that the learner
has to know about, in a canvas that has none to spare (WCAG 2.1.4). `Enter` on a selected edge ("Edit in the inspector") puts the focus on the first control of the inspector, which for a bound headers edge is the mode of the first binding. Nothing is offered that
cannot work, because nothing is offered.

### The producer's table commits row by row

- **A row is a name, a type and a value**, the rows of the binding editor without *exists* (a header of a message has a value), under the routing key, headed "Headers", with the help of ADR-0067 (`1` is an integer, `1.0` a float, `true` a boolean, `"1"` a string).
- **A row is committed when its control is left**, as the other fields of the composer are, if the table is complete and valid, and the change is one command with its line: a new or changed header is `set sender header:format=pdf`, a header taken off is `unset sender header:format`,
  and a name that is changed is `unset sender header:old; set sender header:new=pdf` as one batch. One change is one step of undo. Row by row, because "Publish now" sends what the document has, and a learner who types a header and presses the button
  has had the field left first. A binding is different (ADR-0066): a set of conditions is a decision, and a message is a field.
- **A row that is not finished stays in the table.** A name with no value, a value that cannot be read and a name that is there twice show their problem under the row (ADR-0068) and apply nothing, and the headers that the document has are the ones that are sent. A table that
  is committed by a row that is complete does not lose the one that is still being typed: the table starts again from the producer when its headers change from outside (an undo, a typed command), and when another producer is selected, and keeps itself when the change was its own.
- **The limits are the commands'.** At most 100 headers, a name of at most 255 bytes, a text of at most 10,000 characters (ADR-0029); a refusal is the command's, under the row, root cause first. A header called `x-…` has no note on a message: only a binding ignores it.
- **The routing key says what a headers exchange does with it**, when the producer publishes to one: "Not used by this exchange; still carried for exchange-to-exchange hops and dead-lettering." It is the description of the field (`aria-describedby`) and a sentence under it. The field is
  **not** greyed out or disabled, because the key is carried (ADR-0009). With `headers` off the composer has the sentence of S6 about the table that is coming.

### The what-if tester keeps its text

ADR-0064 said that S8 gives the what-if tester a table of headers. It does not. The text is the source of truth of the tester, and a table that wrote it would hold rows that a line cannot (a name that is not typed yet) and would rewrite a line that the learner wrote.
The route under its answer already says the type of every header it compared (ADR-0060), which is what the table would have been for, and the line that sends the message is the one the learner typed. The composer and the editor have the tables.

## Consequences

### Positive

- A developer can switch on the part of S8 that works, and a half that cannot work is not there. The same combinations are tested in a unit spec and in a browser.
- The producer's table is the same widget and the same rules as the editor, without a second set of words.
- No shortcut is added to a table that a hint bar, a cheat-sheet and a keyboard service read, so none of them can disagree.

### Negative / trade-offs

- The producer's table is not available to a canvas that has the editor and the headers and not the simulation. That canvas cannot edit any part of a message, as it could not before.
- A table that commits row by row makes a step of undo for each header, where the editor of a binding makes one for all. The line of each is one that a learner could type.
- Three combinations of flags are three browser runs, which cost a minute.
- The what-if tester asks for its headers in a line, as it did, and a learner who wants a table has the composer.

## Alternatives considered

- **Every part needs every flag.** Rejected: the editor needs nothing of the simulation, and S7 showed that a flag whose halves cannot be shipped alone is a flag that hides what works.
- **Two flags (`headers` and one for messages).** Rejected, as it was for `explain` (ADR-0064): one name to remember less, and the combinations are tested.
- **An "Apply" button on the producer's table.** Rejected: "Publish now" would send the headers of before the button, and none of the composer's fields has one.
- **A key to open the editor of the selected edge.** Rejected above.
- **The table in the what-if tester.** Rejected above.

## Related

- [ADR-0004](0004-trunk-based-development-on-main.md), [ADR-0009](0009-headers-exchange-support.md), [ADR-0029](0029-the-commands-refuse-at-the-size-caps.md), [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md),
  [ADR-0056](0056-counters-stacks-and-slots-are-signals-of-their-own-and-the-controls-are-a-strip-under-the-top-bar.md),
  [ADR-0064](0064-the-what-if-and-the-topic-tester-read-the-canvas-and-change-nothing-and-explain-is-one-flag-in-two-halves.md),
  [ADR-0065](0065-what-building-s7-settled-the-key-of-the-log-names-both-flags-a-tester-that-is-open-is-what-is-lit-and-a-tester-follows-the-text-that-is-typed.md).
- [ADR-0066](0066-a-headers-binding-is-made-in-a-popover-and-edited-in-the-inspector-from-one-draft-and-an-edit-is-one-batch.md),
  [ADR-0067](0067-a-value-is-typed-by-how-it-is-written-one-function-reads-it-for-the-editor-and-the-grammar-and-a-type-is-changed-by-rewriting-the-text.md),
  [ADR-0068](0068-a-row-says-what-is-wrong-under-itself-a-duplicate-stops-the-commit-an-x-key-is-told-by-what-the-mode-does-with-it-and-a-lint-stays-a-lint.md).
- [M1 plan](../plans/m1.md), section 3 (S8).

# ADR-0066: A headers binding is made in a popover and edited in the inspector from one draft, and an edit is one batch

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** "Editing" of [ADR-0009](0009-headers-exchange-support.md) (the binding editor), "After a drop" of [ADR-0011](0011-explicit-linking-and-command-layer.md) ("the headers editor, with the cursor already in it"), the key
  popover of [ADR-0041](0041-the-five-ways-to-link-share-one-path-and-a-binding-asks-for-its-key-first.md) ("a headers exchange binds with no condition until S8") and the editing of the bindings of an edge in
  [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md), for what S8 ([#10](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/10)) builds.

## Context

Linking to a headers exchange, by any of the five ways, makes a binding with no conditions, and the inspector says that header arguments "are written with the command bar for now". ADR-0009 wants an editor with an `x-match` control and
rows of name, type and value, for exchange-to-queue and exchange-to-exchange bindings, and ADR-0011 wants it to open at the drop with the cursor in it. The key popover of S5 is the pattern: nothing is made until Enter, and a binding is one `bind`
with one line that a learner could type. A set of conditions is more than a key, though. A half-typed set of conditions can route in a way that nobody meant, and a row that is not finished (a name and no value) is not a condition at all.
So it has to be settled what the editor holds before it is committed, when the document changes, and how a change to a binding that is there is one step of undo and a line.

## Decision

### Where it is

| Surface | When | What it makes |
|---|---|---|
| The **conditions popover** | A link to a headers exchange, by a drag, a click, `L`, the picker or the menu, a drop on nothing that makes the node, and "Add another binding" in the inspector, with the flag `headers` | one `bind` |
| The **inspector** | An edge whose source is a headers exchange, for each binding of it, in place of the key field, with the flag `headers` | one batch, `unbind` and `bind` |

- **`LinkFlow` asks, as it does for a key (ADR-0041).** `request` and `createAndLink` call `askConditions` on the surface, with the exchange, the destination, what started the link, and `submit(headers)`, which makes the binding and answers a
  `Result`. Without the flag `headers` the link is made at once with no conditions, as before: the popover is S8's, and the flag keeps the old behaviour until S12.
- **The popover opens at the node that was linked to, with the cursor in the name of the first row.** It has a visible heading ("Conditions for the binding from exchange docs to queue pdf"), the `x-match` control, the rows, "Add condition", the
  sentence that says what the binding asks, the problems of the rows, the lint, and the equivalent command, "Bind" and "Cancel". Enter in a field binds, as it does in the key popover. It is placed inside the canvas and clear of its edges,
  and it scrolls inside itself when it is taller than the canvas.
- **Nothing is made until Enter or "Bind".** Escape, the button and the focus going elsewhere give up: nothing is made, the learner is told ("Link cancelled."), and Escape and the button give the focus back to the canvas. The root of the
  popover can take the focus (`tabindex="-1"`), so a click on text inside it is not the focus leaving: a learner who has typed five conditions and clicks on a sentence to read it has not given up.
- **A second link replaces the first**, which is given up, as in ADR-0041: `LinkFlow` holds one request.
- **The inspector edits the same draft.** Each binding of the edge is a group with the editor, "Apply" and "Revert", and its own delete button. The key field is not there for a headers exchange, which ignores the key; a binding that has
  one (an exchange that was changed to `headers` with keys on its bindings) says "Its key is not read by a headers exchange", and keeps it. Escape leaves the inspector for the canvas and drops what was typed (ADR-0017).

### One draft

- **The editor holds a draft: a mode and rows.** A row is a name, the text of a value as it is written in a command (ADR-0067), and whether it is an *exists* condition. The document is not touched while rows are typed. The sentence, the problems,
  the lint, the equivalent command and the live table (ADR-0070) follow the draft, and are worked out again for each change of it, with no timer.
- **The draft starts from the binding.** A new binding starts with the mode `all`, written out, and one empty row. A binding that is there starts as it is, a binding with no arguments with no rows and the mode left out. The control shows the
  mode of a binding that left it out as `all`, and says so ("x-match is left out, which a broker reads as all"); the document keeps it left out until the learner touches the control, and then writes the mode they chose.
- **A row that is empty is not a condition**, and is left out when the draft is committed. A draft with no rows is a binding with no condition: with `all` it matches every message, with `any` none, and the sentence says so.
- **Revert** gives back what the document has. A change from outside the editor (an undo, a typed command) that changes the binding makes the editor start again from it, because the binding it was made from is another one.

### One step, and a line

- **A new binding is one `bind`**: `bind docs -> pdf x-match=all format=pdf type=report`, one step of undo, the line the learner would have typed (ADR-0011). The editor shows that line ("As a command").
- **A change to a binding that is there is one batch**: `unbind docs -> pdf x-match=all format=pdf; bind docs -> pdf x-match=any format=pdf type=report`. It is one step of undo and the line of the log is both commands, as a change of a key is
  (ADR-0044). **No new command is added**, so the grammar, the completion, the help and `docs/commands.md` do not change, and a script of lines (S11) can say the same thing.
- **A draft that is what the binding is changes nothing.** "Apply" says "No changes." and nothing is applied, so nothing is left to undo.
- **A draft that is another binding's** (it has exactly the conditions of another binding between the same two nodes, in any order) is applied, and the two are one, because a broker keeps a binding once (ADR-0051). The learner is told:
  "That is the same as another binding between these nodes, so there is one now."
- **A refusal keeps the draft** and shows the first problem under the editor, in the words of the refusal, root cause first and the broker's reply after it where there is one (ADR-0024). A problem that the editor can see before it asks
  (ADR-0068) is shown under its row as soon as it is typed, and Enter focuses the first row that has one.
- **The binding goes last on its edge.** `unbind` and `bind` put the changed binding after the others, so its chip moves, as a key that is changed does. It is the cost of a change that is two lines that a learner could type.

## Consequences

### Positive

- A set of conditions is one decision: it is made once, with its line, and undone once. A learner never has a binding that routes by half of what they meant.
- The popover and the inspector are one component with one draft, one set of rules for the rows and one set of tests.
- The grammar is not touched, and a lesson can say "bind with these conditions" in a line.

### Negative / trade-offs

- A learner who edits a binding must press "Apply", where the key of a binding is changed when its field is left. The two differ because a key is one field, and a set of rows is not.
- A binding that is edited moves to the end of its edge, and its chip with it.
- The popover is bigger than the key popover and the canvas can be small. It scrolls, and its placement knows its height.
- The control shows `all` for a binding that left `x-match` out, so two bindings that behave the same can be written differently. The note says so.

## Alternatives considered

- **Bind at once with no conditions and edit afterwards.** Rejected, as it was for the key (ADR-0041): two steps of undo for one gesture, and a log of a command that nobody typed. For conditions it is worse, because the binding in between matches every message.
- **Change the document as each row is left.** Rejected: a row that is not finished would become a binding that routes, and one gesture would be many steps of undo.
- **A command that replaces a binding in place (`rebind`).** It would keep the place of the binding on its edge, and it needs a spec with its syntax, its completion, its help, `npm run docs:generate` and the specs of all of them, for a thing that two lines
  already say. Rejected for M1; the place on the edge is the price.
- **A dialog.** Rejected by ADR-0010: no modal dialog for editing.
- **Rows inside the key popover.** Rejected: the key popover asks one thing, and a learner who links to a headers exchange has no key to give.

## Related

- [ADR-0009](0009-headers-exchange-support.md), [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0017](0017-canvas-keyboard-model.md), [ADR-0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md),
  [ADR-0041](0041-the-five-ways-to-link-share-one-path-and-a-binding-asks-for-its-key-first.md), [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md),
  [ADR-0051](0051-a-declaration-that-repeats-is-idempotent-an-unbind-of-nothing-changes-nothing-and-a-406-names-the-attribute.md).
- [ADR-0067](0067-a-value-is-typed-by-how-it-is-written-one-function-reads-it-for-the-editor-and-the-grammar-and-a-type-is-changed-by-rewriting-the-text.md),
  [ADR-0068](0068-a-row-says-what-is-wrong-under-itself-a-duplicate-stops-the-commit-an-x-key-is-told-by-what-the-mode-does-with-it-and-a-lint-stays-a-lint.md),
  [ADR-0070](0070-a-binding-is-made-from-a-message-by-ticking-its-headers-the-live-table-is-the-explanation-of-the-draft-and-a-chip-says-the-mode-and-the-first-conditions.md).
- [M1 plan](../plans/m1.md), section 3 (S8).

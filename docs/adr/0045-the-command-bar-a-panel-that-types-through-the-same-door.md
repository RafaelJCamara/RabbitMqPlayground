# ADR-0045: The command bar: a panel that types through the same door

- **Status:** Accepted. What it keeps when it is closed, where a refusal of it is shown, and when its list is shut are settled by [ADR-0048](0048-what-building-s5-settled-ctrl-k-in-a-field-a-bar-that-keeps-its-draft-a-top-bar-that-fits-and-tests-that-wait.md). The folder that sits between it and the editor is settled by [ADR-0057](0057-what-building-s6-settled-folders-that-run-one-way-a-strip-that-is-a-region-frames-that-cannot-jump-and-colours-read-through-a-probe.md). Ctrl+K also closes the bar when it is open, superseded by [ADR-0094](0094-ctrl-k-opens-the-command-bar-and-closes-it-when-it-is-open-and-the-draft-stays.md), the rest stands.
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** "Command bar (M1)" of [ADR-0011](0011-explicit-linking-and-command-layer.md), "The verbs of M1" of [ADR-0025](0025-the-command-grammar.md) (`help` joins the registry in S5) and
  [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md) (a shortcut is a row), for what S5 ([#7](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/7)) builds on the parser, the completer and the formatter of S2.

## Context

The domain can read a line (`parseCommand`), say what could be typed at a cursor (`completeCommand`), write a command as a line (`formatCommand`) and list every command with its syntax and examples (`COMMAND_DOCS`). The bus applies a command
with an origin ([ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md)). ADR-0011 asks for a bar that opens with `/` and Ctrl/Cmd+K, with autocomplete, syntax help, a history, errors that suggest a fix, and a log of the line that each gesture is equivalent to.
What is missing is where it is, how it is used with a keyboard, where its history lives, and what `help` is.

## Decision

### Where it is, and how it opens

- **A panel docked above the hint bar, in `command-bar/`.** It is in the layout and not over the canvas, so that it never covers the node that has the focus (WCAG 2.4.11). Closed, it is one line: its name, the latest equivalent command
  (`↳ bind orders -> billing key=order.*`) and the key that opens it. Open, it is the log of equivalent commands ([ADR-0046](0046-the-equivalent-command-log-and-the-tests-that-hold-gestures-and-commands-together.md)), the result of the last line, and the field to type in at the bottom, like a prompt.
- **`/` opens it, on the canvas, and Ctrl/Cmd+K anywhere in the editor.** They are two rows of the table of shortcuts ([ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md)): a single character is a `canvas` shortcut and the chord with a modifier is an `app` one,
  and the hint bar and the cheat-sheet list them from the table. Opening puts the cursor in the field. Escape closes the list, and then the panel, and the focus goes back to the canvas.
- **`command-bar/` imports `core/` and `canvas/model/`, and never `editor/`**, which hosts it. ESLint holds it, and the spec of the boundaries.

### The field is a combobox

- **It has the pattern of one**: the input has the role `combobox`, the list is a `listbox` of `option`s that the input points at with `aria-activedescendant`, and the list is open only while there is something to offer. The items are what `completeCommand` offers at the cursor, so the bar
  offers what the parser would accept, and nothing else.
- **Keys.** Tab accepts the item that is chosen, or the first. The arrow keys choose in the list while it is open, and walk the history while it is not. Enter accepts an item that was chosen with the arrow keys, and otherwise runs the line. A completion is written as the
  completer says, quoted if it has to be, with a space after a name and none after `key=`, `exists(` and `header:`. After a line is taken from the history the list stays shut until the learner types, so that the arrow keys keep walking the history.
- **A field of text is the field's**: the single-key shortcuts do not work in it ([ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md)), and Ctrl/Cmd+Z undoes the typing in it and not the canvas.

### A line takes the same door as a gesture

- **A line is read with `parseCommand` against the canvas as it is, and applied with the bus** (`CommandBus.apply(command, 'typed')`), so it is one step of undo, it is saved, announced and logged as a gesture is, and a refusal shows the Issue's message first and the broker's reply after it. `typed` is a sixth origin.
  `undo` and `redo` are answered by the bus, and `help` by the registry. A line that changes nothing says so, because the bus leaves nothing to undo.
- **A line that cannot be read keeps its text, selects the words at fault, and says where and what to do.** The suggestions of the Issue ("did you mean") are buttons that put the name in place of the words. The error is spoken once, assertively, as a refusal is.
- **`help [command]` is a command of the registry**, scope `app`, so it is completed, documented in `docs/commands.md` and checked by the same tests. `help` lists the commands, each with its first sentence, and `help bind` gives its syntax, its summary and its examples, which are buttons that put the
  line in the field. It is answered from the registry (`COMMAND_DOCS`), changes nothing, is not logged, cannot be one of several commands, and the topic is the name of a command, one word or two, with "did you mean" for one that is not.
- **When the field is empty it suggests what to do next**: up to five lines made from the canvas (declare something on an empty canvas; bind an exchange that nothing is bound from; link a producer that has no target; subscribe a consumer that has no queue), written by the formatter, so that each is a line that works.
  They are buttons that put the line in the field, which the learner can change and run.

### History

- **It holds the lines that were given, oldest first, up to 100, and a line is not kept twice in a row.** It is a preference of the browser, as the theme is ([ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md)), kept in `localStorage` under `rmq.command-history` and not in a canvas, so a
  share link or a file never carries it. A browser that will not keep it still has the history of the page. The log of equivalent commands is a different thing, and is not kept ([ADR-0046](0046-the-equivalent-command-log-and-the-tests-that-hold-gestures-and-commands-together.md)).

## Consequences

### Positive

- A typed line and a gesture cannot differ in what they do, say or save, because they are the same call with another origin.
- The bar offers only what the parser accepts, and its help, its completions and the reference of `docs/commands.md` are one registry.
- A learner who types a line that is wrong is shown which words, why, and the names that were probably meant.

### Negative / trade-offs

- The panel takes a line of the window when closed and more when open, and the canvas is that much smaller.
- A completion list that is open takes the arrow keys, so a learner who wants the history while it is open presses Escape first.
- `help` is a command that is not a change, so the properties of the domain that walk the commands leave it out, and its own specs have to cover it.

## Alternatives considered

- **A palette over the canvas** (a modal box in the middle). Rejected: it would cover the node that the learner is working on, and it cannot be left open next to the log that teaches the vocabulary.
- **Complete only on Tab.** Rejected: ADR-0011 asks for autocomplete that shows what can be typed, and an empty list teaches nothing.
- **Keep the history in the canvas.** Rejected: it is about the person and not the document, and a canvas that is shared must not carry what its author typed.
- **Run `help` as text in the log.** Rejected: the log is the lines that changed the canvas, and a script made from it must replay.

## Related

- [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0025](0025-the-command-grammar.md), [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md),
  [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md), [ADR-0041](0041-the-five-ways-to-link-share-one-path-and-a-binding-asks-for-its-key-first.md).
- [`docs/commands.md`](../commands.md), generated from the registry.
- [WAI-ARIA APG: Combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).

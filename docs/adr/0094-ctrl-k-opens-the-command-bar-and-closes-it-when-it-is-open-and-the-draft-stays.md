# ADR-0094: Ctrl+K opens the command bar and closes it when it is open, and the draft stays

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0045](0045-the-command-bar-a-panel-that-types-through-the-same-door.md) (the command bar and the keys that open it) and [ADR-0048](0048-what-building-s5-settled-ctrl-k-in-a-field-a-bar-that-keeps-its-draft-a-top-bar-that-fits-and-tests-that-wait.md) (Ctrl+K in a field, and a bar that keeps its draft).

## Context

- Ctrl+K (Cmd+K on a Mac) opens the command bar from anywhere in the editor, including from a field of text, where `/` is typed (ADR-0045, ADR-0048). Pressing it again with the bar open only put the cursor back in the field. To close the bar a learner had to press Escape, and Escape works from anywhere in the bar but is a different key from the one that opened it.
- In every tool that has such a palette the key that opens it also closes it, and a learner who presses it twice expects the second press to take the bar away. It is also what the button of the bar does (it opens and closes).
- ADR-0048 settled what closing does: what was typed stays, so that an Escape by mistake never loses a long line, and when the learner asked with a key the cursor goes to the canvas, because the key came from where they were working.

## Decision

- **Ctrl+K, and Cmd+K, opens the command bar when it is closed and closes it when it is open**, from wherever the cursor is: the canvas, a button, the field of the bar, or any other field of text. The row `commands-anywhere` of the shortcuts runs a new action, `toggleCommandBar`, and the label of the row and the line of the cheat-sheet say "Open or close the commands, from anywhere".
- **Closing with the key is closing with Escape.** The bar is shut, its list and its answer are put away, what was typed stays in the field for the next time (ADR-0048), and the cursor goes to the canvas. `CommandBar.toggleFromKeys()` is the one door: it closes with `close(true)` when the bar is open and calls `open()` when it is not.
- **`/` stays open-only.** It is a key of the canvas, typed in a field, so it cannot close a bar whose field is where it would be typed. `open()` still puts the cursor back in the field when the bar is already open, which is what `/` and the pointer's first press ask for.
- **A key that is held down does not make the bar flicker.** The keyboard service already ignores a repeated key (`KeyboardEvent.repeat`), and a spec says so for this row.
- **The button of the bar is unchanged**: it opens and closes, and closing with it leaves the cursor where the pointer put it, as before.

## Consequences

### Positive

- One key opens and closes the bar, from the field too, and the bar keeps its draft either way.
- Nothing about the other keys, the list, the history or the log changes.

### Negative / trade-offs

- A learner who presses Ctrl+K a second time to get the cursor back in the field now closes the bar. The field is one Tab or one click away, and the button of the bar says "Commands" and is expanded or not, so the state is always readable (`aria-expanded`).

## Alternatives considered

- **Keep Ctrl+K open-only and only have Escape close.** This is what was there, and what the request was about.
- **Close on the second press only when the cursor is in the field.** The rule would depend on where the cursor is, and a learner who clicked a button of the log and pressed the key would not know what it does. One rule, wherever the cursor is.
- **Clear the line when the key closes the bar.** Not chosen: ADR-0048 keeps the draft on purpose, and a key that toggles is pressed by mistake more easily than Escape.

## Related

- [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md) (a shortcut is a row, and a chord with Ctrl, Cmd or Alt works in a field), [ADR-0047](0047-guidance-the-hint-bar-the-how-to-link-card-and-the-cheat-sheet.md) (the cheat-sheet is built from the rows).
- Tests: `projects/app/src/app/editor/keyboard.spec.ts`, `actions.spec.ts`, `editor.spec.ts`, `projects/app/src/app/command-bar/command-bar.spec.ts` ("closes when it is asked to by the key that opens it"), `e2e/command-bar.spec.ts` ("closes with Ctrl+K again, from the field").

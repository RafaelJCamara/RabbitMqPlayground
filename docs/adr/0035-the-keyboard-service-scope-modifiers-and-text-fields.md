# ADR-0035: The keyboard service: scope, modifiers and text fields

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0017](0017-canvas-keyboard-model.md) (section 4, "App shortcuts", and its rules for the app's keyboard handler),
  for the shortcuts that S4 ([#6](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/6)) builds and the ones that later
  slices add.

## Context

ADR-0017 adopted Foblex's keyboard layer for the canvas and gave the rest of the keys to the app, with rules: single-character
shortcuts work only while the canvas has focus (WCAG 2.1.4), events that the library has handled and events from text fields are
skipped, and a modifier with a single key is never a single-key action. It did not say where the app's handler stands, how it
tells that the library has used a key, what a shortcut is as a value, or where the hint bar gets its words. Every slice after S4
adds shortcuts (Space, `.`, `P`, `?`, `/`, Ctrl/Cmd+K), so the shape has to be one that a row can be added to.

## Decision

### Three places, in the order that a key reaches them

1. **The guard of the adapter**, in the capture phase of the page, before the library. It holds back a key that the library would
   match before it looks at the modifiers (Ctrl, Cmd or Alt with `M`), so that Ctrl/Cmd+M, which a person means for something
   else, never picks a node up ([ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md)). It
   is in the adapter because it is about the order in which the library matches, and a contract test pins it.
2. **Foblex's keyboard layer**, on the canvas: arrows, Home and End, Shift and Ctrl with the arrows, Ctrl/Cmd+A, Escape, `M`, `L`,
   Delete and Backspace (which are requests, and become a `delete` intent), and `+`, `-` and `0`. It calls `preventDefault` on a key that it
   uses.
3. **The keyboard service of the app**, one `keydown` listener on the root of the editor, in the bubble phase. The library is inside
   that element, so it has had its turn, and `defaultPrevented` says whether it used the key. The service is for everything else.

### A shortcut is a row

`editor/keyboard.ts` has the table of shortcuts, and the service reads it. A row says:

- **the chord**: the key, and which modifiers it needs (`mod` is Cmd on a Mac and Ctrl elsewhere);
- **the scope**: `canvas` (the target is the canvas or inside it) or `app` (anywhere in the editor);
- **the words**: a label for the hint bar, and for the cheat-sheet that S5 builds from the same table;
- **what it does**, given what the editor can do (the stores, the bus, the viewport, the surface).

A later slice adds a row. It does not add a listener.

### The rules of the service

- **Skip what the library used**, and what is not a key press for us: `defaultPrevented`, an input method that is composing, and
  a key that is held down and repeats (a held `F2` must not open a rename thirty times).
- **Skip text fields.** A key whose target is a text field (an `input` that takes text, a `textarea`, a `select`, anything
  `contenteditable`, or an element with the role of a text box, a combo box or a spin button) is that field's. That includes
  Ctrl/Cmd+Z, which edits the text there and is the learner's undo only outside a field ([ADR-0017](0017-canvas-keyboard-model.md)).
- **A single character is a `canvas` shortcut, always.** A row whose chord is one character with no Ctrl, Cmd or Alt must have the
  scope `canvas` (WCAG 2.1.4). A spec checks every row of the table, so that a later slice cannot add one that works anywhere.
- **No modifier on a single key.** A key of one character that is pressed with Ctrl, Cmd or Alt is not matched by a row that has no
  such modifier. Shift counts only when the row asks for it (`?` is Shift with `/` on some keyboards, and the row says `?`).
- **Matching is by `key`, not by position**, and without case for letters, as the library matches.
- **After a shortcut the service calls `preventDefault`**, so that the page does not also act on the key.

### The shortcuts of S4

| Keys | Scope | What it does |
|---|---|---|
| F2 | canvas | Renames the selected node: the field for a name opens on it, and Enter or Escape closes it |
| Enter | canvas | Edits the selected item in the inspector: the focus goes to its first field, and Escape brings it back to the canvas |
| F | canvas | Fits the whole canvas into the window, and says so |
| Mod+Z | app | Undoes the last step, and says what it undid |
| Mod+Shift+Z, Ctrl+Y | app | Redoes it |

`Enter` does nothing while a mode of the library is on (a link or a move that is in progress), because the library uses it then and has
said so with `preventDefault`. Everything in the other rows of ADR-0017's table (Space, `.`, `P`, `?`, `/`, Ctrl/Cmd+K) belongs to the
slice that builds what it does.

### Focus

- **The focus goes where the learner is working.** A rename or an inspector field takes it when it opens, and gives it back to
  the canvas when it closes, by the canvas's own call (`FlowViewport.focus`). A context menu gives it back to what had it.
- **A shortcut says what it did, through the live region**, the way that a click does. Fit says that it is showing the whole canvas.

### The hint bar

- **A line below the canvas that says what the keys do now.** It is for the learner who has the canvas and does not know what to press,
  and it changes with what is selected: nothing, one node, one edge, several things. It is made from the table above, so a shortcut
  that is added shows up in it.
- **It is text, not a live region.** It changes whenever the selection does, and a screen reader that read it each time would drown the
  announcements that matter. The standing instructions of the canvas, which the library gives to a screen reader on entry, are
  ours too ([ADR-0017](0017-canvas-keyboard-model.md)).
- **What it says is a pure function of the selection** and is unit-tested as such. S5 adds the "How to link" card and the
  cheat-sheet to it, and does not replace it.

## Consequences

### Positive

- One listener, one table. A slice adds its keys by adding rows, and the spec of the table keeps every row inside the rules.
- The three places have one job each, and a key is handled by exactly one of them.
- The hint bar and the cheat-sheet cannot disagree with what the keys do, because they come from the table.

### Negative / trade-offs

- The service depends on the library calling `preventDefault` for what it uses. That is a behaviour of the version, and the contract
  suite pins the ones that matter (an arrow key, `M`, `L`, Delete).
- A held key does nothing after the first press. A learner who holds an arrow key is using the library's layer, which is not
  affected, and one who holds F2 would not expect it to repeat.
- A listener on the root hears keys from the toolbox, the inspector and the menus as well, so every row has to say what its scope
  is, and a test has to try it from outside.

## Alternatives considered

- **A listener on the canvas only.** Rejected: undo and redo, and later the command bar's shortcut, work from the toolbox and the
  inspector too, and a second listener would repeat the rules.
- **A listener on `document` in the capture phase.** Rejected: it would run before the library, and could not tell what the library
  used. The library's `preventDefault` is the signal, so the service has to come after it.
- **Angular's `@HostListener` on each component, with its own keys.** Rejected: the rules of scope and text fields would be repeated
  in each, and a slice that forgot one would be a violation of WCAG 2.1.4.
- **A third-party shortcut library.** Rejected for now: the rules above are the whole of it, and the table is small.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0011](0011-explicit-linking-and-command-layer.md) (the hint bar),
  [ADR-0017](0017-canvas-keyboard-model.md).
- [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md),
  [ADR-0034](0034-the-foblex-contract-suite-and-how-an-upgrade-fails-loudly.md).
- [WCAG 2.1.4 Character Key Shortcuts](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html)

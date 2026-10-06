# ADR-0047: Guidance: the hint bar, the "How to link" card and the cheat-sheet

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** "Making it visible" of [ADR-0011](0011-explicit-linking-and-command-layer.md) and the hint bar of [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md) ("S5 adds the 'How to link' card and the cheat-sheet to it, and does not replace it"),
  for what S5 ([#7](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/7)) adds so that no way to link is hidden.

## Context

The original's linking was a gesture that nobody found ([ADR-0011](0011-explicit-linking-and-command-layer.md)). The editor now has five ways and a command bar, and each has to be found by someone who has not read the ADRs: a hint that changes with what is selected, a card that lists
the ways the first time, and a sheet of every key and command that `?` opens. S4 built the hint bar from the table of shortcuts, and said that S5 adds to it.

## Decision

- **The hint bar stays a pure function of the selection and the table.** S5 adds two rows that show always: `/` ("Commands") and `?` ("Shortcuts"). The row for linking keeps its words ("Link to another node"), and the sentence that the library speaks when `L` starts a link now says what the keys
  are (`Linking from exchange orders. The arrow keys choose a target, Enter links, Escape cancels.`), because the bar cannot know that the library has started something.
- **A symbol is matched by what it types.** The row for `?` is `?`, and Shift is what makes it on most keyboards, so a chord of a symbol (a character that is not a letter) does not compare Shift, and a chord of a letter, or of a key with a name, still does. `/` and `?` are single characters, so they are `canvas`
  shortcuts ([ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md)); the button for help in the top bar works anywhere.
- **The first-run card is a banner under the top bar, and not over the canvas.** "How to link" lists the five ways in one line each (drag from the dot on the right of a node, click the dot and then the target, "Link to…" in the inspector, right-click, `L`) and says that the command bar does it with a line.
  It shows while the canvas has no edge and the learner has not dismissed it ("Got it"), which is kept in the browser (`rmq.how-to-link`), and it is dismissed for good by the first edge, because that learner has found a way. It has the role of a region with a name, and takes no focus.
- **The cheat-sheet is a dialog**, the CDK's, opened by `?` on the canvas and by the Help button of the top bar anywhere. It holds the five ways, every key of the table (what it does, its keys, and whether it works only on the canvas or anywhere), and every command of the registry
  with its syntax and its first sentence, and says that `help` in the command bar says more. It is modal, because it is a sheet to read and not a place to edit, and ADR-0010's rule against modal dialogs is for editing. Escape and the button close it, and the focus returns to what had it.
- **What the sheet and the bar say comes from the table and the registry**, so a key or a command that is added shows up in them without anyone writing it twice, and a spec reads both to hold that.

## Consequences

### Positive

- A learner is told about each way in three places that they pass anyway: the hint bar, the card and the cheat-sheet, and about the command bar in the hint bar.
- The card cannot cover a node, and it goes when it has done its work.
- The sheet cannot drift from the keys or from the commands.

### Negative / trade-offs

- The card takes a few lines of the window until it is dismissed or the first edge is made.
- A modal sheet takes the focus, which a learner who wants to keep working with the keys at hand has to give back with Escape.
- Not comparing Shift for a symbol means that Shift with a symbol that a row names also matches. Only `?`, `/` and the keys that the library owns are symbols, so none of them is a different shortcut with Shift.

## Alternatives considered

- **A card over the canvas.** Rejected: it would cover nodes, and a focus ring under it would break WCAG 2.4.11.
- **A tour.** Rejected for S5: the tour is S11's, and it will accept any of the five ways.
- **A non-modal panel for the sheet.** Not chosen: the sheet is long, and a modal dialog is the pattern that a screen reader and a keyboard already know for something that is read and closed.
- **Show the card on every empty canvas.** Rejected: a learner who has dismissed it, or has linked, has found the ways.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0017](0017-canvas-keyboard-model.md), [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md),
  [ADR-0041](0041-the-five-ways-to-link-share-one-path-and-a-binding-asks-for-its-key-first.md), [ADR-0045](0045-the-command-bar-a-panel-that-types-through-the-same-door.md).
- [WCAG 2.1.4 Character Key Shortcuts](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html).

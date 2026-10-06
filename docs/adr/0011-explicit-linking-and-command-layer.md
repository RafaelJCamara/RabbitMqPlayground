# ADR-0011: Explicit linking and a single command layer

- **Status:** Accepted. Keyboard linking (item 4 of "Five ways to link") and "Initial keyboard shortcuts" are
  superseded by [ADR-0017](0017-canvas-keyboard-model.md). The "produces **patches**" clause of "One command layer" is
  superseded by [ADR-0019](0019-undo-through-immutable-document-snapshots.md). The vocabulary of "Command bar (M1)" is
  extended by [ADR-0025](0025-the-command-grammar.md), and "One command layer" by
  [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md). The state, and the bus that applies commands in the app, are
  settled by [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md), and the hint bar by [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md).
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

In the original simulator, nodes were linked by holding **Alt or Shift while dragging**. Few users found that, and on
many desktops Alt+drag moves the window instead, so the node moved rather than linking
([#3](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/3);
[PR #7](https://github.com/RabbitMQSimulator/RabbitMQSimulator/pull/7) added Shift as a fallback).

The product owner's requirements:

- It must be **explicit which commands link things**.
- Linking must **also** work directly from the UI and canvas.

Linking should therefore be available in several places at once: through keyboard shortcuts that are always visible,
and through a typed command bar.

Separately, undo/redo, lessons, challenges and tests all need one uniform way to describe a change.

## Decision

### Five ways to link (M1)

1. **Drag from a handle.** Every node shows a ● handle on hover and when selected. It works with touch and needs no
   modifier keys.
2. **"Link to…" button.** It sits on the node's floating toolbar and in the inspector. It opens a searchable picker
   that lists **only valid targets**, grouped by type.
3. **Right-click → "Link to…"** opens the same picker.
4. **Keyboard.** Select a node and press **`L`**. Valid targets are highlighted:
   - **Tab** cycles through them, **Enter** links, **Esc** cancels.
   - If two nodes are selected, `L` links them directly and works out the direction (exchange + queue → a binding).
5. **Typed command,** for example `bind orders -> billing key=order.*`.

### Making it visible

- **Hint bar.** Always shown at the bottom of the canvas, and changes with what is selected.
  For example: *"Drag ● or press L to bind · Del to delete · type `/` for commands"*.
- **First-run "How to link" card** on an empty canvas, listing all five methods.
- **`?` cheat-sheet** listing every shortcut and command. Tooltips and menus show shortcuts next to their actions.

### After a drop

- **Drag to create.**
  - Dropping a handle on empty canvas offers "new exchange / queue / consumer".
  - Dropping onto a queue opens the binding-key popover, or the headers editor, with the cursor already in it.
- **Feedback while dragging.** Valid targets light up. An invalid drop explains why, for example
  *"Consumers subscribe to queues, not exchanges"*.

### Connection rules

| From → To | Meaning |
|---|---|
| Producer → Exchange | Publish target. Not allowed for *internal* exchanges |
| Producer → Queue | Shortcut, drawn as going through the default exchange |
| Exchange → Queue | Binding, with a key or headers arguments. Several bindings between the same pair are drawn as one edge with several chips |
| Exchange → Exchange | Exchange-to-exchange binding |
| Queue → Consumer | Subscription. A consumer may subscribe to several queues |
| Queue → Worker / Worker → Exchange (M4) | Pipelines and RPC |

### Command bar (M1)

- **Opening and editing.**
  - Opened with **`/`** or **Ctrl/Cmd+K**.
  - Autocomplete, inline syntax help and a history (↑/↓).
  - Errors suggest a fix.
  - Every command can be undone.
- **Vocabulary.** Commands use RabbitMQ's own verbs:
  - `declare exchange <name> type=direct|fanout|topic|headers`
  - `declare queue <name> [type=classic|quorum|stream]`
  - `bind <exchange> -> <queue|exchange> [key=…] [x-match=all|any|all-with-x|any-with-x <header>=<value> …]`
  - `unbind …`
  - `link <producer> -> <exchange|queue>`
  - `subscribe <consumer> <queue>`
  - `publish <producer|exchange> key=… headers=… payload=…`
  - `rename`, `delete`, `clear`, `share`
  - `help [command]`
- **Learning the commands.** Every mouse or keyboard action is logged with its **equivalent command**, for example
  *"↳ `bind orders -> billing key=order.*`"*.
- **Reference.** A command reference is generated from the command registry, so the docs never drift from the code.

### Initial keyboard shortcuts

| Action | Shortcut |
|---|---|
| Link the selection | `L` |
| Command bar | `/` or Ctrl/Cmd+K |
| Cheat-sheet | `?` |
| Delete the selection | Delete / Backspace |
| Rename | F2 (or double-click) |
| Undo / redo | Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z |
| Play / pause | Space |
| Step one event | `.` |
| Publish from the selected producer | `P` |
| Fit view | `F` |
| Cancel / deselect | Esc |

### One command layer

**Every change** goes through one command layer, whatever started it: a canvas gesture, a shortcut, the command bar, a
lesson step, a challenge, an import or a test.

- A command is a **serialisable object** that is validated against the current state.
- It is applied to the canvas document and produces **patches**, which drive undo/redo.
- It is forwarded to the engine ([ADR-0007](0007-deterministic-simulation-engine.md)).

The typed command bar is simply a text front-end for this layer.

## Consequences

### Positive

- Linking can be discovered and is accessible: there are five routes, and they are always on screen.
- The UI, the command bar, lessons and tests share one code path, so behaviour can't drift between them.
- The equivalent-command log teaches the vocabulary used by RabbitMQ tooling.
- Lessons can accept either the gesture or the typed command.

### Negative / trade-offs

- The command grammar becomes a public interface. It needs versioning and careful changes.
- Writing the parser, autocomplete and error messages is real work, and it all needs exhaustive tests.

## Alternatives considered

- **Modifier+drag only, as in the original.** Rejected: it can't be discovered, and the OS can intercept it.
- **A command console only.** Rejected: linking also has to be possible on the canvas.
- **Separate code paths for UI actions and typed commands.** Rejected: behaviour would drift, and everything would be
  tested twice.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md): the hint bar and layout.
- [ADR-0007](0007-deterministic-simulation-engine.md): the engine that consumes commands.
- [ADR-0009](0009-headers-exchange-support.md): headers binding commands.

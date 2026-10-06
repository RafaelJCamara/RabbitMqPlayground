# ADR-0046: The equivalent-command log, and the tests that hold gestures and typed commands together

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** "Learning the commands" of [ADR-0011](0011-explicit-linking-and-command-layer.md) (every action is logged with its equivalent command), the bus of
  [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md) (every apply has an origin, and listeners are told) and [ADR-0036](0036-the-test-strategy-of-the-editor.md)
  (what is tested where), for what S5 ([#7](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/7)) needs to prove that gestures and typed commands are interchangeable.

## Context

The exit criterion of S5 is that gestures and typed commands are interchangeable, and the test that it names is that every logged equivalent command, replayed, produces the same document. ADR-0031 made the bus tell a listener of every command with its origin
and the documents before and after, "so that S5's equivalent-command log can write a line for each one". The log needs a shape and a home, undo and redo have to be in it, and "the same document" has to mean something that a test can check, which it cannot if a command that was refused
has used up an id that a replay will not use.

## Decision

### The log

- **An entry is `{ id, origin, text }`.** `text` is `formatCommand(command, before)`, the line that a learner would type to do the same, written the canonical way (quoted where it has to be, with the kind of an element only where its name would not say which). `id` counts from 1 and is never reused, and
  `origin` is what the learner used: `gesture`, `key`, `menu`, `toolbar`, `inspector` or `typed`.
- **It holds what changed the canvas, in the order that it changed.** A command that the bus accepted and that changed something, and an `undo` or a `redo` that did. A refusal, a command that changed nothing, `help` and a selection are not in it. A batch is one entry, with its commands joined by `; `.
  A drop from the toolbox is `declare queue queue1; move queue1 x=412 y=220`, which is the line that makes the same node in the same place.
- **It is the session's, in memory.** It is not saved with the canvas and not shared with it: it is what this learner did this time, and a canvas that is opened has none. It keeps the last 1,000 entries. S7's event log shows these lines beside the events of the engine, from the same store.
- **The bus feeds it.** `onApplied` is told of `undo` and `redo` as it is of a command (the listener gets a `Command`, which can be an `AppCommand`), and a `CommandLog` of `core/` listens. No caller writes a line, so a way of changing the canvas that goes through the bus cannot be missing from the log.
- **It is shown in the command bar's panel** ([ADR-0045](0045-the-command-bar-a-panel-that-types-through-the-same-door.md)): a list of the lines, newest at the bottom, each with what the learner used, and a button that puts a line in the field to be run again or changed. It is a list and not a live region, because the bus has said what was done.

### "The same document" means the same, ids included

- **An id is used only by a command that is accepted.** `IdGenerator` gives the bus a mark to go back to, and the bus goes back to it when a command is refused (a batch that made a node and then met a refusal made nothing, and the id is not spent). Counters still never go down for an undo,
  because the history can bring a node back. So a log replayed, undone commands included, makes the ids that the gestures made.
- **The claim, and the tests.** A log typed line by line into the command bar of a canvas that began as the logged one did, makes a document that is equal to the one that the gestures made: names, ids, places, labels, bindings and settings.
  - **A property** in the unit tier of the app: a sequence of what the app can do (add, drop, link in each way, link to a new node, rename, move, delete nodes and edges, edit a binding, move a label, change a setting, the default exchange, layout, undo, redo) is played through the services that the editor is made of, the log is read, and a fresh editor replays it through the same function that
    the bar uses. It runs at the default 100 runs in the hook and CI, at 5,000 with several seeds before a push that changes it, and in the Nightly fuzz job, which runs the app's properties with a random seed and 5,000 runs as well as the libraries'.
  - **A journey** in the end-to-end tier: the learner links in each of the five ways and by touch, renames, moves a label, switches the default exchange, undoes and redoes; the lines of the log are read from the page, typed into the bar of a second browser context that starts empty, and the two documents are compared.

### How the tests send what a library cannot

- **Touch is real touch events.** The context has `hasTouch`, a tap is `page.touchscreen.tap`, and a drag is `Input.dispatchTouchEvent` through the protocol (the one place that talks to it for this, `e2e/support/touch.ts`), because Playwright has no touch drag. The library listens to `touchstart` and `touchmove`, sets `touch-action: none` on the canvas, and
  ignores the mouse events that follow a touch for 800 ms ([the spike notes](../plans/m1-foblex-spike-notes.md)).
- **A pointer gesture that the system orders is sent in both orders** ([ADR-0039](0039-the-context-menu-stays-open-through-the-end-of-the-click-that-opened-it.md)), and so is the click that follows a drop, for the menus that a pointer opens.
- **The contract suite gets the facts about the library that S5 relies on**, each a test that names it ([ADR-0034](0034-the-foblex-contract-suite-and-how-an-upgrade-fails-loudly.md)): the content of a connection is placed at a fraction of its path, a press on it that is not stopped pans the canvas, the connectors that are disabled start no link and light nothing,
  the keyboard layer reaches a connection that the app asked it to skip, and a link made by touch is reported as a link.

## Consequences

### Positive

- The exit criterion is a test that runs on every push, and a property that runs every night.
- A learner can copy the log into a template or a lesson, because every line is a command that the grammar reads.
- Nothing that goes through the bus can be left out of the log, and nothing that does not go through it can change the canvas.

### Negative / trade-offs

- A log keeps nothing across a reload, so a learner cannot ask what they did yesterday. The canvas has what they made, and the history of the command bar has what they typed.
- Going back to an id after a refusal means that two commands that were refused and then accepted make the same id. No document ever had the first, so nothing can have a reference to it.
- The property has to drive the app's services without a canvas, and the surface that asks for a key or a name is replaced by one that answers from the generated numbers. What it proves is the commands and the log, and the popover has its own specs.

## Alternatives considered

- **Compare documents up to the ids.** Rejected: it would excuse the one thing that a refused batch can break, and a log would not rebuild the document that it is the log of.
- **Log in the code that each gesture runs.** Rejected: a gesture that forgot would be missing, and a test would not find it.
- **Save the log with the canvas.** Rejected for M1: a share link must not carry what its author did, and the size of a canvas is capped (ADR-0029).
- **Record the events that the browser sent, and replay those.** Rejected: that tests the browser and not the commands, and it breaks when the layout moves.

## Related

- [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0025](0025-the-command-grammar.md), [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md),
  [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md), [ADR-0036](0036-the-test-strategy-of-the-editor.md), [ADR-0039](0039-the-context-menu-stays-open-through-the-end-of-the-click-that-opened-it.md).
- [ADR-0015](0015-testing-strategy-and-definition-of-done.md): properties at 5,000 runs, in the Nightly run.
- [M1 plan](../plans/m1.md), section 7 (journeys 3 and 4).

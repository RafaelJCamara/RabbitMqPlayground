# ADR-0019: Undo through immutable document snapshots

- **Status:** Accepted. The choices that building it needed are in
  [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md), and the store that holds the history in the app is in
  [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md).
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara
- **Supersedes:** in [ADR-0011](0011-explicit-linking-and-command-layer.md), the part of "One command layer" that says a
  command "is applied to the canvas document and produces **patches**, which drive undo/redo".

## Context

[ADR-0011](0011-explicit-linking-and-command-layer.md) sends every change through one command layer and says each
command produces patches that drive undo and redo. Planning M1 in detail showed that a different mechanism is simpler
and safer.

Three facts shape the choice:

1. **The document is small and shaped like a tree.** A canvas holds tens to a few hundred elements. A command replaces
   only the branch it changes, so keeping earlier versions is cheap.
2. **Inverses are where undo bugs live.** Patches only work if the inverse of every command is right in every state.
   That is a lot of code to get wrong, for example a rename followed by a delete, or a reused id.
3. **The engine has to follow the document.** It must stay in step through do, undo, redo, load and clear
   ([ADR-0007](0007-deterministic-simulation-engine.md)), and it should not need to know which of those happened.

## Decision

- **The canvas document is immutable.**
  - A command's `apply(document, command)` returns a new document or an error. It never changes its input.
  - Branches a command did not touch keep their identity (structural sharing).
- **History stores document references**, not patches and not inverse commands.
  - `push(previous)` runs for every applied command. `undo(current)` returns the previous document and keeps `current`
    for redo. `redo(current)` does the reverse. A new command clears the redo stack.
  - The capacity is 200 entries. The oldest entry is dropped first.
  - A `batch` command is one entry, so drag-to-create is one undo step.
  - History belongs to one open canvas and lives in memory. It is not saved with the canvas and is gone after a reload.
- **One path keeps the engine in step.** `reconcile(previous, next)` returns the engine commands that turn the engine's
  topology from one document into the other. It serves do, undo, redo, load and clear alike.
- **Undo restores the design, not the simulation.** Queue contents, messages in flight and counters are runtime state
  ([ADR-0007](0007-deterministic-simulation-engine.md)) and are not rewound. If an undo brings a queue back, it comes
  back empty. The undo toast says so.
- **Commands are unchanged in every other way.** They stay serialisable and validated against the current document, and
  the typed command bar stays a text front-end for them ([ADR-0011](0011-explicit-linking-and-command-layer.md)).
  Only the undo mechanism changes.
- **How to check it.**
  - A property test asserts `undo(apply(document, command))` is the same reference as `document`, for every command.
  - A property test asserts that after any sequence of do, undo and redo, an engine fed through `reconcile` has the same
    topology as the document.

## Consequences

### Positive

- Undo and redo take constant time, and there is no inverse to get wrong.
- "Undo restores exactly the previous document" is checked with `===`.
- Reference equality is a cheap "did anything change?" for signals, `OnPush` components and autosave.
- Loading and clearing a canvas reuse the same history and `reconcile` path as everything else.

### Negative / trade-offs

- Commands must be written immutably, with structural sharing. The document types are `readonly`, and tests freeze
  documents so a mutation fails loudly.
- A command that rewrites a large branch keeps a second copy of it. Auto-layout, which moves every node, is the worst
  case. The cap of 200 bounds the memory, and the cap can be revisited if profiling shows a problem.
- There is no patch stream to send or merge. Multi-user collaboration is a non-goal
  ([ADR-0002](0002-product-vision-and-scope.md)) and would need a new ADR.
- History does not survive a reload.

## Alternatives considered

- **Patches and inverse patches (Immer-style, or JSON Patch), as ADR-0011 said.** Rejected: every command needs a
  correct inverse, or patch generation that is correct for every shape of change, and a mistake there corrupts undo.
- **A command pattern with an explicit `undo()` on every command.** Rejected: it doubles the code in every command, and
  the inverses still have to be right in every state.
- **Replaying the command log up to step N.** Rejected: undo would take time proportional to the history. The
  equivalent-command log is still kept, for teaching and for scripts, but it does not drive undo.
- **Rewinding the engine as well.** Rejected for M1: runtime snapshots exist for the M2 debugger timeline
  ([ADR-0007](0007-deterministic-simulation-engine.md)), and a design undo should not erase what a learner just watched.

## Related

- [ADR-0007](0007-deterministic-simulation-engine.md), [ADR-0011](0011-explicit-linking-and-command-layer.md),
  [ADR-0012](0012-multiple-canvases-and-local-persistence.md)
- [M1 plan, section 2.3](../plans/m1.md)

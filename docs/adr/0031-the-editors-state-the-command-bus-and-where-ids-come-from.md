# ADR-0031: The editor's state: signal stores, one command bus, and where ids come from

- **Status:** Accepted. The zoom is held by `FlowViewport`, which [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md)
  describes, and not by a `ViewportStore` of its own. The bus also tells its listeners of `undo` and `redo`, takes back the ids of a command that is refused, and has a sixth origin, `typed`
  ([ADR-0046](0046-the-equivalent-command-log-and-the-tests-that-hold-gestures-and-commands-together.md)). The bus also runs the runtime verbs, as [ADR-0054](0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md) says.
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0019](0019-undo-through-immutable-document-snapshots.md),
  [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md) and [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md),
  for the code in the app that holds the document, applies commands to it and saves it.

## Context

The domain has the commands, the history and the rules, and persistence has the repository and the autosave. Neither says how the app
holds a document that changes, how a gesture on the canvas becomes a command, who makes the ids that a command needs
(ADR-0026 says only that the caller does), what a refusal looks like on a screen, or when the autosave starts and stops.
The library that draws the canvas must never change what is on it ([ADR-0016](0016-node-editor-library.md)). S4
([#6](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/6)) builds that layer, and S5 (the equivalent-command log and the
command bar), S6 (the simulation) and S9 (several canvases) all stand on it.

## Decision

### Stores are plain TypeScript over signals

- A store is a class with signals, in `core/state/`, with no template and no RxJS. It is provided by the editor component and not
  by the root, so that each editor has its own, and a spec makes new ones. What is read is a `Signal` that cannot be set from
  outside, and what changes it is a method.
- **`DocumentStore`** holds the document, which is immutable, and a timeline: the domain's `History` and, for each step, a short
  sentence that says what the step did, so that undo can say what it undid. A change of document is a change of reference, which is
  what `OnPush`, `computed` and the autosave compare ([ADR-0019](0019-undo-through-immutable-document-snapshots.md)). Only the
  command bus changes it.
- **`SelectionStore`** holds what is selected, in ids: nodes by id and edges by their key (`from>to`, the key of an edge's label). It
  forgets what is no longer on the canvas whenever the document changes.
- **`StatusStore`** holds the last thing that the learner should be told: a plain message, or a refusal, which is an `Issue`.
- **`ViewportStore`** holds the zoom, for the buttons and the percentage. The viewport itself is the canvas's: it is read from the
  adapter ([ADR-0016](0016-node-editor-library.md)), and is not state of the document.
- **`ThemeService`** and **`Announcer`** are the root's: the first because the theme is a property of the page, and the second
  because every part of the app speaks through the same live region ([ADR-0017](0017-canvas-keyboard-model.md)).

### One command bus, and every apply has an origin

- **`CommandBus.apply(command, origin)` is the only way that the document changes.** It applies the command with `applyCommand` and an id
  from the generator below. If the command is refused, nothing changes and the `Issue` goes to the status store and comes back to
  the caller as a result. If it is accepted and changed something (the document is another object), the previous document goes
  to the timeline, and the selection is pruned. A command that changes nothing leaves no step, as ADR-0026 says.
- **`origin` says what started it**: `gesture` (a pointer on the canvas or in the toolbox), `key`, `inspector`, `toolbar` and `menu`. Every
  listener is told of an applied command with its origin, the command, and the documents before and after, so that S5's
  equivalent-command log can write a line for each one that was not typed, and S6 can follow the engine with `reconcile`. The bus
  keeps no log of its own.
- **`undo(origin)`, `redo(origin)` and `load(document)`** go through the same door. `load` clears the timeline, because a canvas
  that has just been opened has no past ([ADR-0019](0019-undo-through-immutable-document-snapshots.md)).
- **Undo restores the design and not the simulation**, and says so ([ADR-0019](0019-undo-through-immutable-document-snapshots.md)).

### The canvas reports, the editor decides

- **The adapter and the stores talk in ids; commands talk in kind and name** ([ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md)).
  `core/` has the one place that goes from an id to the `{ kind, name }` that a command wants, and the editor uses it at the edge.
- **Foblex's events never change state.** The adapter turns them into intents (`canvas/model/`), the editor turns an intent into
  commands (`editor/`), and the bus applies them. An intent that is not valid is a refusal to show, and not an exception.
- **A drag of a node is one `move` command when the drag ends**, and a drag-to-create is one `batch`, so each is one step of undo.
  The bus describes each in words for the announcement (`added queue billing`) and for the label of the step.

### Where ids come from

- **`IdGenerator` makes the ids that `applyCommand` asks for**: a letter for the kind (`x` for an exchange, `q`, `p`, `c`, `b` for a
  binding) and a number that only goes up. It skips an id that the canvas has, so a canvas that came from a file never meets an id
  that the generator made. The number never goes down, not even on undo, so an id that is in the history is never made again.
  They match `ID_PATTERN` and are unique across the kinds, so `applyCommand` never throws.
- **A name for something new is `queue1`, `queue2`**: the kind and the smallest number that no element of that kind uses. A learner
  renames it, and the name is a word that needs no quotes in the typed command.

### The canvas session: one implicit canvas, saved as it changes

- **`CanvasSession`** owns the repository and the autosave of the canvas. It makes the repository with `Date.now` and
  `crypto.randomUUID`, purges the tombstones that have expired, opens the canvas that was open last or the most recent one, and makes
  one if there is none, with the name "Untitled canvas", and remembers it in the meta store. If the browser does not let the site keep data
  (a private window), it falls back to the repository in memory and says in words that nothing is kept.
- **The autosave schedules each new document** and not the one that was loaded, so that opening a canvas does not change when it
  was edited. It flushes when the page is hidden (`visibilitychange`) and when it is left (`pagehide`).
- **What each write came to is shown**: saved, saving, or not saved and why. A failure keeps the document, and the next change writes
  it. A full disk shows the sentence of ADR-0028 and the browser's own estimate.
- **`persist()` is asked once, after the first save that worked**, and not when the app starts, because a browser weighs what a
  visitor has done ([ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md)). If it is refused, the learner is told to make a backup. The
  quota is read after saves, not more than once in half a minute, and a warning is shown when it is low.
- **Specs make the session with the repository in memory and a timer that they move**, and the end-to-end journeys open IndexedDB in
  a real browser.

### Debugging in the end-to-end build only

- The debug handle gains the document, the selection, the drawn edges, the intents that the adapter reported and the live viewport.
  It reads and never writes. The editor offers them only inside `RMQ_E2E`, so that none of it is in the deployed bundle
  ([ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md)).

## Consequences

### Positive

- Undo, redo, dirty tracking and the autosave all rest on `===`, and nothing can drift from the document, because there is one door
  and it is the same for a drag, a key, the inspector, the toolbox and, in S5, the command bar.
- The library cannot change what is on the canvas, so a bug in it shows as a wrong intent, which a contract test can name.
- A spec of a store or of the bus needs no browser and no Foblex, and a refusal is a value that a component test can read.

### Negative / trade-offs

- A step of undo has a sentence that is made when the command is applied, which is more code than an anonymous step, and each verb
  needs its words.
- Ids that only go up are not the same on two runs of the same script, unless the generator is started the same way. The properties
  of the domain do not use this generator, and a spec of the app makes its own.
- Selection is by id and commands are by name, so there is one conversion, and it has to be right when two kinds share a name.
- The session decides some policy that S9 will revisit when there are several canvases: which one is open, and what its name is.

## Alternatives considered

- **A store that holds the document and also applies commands, with no bus.** Rejected: the origin, the refusal and the
  announcement would be written in every caller.
- **NgRx or another state library.** Rejected: the state is one immutable document and a few small values, and signals are the
  tool that ADR-0005 chose.
- **Ids from `crypto.randomUUID`.** Rejected: an id must start with a letter, a long id makes the debug handle and the failures of a
  test unreadable, and a counter is enough for something that one tab makes.
- **Let the library keep the selection and the positions, and read them back** (Foblex's managed state). Rejected in
  [ADR-0016](0016-node-editor-library.md): the command layer owns undo, and the library never changes what is on the canvas.
- **Schedule the loaded document too.** Rejected: opening a canvas would change the time that it was edited.

## Related

- [ADR-0011](0011-explicit-linking-and-command-layer.md), [ADR-0016](0016-node-editor-library.md),
  [ADR-0019](0019-undo-through-immutable-document-snapshots.md), [ADR-0026](0026-commands-name-elements-and-ids-stay-in-the-document.md),
  [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md).
- [ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md): where this code lives.
- [M1 plan](../plans/m1.md), sections 2.3, 2.4 and 3 (S4).

# ADR-0057: What building S6 settled: folders that run one way, a strip that is a region, frames that cannot jump, and colours read through a probe

- **Status:** Accepted. What wakes the overlay is as built in [`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md), which says that the adapter watches the `style` of the canvas and no other attribute, and that a path that is drawn another way wakes it too.
- **Date:** 2026-10-07
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md) and [ADR-0045](0045-the-command-bar-a-panel-that-types-through-the-same-door.md) (the order of the folders),
  [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md) (the view), [ADR-0054](0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md) (the door of the runtime),
  [ADR-0055](0055-the-overlay-draws-on-a-canvas-outside-change-detection-and-follows-the-real-paths.md) and
  [ADR-0056](0056-counters-stacks-and-slots-are-signals-of-their-own-and-the-controls-are-a-strip-under-the-top-bar.md) (the overlay and the controls), for what S6
  ([#8](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/8)) found when it built what they decided.

## Context

ADR-0050 to ADR-0056 were written before the code. Building and testing it showed where they were silent, and one place where a thing in them did not survive the screen it was drawn on (the strip is not a toolbar). None of these changes what the engine does, what a
command is, or what the overlay draws. They are the small decisions that the tests had to make, written here so that the next slice does not make them again.

## Decision

### The folders, and the way that they look

- **Three folders are new**: `core/runtime/` (the frame loop, the preference for motion, the numbers of the nodes, the sentences of the events, and the simulation service that the bus and the editor use), `canvas/overlay/` (the overlay, its painter, its grouping, its colours, and the numbers that a node says
  of itself) and `simulation/` (the strip, and the parts of the inspector that a queue, a producer and a consumer have).
- **The order is `core`, `canvas/model`, `canvas/overlay`, `canvas/flow`, `command-bar`, `simulation`, `editor`.** A folder may import what is before it and nothing after. The overlay does not import the adapter, the model does not import the overlay, `core/`, `canvas/` and `command-bar/` do not import
  `simulation/`, and `simulation/` does not import the editor, the adapter or the command bar. The editor hosts the strip, the overlay and the parts of the inspector. The adapter hosts the numbers of the nodes, so it imports `rmq-node-stats` from `canvas/overlay/`, and the overlay folder never looks back. It is
  lint (`web/eslint.config.mjs`), and `tools/boundaries/eslint.spec.ts` lints a snippet at each path, so a rule that is loosened fails a case. Foblex is still only in `canvas/flow/`.
- **`core/runtime/` is not called `core/simulation/`**, because the rule that keeps `core/` from importing `simulation/` is a pattern on the path of the import, and a file of the core's own folder of that name would have been refused by it.

### The strip is a labelled region, and not a toolbar

ADR-0056 gave the strip `role="toolbar"`. axe's `region` rule asks that all the content of a page is in a landmark, a toolbar is not one, and so the controls were content outside every region of the page. The strip is a `<section>` with the name "Simulation" now, which is a landmark that a screen reader lists, and the
speed buttons are a group named "Speed" inside it. Its buttons are reached with Tab, as those of the top bar are. A toolbar says that its controls are reached by the arrow keys, which these are not, and a second keyboard model for six buttons is a cost with no gain.

### Time, and what the frames may do

- **A frame lasts at most 100 ms, and the first frame after a rest lasts none.** A page that was in the background, or a machine that stopped for a moment, comes back with the time of all of it in one frame, and the simulation would jump by that much. The loop goes slower for that frame instead.
  The first frame after the loop slept has no frame before it to measure from, so it lasts no time, and the time of the rest is not counted. Both are in the spec of the loop, which runs on `manualFrames` of `@rmq/testing`: a frame of the page that runs when the spec says.
- **The readout of the time is in tenths of a second.** A signal that changed on every frame would check the strip sixty times a second, and the eye cannot read it. The engine's own clock, which `simulationState` gives to a test, is in whole milliseconds.
- **A step is a jump of the clock and a quarter of a second of the picture**, as ADR-0055 says, and `animating()` is what says that the loop goes on while the picture is on its way. Under reduced motion the picture does not take the quarter of a second.

### What the engine's view says

- **The records of `view()` have no prototype.** A canvas may have a queue that is called `__proto__`, `constructor` or `toString`, and a record that is a plain object loses the first and finds the others as properties of every record. The records are made with `Object.create(null)`, and a spec of the engine names a queue,
  an exchange, a channel and a producer like what every object has and asks for ones that are not there. The cost is that code that reads the view uses `[]`, `in` and `Object.keys`, and not the methods of `Object`.
- **A message in the broker says which producer sent it** (`producer`, or `null` when it was published to an exchange with no producer). The overlay needs it for a message that goes to a queue through the default exchange when that exchange is not drawn: it waits at the end of the link that it came along, and that
  link is the producer and what it is linked to (ADR-0055).

### What the overlay reads, and what wakes it

- **The colours are read through a probe.** A custom property that holds a `light-dark()` pair is not resolved by `getPropertyValue`, which gives the text of the pair. The overlay puts a hidden element in its host, gives it each token as its `color`, and reads the colour that the page computed, which has settled the theme. They are
  read again when the document, the theme, the preference for motion or the canvas changes, and after thirty frames while it draws, so that a theme that the system changed is followed.
- **The colour of a message is the routing key's, by a hash.** The key is hashed (FNV-1a), and the hash taken modulo eight chooses one of `--rmq-message-blue`, `-orange`, `-green`, `-pink`, `-gold`, `-gray`, `-violet` and `-cyan`. A shape that stands for several keys is `-mixed`, and every shape has an `-outline`. Each is a `light-dark()` pair like the other tokens
  (ADR-0032), and `tools/theme/tokens.spec.ts` holds that each is at least 3:1 against the canvas and against the outline in both themes, and that the eight are told apart in each. The ring, the badge and the key as a word say it as well, so colour is never the only sign.
- **What wakes the loop** is what can move a message on the screen without the clock moving: the document, the theme, the preference for motion, a resize of the host (`ResizeObserver`, where there is one), and the canvas itself. The library says that the canvas moved only when a gesture ends, and a pan or a zoom has to be followed
  while it goes on, so the adapter watches the `style` and `transform` of the canvas's host with a `MutationObserver` and `FlowViewport.moved` counts what it saw. A clock that is stopped, with messages in flight, is drawn once for each such change and costs nothing between them.
- **What is where is asked for inside the frame.** The ids that the names of the engine are on the canvas are worked out again when the document is another one, by the frame, and not by an effect that runs after it, so that a frame never draws by a canvas that has gone: a rename or a delete just before it
  would have put a message on an edge that was not there.

### What the bar and the bus do without the flag

The runtime verbs are commands whether or not the flag `simulation` is on: the bar completes and explains them, `docs/commands.md` and the cheat-sheet list them, and the grammar is one thing. The bus is not given a host without the flag, and refuses to run one with an issue of the kind `unsupported`, which says that the
simulation is not switched on yet and how to switch it on (`?ff=simulation`). The keys that are for the flag, Space, `.` and `P`, are the page's without it, and the hint bar and the cheat-sheet do not say them (ADR-0054).

### The parts of the inspector

- **`Fields` is what a part has to edit with commands**: it applies a command with the origin `inspector`, keeps what each field was refused for until something else is selected, and puts back what the document has. A text that is not a number is refused by the field, with a sentence of its own, before any command exists, and a number that is the
  document's is no command, so that it leaves no line in the log and no step of undo.
- **A control that cannot be refused has no place for a refusal.** How a consumer acknowledges is a choice of two values and whether a producer repeats is a switch, and both are always accepted, so the choice is the document's as soon as it is made.
- **The buttons that use a line of the log again are 24 pixels**, which is what WCAG 2.5.8 asks for a target, and which axe found they were not.

### The tests

- **A test of the browser steps the engine and does not wait for it.** `SimulationPage.open` stops the clock. `step()` presses the button and waits for what the engine says to change (`nextAt`, and `simulationState`), and the overlay is read after `settledFrame()`, because the picture takes a quarter of a second to get where the clock is. A test that needs the
  clock to run, for the speed and for reduced motion, reads the engine's time and the frame, and never a time of the wall.
- **Every new state of the screen is held to axe in both themes**: the strip, the numbers on the nodes with a message on its way, the inspector of a queue that holds messages, of a producer and of a consumer, a field that was refused, and the cheat-sheet with the keys of the flag.
- **The budget of three seconds for 200 nodes and 500 edges holds with the flag on**, and a burst of a thousand messages on that canvas is five shapes at the most. Frame rates are measured on real hardware in S12.
- **The cheat-sheet's test asks the registry how many commands there are.** It said 23, which was true until the runtime verbs joined the registry, and a list that is made from a registry should be counted against it.

## Consequences

### Positive

- The way the folders look is checked by the linter and by a spec, and a slice that adds a part of the screen knows where it goes.
- A tab that comes back from the background does not make the simulation jump, and a loop that sleeps does not owe it the time that it slept.
- A theme that changes while messages move is followed, and a pan while the clock is stopped moves the messages with the canvas, with no code of its own in the overlay.
- A queue called `constructor` is a queue.

### Negative / trade-offs

- A reader of the strip cannot move through its buttons with the arrow keys, and finds the strip in the list of landmarks. That is eight stops of Tab, and the same as the top bar.
- Reading the palette through a probe asks the page to settle its styles once for every thirty frames while messages move, which is a few hundred microseconds. If it ever shows in a profile, the answer is to read it when the theme changes only, and the cost is a theme that the system changed not being followed until
  the next change of anything.
- A record that has no prototype is not a plain object: a spec that compares it with `toEqual` against a literal is fine, and one that calls `hasOwnProperty` on it throws.
- `Fields` and `NodeStatsView` are made for these parts, and the inspector's own fields have their own, older, way to do the same. They are not merged here: it would change the inspector of S4.

## Alternatives considered

- **A toolbar with arrow keys.** Rejected for the reason above: the strip would promise a model of the keyboard that the top bar next to it does not have.
- **The strip inside a landmark that exists** (the banner of the top bar). Rejected: the top bar is a banner, and controls that act on the canvas are not the page's header.
- **The colours read once, when the app starts.** Rejected: the theme can change while the app is open, from the switch and from the system.
- **The colours as a table in the code.** Rejected: ADR-0032 puts every colour in a token, a theme is a set of tokens, and the contrast of a table in the code would not be held by the spec that holds the others.
- **A map for the view's records.** Rejected: the view is read by the screen and the tests as data, and a `Map` is not a record in a snapshot or in a failure message. A record with no prototype is one in every way but its methods.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md), [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md),
  [ADR-0036](0036-the-test-strategy-of-the-editor.md), [ADR-0045](0045-the-command-bar-a-panel-that-types-through-the-same-door.md), [ADR-0048](0048-what-building-s5-settled-ctrl-k-in-a-field-a-bar-that-keeps-its-draft-a-top-bar-that-fits-and-tests-that-wait.md).
- [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md), [ADR-0054](0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md),
  [ADR-0055](0055-the-overlay-draws-on-a-canvas-outside-change-detection-and-follows-the-real-paths.md),
  [ADR-0056](0056-counters-stacks-and-slots-are-signals-of-their-own-and-the-controls-are-a-strip-under-the-top-bar.md).
- [`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md): what S6 settled that is easy to revisit.

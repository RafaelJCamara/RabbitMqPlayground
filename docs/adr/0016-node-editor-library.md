# ADR-0016: Node editor library — Foblex Flow

- **Status:** Accepted. The adapter and its four workarounds, as built, are in [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md), and the suite that guards them is
  [ADR-0034](0034-the-foblex-contract-suite-and-how-an-upgrade-fails-loudly.md).
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

We need an Angular-native node-graph editor ([ADR-0005](0005-frontend-angular.md)). It must support:

- custom nodes for producers, exchanges, queues, consumers and workers;
- handle-based linking with validation ([ADR-0011](0011-explicit-linking-and-command-layer.md));
- edges that carry several key chips;
- a message-animation overlay that stays in sync with the viewport
  ([ADR-0007](0007-deterministic-simulation-engine.md)).

Two maintained, MIT-licensed candidates stood out: [Foblex Flow](https://github.com/Foblex/f-flow) (19.3.0) and
[ngx-vflow](https://github.com/artem-mangilev/ngx-vflow) (2.7.0). Both declare support for Angular 22.

This ADR was proposed with a time-boxed spike to settle the choice. The product owner set three priorities for close calls:
**keyboard and accessibility**, **performance at scale**, and **maintenance and community health**.

## Decision

Use **Foblex Flow** (`@foblex/flow`, 19.3.0 at the time of the spike) in its *classic* mode: the app owns the state, and
the library emits final interaction events. All library code sits behind one adapter, so the rest of the app depends
only on our own interfaces.

### Integration rules (from the spike)

- **Source of truth.** The command layer and graph store ([ADR-0011](0011-explicit-linking-and-command-layer.md)) stay
  the single source of truth. Library events (`fCreateConnection`, `fMoveNodes`, `fDragStarted` / `fDragEnded`) become
  commands; the library never changes app state.
- **DOM structure.** Node and connection elements are direct children of the canvas layers, which Foblex requires.
  What goes *inside* a node can be our own components.
- **Readable chips.** Binding-key chips stay readable. The canvas layer order (`withFCanvas({ layers })`) can put
  connections and their labels above nodes where needed.
- **Workarounds.** Two are contained in the adapter, and each is guarded by tests that fail loudly on a library upgrade:
  1. **Live viewport for the message overlay.** We read `FCanvasComponent.transform`, which is public in the typings but
     undocumented. The documented `fCanvasChange` is debounced and fires only at the end of a gesture, and
     `getPosition()` ignores the zoom offset.
  2. **Link validation.** Foblex offers only an allow-list (`fCanBeConnectedTo`), read when a drag starts. The adapter
     fills it from our rules for the pressed handle on `pointerdown`. This took ~4 ms on 200 nodes / 500 edges.
- **Invalid drop vs empty-canvas drop.** Both arrive as "no target". The adapter tells them apart with a hit test, so we
  can explain an invalid drop or open the create menu.
- **Accessibility.**
  - Keep Foblex's ARIA layer, which is on by default.
  - Provide our own `aria-label`s, because the default names are poor (e.g. "order-eventsqueue").
  - Adopting Foblex's keyboard layer in place of ADR-0011's focusable-node model is decided in a follow-up ADR, before
    keyboard work starts in M1. Foblex's layer uses one tab stop with `aria-activedescendant` and `C` to connect.
- **Theme.** Foblex's SCSS theme is wired in globally through `angular.json`, not per component.

## How we decided: the spike

**What was built.**
- The same prototype twice, on Angular 22.2 (zoneless), against a shared harness:
  - a graph store applying the ADR-0011 link rules;
  - five node types;
  - handle linking with validation, with valid targets highlighted while dragging;
  - an explanation shown when a drop is invalid, and a create menu when dropping on empty canvas;
  - keyboard linking (L / Tab / Enter);
  - an edge carrying several chips;
  - dagre auto-layout and a minimap;
  - a Canvas2D message overlay drawn from the live viewport.

**How it was measured.**
- Playwright ran 21 functional checks with mouse, keyboard and touch.
- A performance run took 5 trials of 200 nodes / 500 edges each.
- It used headless Chromium with software rendering, so the numbers compare the two libraries; they are not absolute.
- Overlay drift was sampled just before paint: painted nodes against the transform the overlay drew with.

**Functional results.** Both passed **21/21** with no console errors. The prototypes needed **7** workarounds with
Foblex Flow and **11** with ngx-vflow.

| Medians of 5 trials | Foblex Flow | ngx-vflow |
|---|---|---|
| First render, 200 nodes / 500 edges | **349 ms** | 471 ms |
| JS heap after load | **22.7 MB** | 29.2 MB |
| Drag-pan / wheel zoom / node drag | 58.5 / 60 / 58 fps | 60 / 60 / 60 fps |
| Programmatic camera animation | 46 fps | **58 fps** |
| … with the 500-dot overlay running | 39 fps | **53 fps** |
| Overlay vs nodes at paint (pan, wheel, programmatic) | 0 px | 0 px |
| Production bundle of the whole app (gzip) | 166 KB | **126 KB** |

**Against the priorities:**

| | Foblex Flow | ngx-vflow |
|---|---|---|
| **Keyboard and accessibility** | ARIA layer on by default: roles, live-region announcements, localisable messages. Opt-in keyboard layer: spatial navigation, keyboard move, delete, zoom, and keyboard linking. In the spike, keyboard linking offered exactly the targets our rules allow | None: no `tabindex`, `role` or `aria-*`. The default raise-on-click drops keyboard focus |
| **Performance at scale** | Faster first render, less memory, but slower programmatic camera animation | Smoother programmatic camera animation and a smaller bundle |
| **Maintenance (Oct 2026)** | 37 releases in 12 months, the latest on 2026-09-27. 24 of the last 25 issues closed. 8 open issues, 0 open PRs | 16 releases, the latest on 2026-09-03 after a 4-month gap. 14 of the last 25 issues closed. 22 open issues and 10 open PRs, including edge flicker in zoneless mode (#240) |
| **Must-haves** | All met; the live viewport needs the undocumented field above | All met |

## Consequences

### Positive

- **Accessibility head start** towards WCAG 2.2 AA ([ADR-0010](0010-explanation-first-editor-ux.md)): ARIA semantics
  plus a working keyboard layer.
- **An actively maintained dependency** that fixes issues quickly.
- **Fits the command layer.** Classic mode means the library never mutates app state
  ([ADR-0011](0011-explicit-linking-and-command-layer.md)).
- **Built-ins we would otherwise write:** minimap, pinch and double-click zoom, a click-to-connect gesture, snap
  preview, layer ordering, and dagre/ELK layout adapters. Its managed state with undo/redo is not used: our command
  layer owns undo.
- **The overlay design is confirmed** ([ADR-0007](0007-deterministic-simulation-engine.md)): 0 px drift at paint.

### Negative / trade-offs

- **Undocumented behaviour.** Two workarounds rely on it: the live transform field, and when the validation allow-list
  is read. They stay in the adapter, covered by tests, and we will ask upstream for a live viewport signal and a
  validator callback.
- **Slower programmatic camera animation** (46 vs 58 fps in the spike). To compensate:
  - prefer the library's own animated camera calls (`fitToScreen`, `resetScaleAndCenter`);
  - keep scripted camera moves short;
  - re-measure on real hardware in M1.
- **About 40 KB more gzip** than ngx-vflow.
- **Edge geometry is computed asynchronously** in a Web Worker, so tests and the overlay need to wait until edges are
  actually drawn.
- **Templates can't be split.** Nodes and connections must be direct children of the canvas layers, so their templates
  can't be spread across wrapper components.
- **Node positions arrive only when a drag ends.** That suits commands, but overlay dots on a dragged node's edges lag
  until the drop.
- **Keyboard model.** ADR-0011's keyboard model has to be reconciled with Foblex's keyboard layer in a follow-up ADR.

## Alternatives considered

- **ngx-vflow.** It has a cleaner validator hook and viewport signal, a smaller bundle and smoother programmatic camera
  animation. Rejected because:
  - it has no accessibility support, so we would build all of it;
  - maintenance is slower, with relevant open issues (zoneless edge flicker, moving away from `foreignObject`);
  - edge labels always render below nodes, so binding chips get hidden;
  - it needed 11 workarounds.
- **A custom SVG editor on Angular CDK** (the fallback). Not needed: both libraries met the must-haves.

## Related

- [ADR-0005](0005-frontend-angular.md), [ADR-0007](0007-deterministic-simulation-engine.md),
  [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0011](0011-explicit-linking-and-command-layer.md),
  [ADR-0015](0015-testing-strategy-and-definition-of-done.md)
- [Foblex Flow](https://github.com/Foblex/f-flow) · [ngx-vflow](https://github.com/artem-mangilev/ngx-vflow)

# ADR-0017: Canvas keyboard model — adopt Foblex Flow's keyboard layer

- **Status:** Accepted. The keyboard service of the app is settled by [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md).
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara
- **Supersedes:** in [ADR-0011](0011-explicit-linking-and-command-layer.md), keyboard linking (item 4 of "Five ways to
  link") and the "Initial keyboard shortcuts" table.

## Context

[ADR-0011](0011-explicit-linking-and-command-layer.md) designed keyboard linking around focusable nodes: select a
node, press `L`, use **Tab** to cycle targets, **Enter** to link and **Esc** to cancel. It also gave Space to
play/pause.

[ADR-0016](0016-node-editor-library.md) chose Foblex Flow, which ships an accessibility engine. We read its source
and tried it in the spike:

- **Semantic layer (always on).** Nodes and connections get roles, role descriptions and accessible names. State
  changes are spoken through a live region (WCAG 4.1.3), using a message catalog we can override.
- **Keyboard layer (opt-in through `withA11y(...)`).**
  - The canvas is a **single tab stop**. The active item is exposed with `aria-activedescendant`, and selection
    follows focus.
  - Arrow keys navigate spatially over nodes *and* connections.
  - It provides keyboard move, keyboard linking through the same session and validation as pointer linking, delete
    requests and zoom keys.
  - It brings the focused item into view (WCAG 2.4.11) and never captures keys typed into inputs.
- **Spike result.** Keyboard linking offered exactly the targets our rules allow, and committed through the same
  `fCreateConnection` handler as a mouse drop.

The two models clash in three places:

| | ADR-0011 | Foblex keyboard layer |
|---|---|---|
| Focus | one tab stop per node | one tab stop for the whole canvas |
| Choosing a link target | Tab / Shift+Tab | arrow keys, nearest target in that direction |
| Space | play/pause | pick up a node to move it |

A tab stop per node means hundreds of Tab presses to get past a large canvas. The WAI-ARIA Authoring Practices
recommend a single tab stop, with arrow keys inside, for composite widgets like this one. The accessibility target is
WCAG 2.2 AA ([ADR-0010](0010-explanation-first-editor-ux.md)).

## Decision

Adopt Foblex Flow's keyboard layer as the canvas keyboard model, configured with our keys and our wording:

```ts
provideFFlow(withA11y({ keys: { connect: ['l'], grab: ['m'] }, messages: { /* our domain wording */ } }))
```

### 1. Focus and navigation

- **One tab stop.** The canvas is a single tab stop. **Tab / Shift+Tab** move between the app's regions (toolbox,
  canvas, inspector, bottom panel) and are never captured inside the canvas. Node elements are not tab stops.
- **Arrow keys** move to the nearest node or connection in that direction; the opposite arrow goes back.
  - **Shift+arrows** extend the selection.
  - **Home / End** jump to the first / last node.
  - **Ctrl/Cmd+arrows** walk along connections.
- **Selection follows focus.** The active item *is* the selection, and the inspector shows it. Every keyboard command
  acts on the selection (from `fSelectionChange`), not on DOM focus.
- **Escape** cancels the current mode, or clears the selection. **Ctrl/Cmd+A** selects all.

### 2. Keyboard linking (replaces ADR-0011's L / Tab / Enter)

- **Start.** Select exactly one node and press **`L`**.
- **Choose a target with the arrow keys.** The first target offered is the nearest node not already linked.
  - Only targets our link rules allow are offered. The adapter loads the allowed targets for the selected node when the
    selection changes, as well as when a handle is pressed ([ADR-0016](0016-node-editor-library.md)).
- **Enter** links, through the same command path as every other link (`bind` / `link` / `subscribe`), so it is
  undoable and logs its equivalent command ([ADR-0011](0011-explicit-linking-and-command-layer.md)). **Escape** cancels.
- **Announcements.** Each step is announced in our words, for example *"Linking from exchange orders. Target 2 of 4:
  queue billing."* If nothing can be linked, the announcement says so.
- **Dropped from ADR-0011:** "two nodes selected + `L` links them directly". The command bar
  (`bind orders -> billing`) and the searchable "Link to…" picker cover that case.

### 3. Moving, deleting, zooming

- **`M`** picks up the selection.
  - Arrow keys move it 10 px (Shift+arrows: 50 px).
  - Tap `M` again to drop it, or hold `M` while using the arrows and release to drop. **Escape** puts it back.
  - The drop is a single `move` command.
- **Delete / Backspace** request deletion, which runs our undoable `delete` command. The library never changes the
  graph itself.
- **`+` / `−` / `0`** zoom in, zoom out, and reset zoom.

### 4. App shortcuts

These are handled by the app, not by Foblex.

| Action | Keys | Active when |
|---|---|---|
| Play / pause the simulation | Space | canvas focused |
| Step one event | `.` | canvas focused |
| Publish from the selected producer | `P` | canvas focused |
| Rename the selected item | F2 | canvas focused |
| Edit the selected item in the inspector (Esc returns to the canvas) | Enter | canvas focused, no mode active |
| Fit view | `F` | canvas focused |
| Cheat-sheet | `?` | canvas focused (a Help button works everywhere) |
| Command bar | `/` (canvas), Ctrl/Cmd+K (anywhere) | |
| Undo / redo | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | anywhere except text fields, where they edit the text |

Rules for the app's keyboard handler:

- **Scope (WCAG 2.1.4).** Single-character shortcuts work only while the canvas has focus. They include Foblex's `L`,
  `M` and zoom keys.
- **Ignore handled keys.** Skip events Foblex already handled (`defaultPrevented`) and events from text inputs,
  `contenteditable` or interactive content inside nodes.
- **No modifiers on single keys.** A modifier combination never triggers a single-key action. Foblex matches the
  grab key before checking modifiers, so a capture-phase guard in the adapter filters out cases like Ctrl/Cmd+M. A
  test covers it.

### 5. Names, announcements and visible focus

- **Our own `aria-label` on every node and connection.** Foblex keeps labels set by the app. Labels describe identity,
  not live counters, so a running simulation doesn't make the screen reader chatter. Examples:
  - *"Queue order-events"*;
  - *"Binding from exchange orders to queue order-events, keys order.\*, invoice.#"*.
  Live counts are in the inspector and the event log.
- **Our own wording.** Foblex's message catalog is overridden with our terms, and the standing instructions list our
  keys.
- **App status messages** (link errors, import results, play/pause/step) go through the same live region.
  Individual simulation events are not announced.
- **Visible focus (WCAG 2.4.7 and 1.4.11).**
  - DOM focus stays on the canvas, so the app draws a visible focus ring on the active item whenever the canvas has
    keyboard focus. The ring has at least 3:1 contrast.
  - Toasts and panels must not cover the active item (WCAG 2.4.11).

### 6. Pointer requirements that go with this (WCAG 2.2)

- **Dragging Movements (2.5.7).** Every drag has a single-pointer alternative:
  - **linking:** the "Link to…" picker, plus Foblex's click-to-connect gesture (`withConnectionFlow('click')`);
  - **moving nodes:** X/Y fields in the inspector, and auto-layout;
  - **panning:** clicking the minimap, zoom buttons, and fit view.
- **Target Size (2.5.8).** Connection handles keep their 12 px dot but get a hit area of at least 24 × 24 px.

## Consequences

### Positive

- **The standard pattern.** It follows the WAI-ARIA pattern for large composite widgets, scales to big canvases, and
  gives screen-reader users entry instructions, the active item and announcements without us building any of it.
- **Much less code.** Navigation, keyboard move, keyboard linking, delete requests, zoom keys, keeping the focused item
  visible, and announcements come from the library.
- **One path for every link.** Keyboard linking stays on `L` and uses the same validation and command path as mouse
  and touch linking.
- **WCAG coverage is explicit:** criteria 2.1.1, 2.1.2, 2.1.4, 2.4.7, 2.4.11, 2.5.7, 2.5.8 and 4.1.3 are each
  addressed.

### Negative / trade-offs

- **Library dependency.** Keyboard behaviour now depends on Foblex. Keyboard-only end-to-end journeys and the
  accessibility checks ([ADR-0015](0015-testing-strategy-and-definition-of-done.md)) guard it across upgrades.
- **`role="application"`** turns off the screen reader's browse mode inside the canvas, so users rely on the
  instructions and announcements. The inspector and event log stay ordinary readable regions.
- **Link targets are chosen spatially.** A distant target takes several arrow presses; the searchable "Link to…" picker
  and the command bar are faster for that.
- **Tests change.** They follow the selection and `aria-activedescendant`, not DOM focus on nodes. The spike's
  focusable-node markup changes accordingly.
- **Two non-default keys.** `M` for move and `L` for link must be explained in the instructions and the cheat-sheet.
- **One shortcut is lost:** the two-nodes + `L` shortcut from ADR-0011.

## Alternatives considered

- **Keep ADR-0011's model.** A tab stop per node, Tab cycles link targets, and Foblex's keyboard layer stays off.
  Rejected:
  - hundreds of tab stops on large canvases;
  - we would build navigation, keyboard move and announcements ourselves;
  - capturing Tab inside linking mode is non-standard.
- **Hybrid.** Foblex for navigation, move, delete and zoom; our own L / Tab / Enter linking on top. Rejected: two linking
  systems, inconsistent announcements, and Tab captured while linking.
- **Space picks up nodes and `K` plays/pauses** (Foblex's default plus video-player convention). Rejected by the product
  owner: play/pause is the most frequent action in a simulator, so Space keeps it.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0011](0011-explicit-linking-and-command-layer.md) (partly
  superseded), [ADR-0015](0015-testing-strategy-and-definition-of-done.md),
  [ADR-0016](0016-node-editor-library.md)
- [WAI-ARIA APG: Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

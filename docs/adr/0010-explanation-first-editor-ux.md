# ADR-0010: Explanation-first editor UX

- **Status:** Accepted. The visual language of the editor (tokens, themes, a colour and a shape for each kind of node) is settled by
  [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md), and the chips on edges, the places of the labels and the lints as badges by
  [ADR-0044](0044-edges-carry-chips-labels-are-placed-greedily-and-dragged-and-lints-are-badges.md). The animation is settled by [ADR-0055](0055-the-overlay-draws-on-a-canvas-outside-change-detection-and-follows-the-real-paths.md), and the controls, the counters and the stacks by [ADR-0056](0056-counters-stacks-and-slots-are-signals-of-their-own-and-the-controls-are-a-strip-under-the-top-bar.md).
  The explanation is settled by [ADR-0059](0059-a-topic-miss-is-aligned-from-both-ends-and-explainmiss-gives-each-exchange-once.md) and [ADR-0060](0060-the-explanation-of-a-route-is-one-function-in-the-domain-and-its-text-is-what-the-golden-files-hold.md) (what it says), [ADR-0061](0061-the-event-log-is-a-ring-of-rows-that-puts-a-command-before-what-it-made-and-a-row-selects-what-it-explains.md) (the event log),
  [ADR-0062](0062-why-is-painted-by-the-adapter-with-classes-from-an-emphasis-and-the-reasons-are-words-on-the-labels.md) (Why?), [ADR-0063](0063-the-message-inspector-opens-from-a-row-a-list-or-a-marker-and-says-so-when-its-route-is-gone.md) (the message inspector) and [ADR-0064](0064-the-what-if-and-the-topic-tester-read-the-canvas-and-change-nothing-and-explain-is-one-flag-in-two-halves.md) (the testers).
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

The UX of earlier simulators held them back:

- a small, fixed canvas, with no zoom or pan, no tidy layout for many exchanges and no full-screen mode;
- hidden gestures: linking by holding Alt or Shift while dragging, which few users found;
- labels that overlap and are hard to read;
- no undo: a link or an element that was added by mistake could not be deleted without starting over;
- no way to see *why* a message went where it did.

Our core difference is to **teach by showing** ([ADR-0002](0002-product-vision-and-scope.md)). Every decision the
engine makes should be visible and explained.

## Decision

### Layout

- **Top bar:** canvas tabs, play controls, Share.
- **Left:** toolbox.
- **Centre:** the canvas, which fills the window.
- **Right:** inspector.
- **Bottom:** the hint bar ([ADR-0011](0011-explicit-linking-and-command-layer.md)), plus a collapsible panel for the
  event log and, from M2, the timeline.
- **No modal dialogs for editing.** Editing happens in popovers and the inspector. Confirmation dialogs are only for
  destructive bulk actions, such as deleting all canvases.

### Editing (M1 unless noted)

- Zoom, pan and fit-to-view.
- Toolbox: drag a node onto the canvas, or click to add it.
- Inspector with inline validation and help tooltips.
- Inline rename, context menus, delete. **Undo/redo for every change.**
- Auto-layout: producers → exchanges → queues → consumers.
- Readable labels: they avoid overlapping, can be dragged, and long ones become chips with the full text on hover.
- Lints, shown as badges on nodes:
  - basic ones in M1 (an exchange without bindings; `x-match=any` with no conditions);
  - more in M2 (an empty topic word; deprecated transient queues; dangling AE/DLX references).
- In M2: minimap, snap-to-grid, multi-select, copy/paste/duplicate, align/distribute, and a toggle for the built-in
  `amq.*` exchanges.

### Explanation (the core difference)

- **Event log.** Filterable and colour-coded. Clicking an event highlights its path. Mouse actions also log their
  equivalent command.
- **Message inspector.** Open a message from the log or a queue's message list (or click a moving one while paused).
  It shows the payload, headers, properties and the full **route trace**.
- **Route overlay ("Why?").** On publish, every binding that was considered is shown at once: matches glow, misses dim
  with a short reason. Click any queue to ask "why didn't it get here?". Topic keys are aligned word by word.
- **What-if tester.** Type a routing key and/or headers without publishing; the queues that *would* receive the message
  light up.
- **Inline topic tester.** While a binding key is being typed, sample keys that match and don't match are listed.
- **In M3:** explanations of redelivery and ordering (the redelivered flag, `x-delivery-count`, "why is this out of
  order?").

### Simulation controls

- **Messages.** Animated along edges, each showing its key and colour. Bursts are grouped under a "×N" badge.
- **Controls.** Play/pause, speed (0.25×–4×), **step one event**, clear messages, reset counters.
- **Counters.** Per node: published, routed, unroutable, depth, consumed. Sparklines and rates arrive in M2.
- **Timeline (M2).** A debugger-style timeline you can scrub, then rewind, edit and replay.
- **Reduced motion.** Follows the OS setting and changes **rendering only**, never the simulation's timing
  ([ADR-0007](0007-deterministic-simulation-engine.md)).

### Visual language and accessibility

- **Colour and shape.** Each node type has its own colour **and** icon/shape, and each exchange type has a badge.
  The palette is colour-blind-safe, and shapes back up the colours.
- **Themes.** Light, dark and system, built on design tokens.
- **Accessibility target: WCAG 2.2 AA.**
  - Everything can be done from the keyboard, including linking
    ([ADR-0011](0011-explicit-linking-and-command-layer.md)).
  - Visible focus, ARIA labels and live regions for simulation events.
  - Checked with axe in CI ([ADR-0015](0015-testing-strategy-and-definition-of-done.md)).
- **Presentation mode (M2).** Full screen, panels hidden, larger type, and a laser-pointer highlight.

### Devices

- Built for desktop first, with touch support on tablets.
- A phone layout (view and play only) comes later.

## Consequences

### Positive

- Users understand routing instead of guessing at it, which serves learning, teaching and debugging alike.
- No hidden interactions, and the app is usable from the keyboard and with assistive technology.

### Negative / trade-offs

- The explanation features depend on the engine producing a detailed trace
  ([ADR-0007](0007-deterministic-simulation-engine.md)).
- A rich UI surface needs strong component and end-to-end test coverage
  ([ADR-0015](0015-testing-strategy-and-definition-of-done.md)).

## Alternatives considered

- **Keep the minimal UI of earlier simulators.** Rejected: it was the main complaint.
- **Modal forms for editing.** Rejected: they interrupt the flow and hide the canvas.
- **Step mode that moves one hop at a time.** Rejected: routing is atomic, so the step is one engine event.

## Related

- [ADR-0011](0011-explicit-linking-and-command-layer.md): linking, the hint bar and the command bar.
- [ADR-0007](0007-deterministic-simulation-engine.md): the events behind every explanation.

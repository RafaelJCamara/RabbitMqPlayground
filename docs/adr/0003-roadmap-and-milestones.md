# ADR-0003: Roadmap — MVP and v1 milestones

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

The product owner put almost every capability into **v1**:

- The advanced RabbitMQ behaviours: unroutable handling, acks/prefetch, dead-lettering/TTL/length limits,
  priorities/SAC, RPC, publisher confirms, queue lifecycle, quorum queues and streams.
- Every extra: guided lessons, code generation, embed mode and challenges.

A v1 that large has to be split into milestones that each ship something usable from `main`
([ADR-0004](0004-trunk-based-development-on-main.md)). The milestones also have to respect technical dependencies:

- Dead-lettering needs consumer outcomes.
- RPC needs the worker node.
- Lessons need the command layer.
- The timeline needs runtime snapshots.

## Decision

| Release | Milestone | Theme |
|---|---|---|
| **MVP** | **M1 · Build & route** | Parity with earlier simulators (done better); the **headers exchange**; explicit linking (canvas, shortcuts, command bar); **multiple canvases**; **share links**; the explainer and what-if tester; realistic consumers; the full test harness |
| **v1** | **M2 · Observe & share** | Debugger timeline, `definitions.json` import, `?src=`, image export, presentation mode, offline support, power-editing |
| **v1** | **M3 · Reliability** | Unroutable handling, publisher confirms, ack outcomes and redelivery, DLX/TTL/length limits, queue lifecycle, connections/crash, broker restart, policies |
| **v1** | **M4 · Queue types & patterns** | Priorities, consumer priority, single active consumer, quorum queues, **streams**, **RPC**, worker pipelines |
| **v1** | **M5 · Learn & build** | Guided lessons, challenges, code generation, embed mode, glossary |
| **Later** | — | See below |

**Rules**

- Milestones ship in order. Each one is released from `main` once it meets the definition of done
  ([ADR-0015](0015-testing-strategy-and-definition-of-done.md)).
- Work on a later milestone can start early, but only behind a feature flag
  ([ADR-0004](0004-trunk-based-development-on-main.md)).
- Moving a feature between milestones is a scope change. Record it by superseding this ADR.

### M1 · Build & route (MVP)

**Editor** ([ADR-0010](0010-explanation-first-editor-ux.md))
- [ ] The canvas fills the window, with zoom/pan and fit-to-view.
- [ ] Toolbox: drag a node onto the canvas, or click to add it.
- [ ] Inspector panel with inline validation and help.
- [ ] Inline rename, context menu, and delete for nodes, edges and bindings.
- [ ] Name validation, including the reserved `amq.` prefix.
- [ ] Undo/redo for every change.
- [ ] Auto-layout: producers → exchanges → queues → consumers.
- [ ] Readable labels: they avoid overlapping, can be dragged, and long ones become chips.
- [ ] Light, dark and system themes. Each node type has its own colour and icon/shape, and each exchange type has a
      badge.
- [ ] Basic lints:
  - an exchange without bindings;
  - `x-match=any` with no conditions.

**Linking and commands** ([ADR-0011](0011-explicit-linking-and-command-layer.md))
- [ ] Five ways to link: drag a handle, the "Link to…" button, the context menu, the `L` shortcut, and a typed command.
- [ ] Hint bar, a first-run "How to link" card, and a `?` cheat-sheet.
- [ ] Drag-to-create, the binding popover, validity feedback and connection rules.
- [ ] Command bar (`/`, Ctrl/Cmd+K) with autocomplete, history and `help`. Mouse actions log their equivalent command.

**Topology and engine** ([ADR-0007](0007-deterministic-simulation-engine.md),
[ADR-0008](0008-rabbitmq-fidelity-baseline.md))
- [ ] Exchanges:
  - direct, fanout, topic and **headers**;
  - durable, auto-delete and internal flags;
  - exchange-to-exchange bindings;
  - a default-exchange toggle that shows its implicit bindings.
- [ ] Queues:
  - a name, or a server-generated one;
  - the durable flag;
  - stacked messages, with ready and unacked counts;
  - a message list and a purge action.
- [ ] Producers:
  - publish to an exchange, or to a queue through the default exchange;
  - a composer for the payload, routing key and headers;
  - send once, send a burst, or send on an interval.
- [ ] Consumers:
  - can subscribe to several queues;
  - processing time, auto or manual ack, and prefetch, with the slots drawn on the node;
  - round-robin among consumers that have free prefetch;
  - pause sends `basic.cancel`; remove closes the channel and requeues unacked messages as redelivered.
- [ ] Routing is decided all at once, at publish time. Topic and headers follow the pinned version's rules.
      Exchange-to-exchange bindings are safe from cycles. A queue gets at most one copy of each message, and each
      message goes to one consumer. Unroutable messages "poof".

**Headers exchange** ([ADR-0009](0009-headers-exchange-support.md))
- [ ] Binding editor with all four x-match modes, typed values and *exists* conditions.
- [ ] "Create binding from this message", and a live match table.
- [ ] Canvas chips and the producer headers table.
- [ ] The matching rules, an export warning for *exists* conditions, and per-condition explanations.

**Simulation and explanation** ([ADR-0010](0010-explanation-first-editor-ux.md))
- [ ] Animated messages, and a "×N" badge for bursts.
- [ ] Play/pause, speed (0.25×–4×), step one event, clear messages, reset counters.
- [ ] Reduced motion, which changes rendering only.
- [ ] Per-node counters.
- [ ] Event log: filterable, colour-coded, and clicking an event highlights its path.
- [ ] Message inspector, opened from the log or a queue's message list, with the route trace.
- [ ] Route overlay ("Why?"), including "why didn't it get here?".
- [ ] What-if tester and inline topic tester.

**Canvases, sharing and files** ([ADR-0012](0012-multiple-canvases-and-local-persistence.md),
[ADR-0013](0013-self-contained-share-links.md), [ADR-0014](0014-broker-interop-via-definitions-json.md))
- [ ] Multiple canvases:
  - tabs and a "My canvases" home;
  - new, rename, duplicate, share, export, and delete with undo;
  - clear canvas;
  - delete all, with an offer to export a backup first, and undo;
  - backup export and import;
  - IndexedDB autosave and a storage-quota warning.
- [ ] Share links:
  - "Copy link" makes a snapshot;
  - share the topology only, or include queued messages;
  - a shared-canvas view with "Save a copy";
  - a warning for long links, with a download fallback;
  - strict validation of incoming links.
- [ ] Native JSON save and load, with a versioned schema and migrations.
- [ ] `definitions.json` export to a chosen vhost.

**Learning**
- [ ] Onboarding: start from a template, build from scratch, or take a 60-second tour (which covers linking).
- [ ] Templates: Hello World, Work Queues, Pub/Sub, Routing, Topics and Headers routing. Each opens as a new canvas.

**Quality and project** ([ADR-0004](0004-trunk-based-development-on-main.md),
[ADR-0015](0015-testing-strategy-and-definition-of-done.md))
- [ ] The test harness and CI are built **before** feature code. This includes regression tests for two bugs of earlier simulators: a message
      delivered to two consumers, and delivery to a deleted consumer.
- [ ] Pre-push hook, CI on every push, and automatic deployment of `main` to GitHub Pages.
- [ ] CONTRIBUTING.md.

### M2 · Observe & share
- [ ] Debugger timeline: scrub, rewind, edit and replay.
- [ ] Queue-depth sparklines and per-consumer rates.
- [ ] Minimap, snap-to-grid, multi-select, copy/paste/duplicate, align/distribute.
- [ ] More lints:
  - an empty topic word (valid, but usually a typo);
  - deprecated transient non-exclusive queues;
  - dangling AE/DLX references.
- [ ] Toggle to show the built-in `amq.*` exchanges.
- [ ] Presentation mode.
- [ ] Routing-key rotation and `{{seq}}` tokens; saved message presets.
- [ ] `definitions.json` import with a vhost picker, validation, auto-layout and an import report. Regression test for
      a crash on import (`TypeError: binding is null`).
- [ ] `?src=<url>` loading, and QR codes for share links.
- [ ] PNG/SVG export.
- [ ] Offline support through a service worker.
- [ ] Detect two browser tabs editing the same canvas.
- [ ] Visual regression tests.

### M3 · Reliability
- [ ] Message properties: `content_type`, `delivery_mode`, `priority`, `expiration`, `message_id`, `correlation_id`,
      `reply_to`, `type`.
- [ ] Alternate exchanges, drawn as dashed edges that point at their target by name.
- [ ] The `mandatory` flag and `basic.return`.
- [ ] Publisher confirms: ack/nack badges and a counter of outstanding confirms.
- [ ] Consumer outcome policy (ack, nack with requeue, or reject, with a "% failures" setting) and manual mode.
- [ ] The redelivered flag, and explanations of message ordering.
- [ ] Dead-lettering (DLX, dead-letter routing key, `x-death`).
- [ ] TTL, per queue and per message.
- [ ] Max-length and max-length-bytes, with every overflow mode.
- [ ] Queue lifecycle:
  - exclusive and auto-delete queues;
  - `x-expires`;
  - consumers are told when their queue is deleted.
- [ ] Connections can be closed or made to crash.
- [ ] Restart the broker to show what durability keeps.
- [ ] Policies, which also round-trip through `definitions.json`.
- [ ] A note that queue arguments can't be changed after declaration (the broker returns 406).
- [ ] Templates:
  - alternate exchange;
  - DLX retry loop with TTL;
  - publisher confirms;
  - crash and redelivery.

### M4 · Queue types & patterns
- [ ] Queue types: classic, quorum and stream, with an inspector that shows only what each type supports.
- [ ] Priority queues, consumer priority (`x-priority`) and single active consumer.
- [ ] Quorum delivery limit (default 20), `x-delivery-count`, and poison messages.
- [ ] Streams: drawn as a log strip with offsets (first, last, next, an offset, a timestamp). Reads don't remove
      messages. Retention.
- [ ] Worker node: consume → transform → publish (users asked to link consumers to producers).
- [ ] RPC:
  - `reply_to` and `correlation_id`;
  - replies on an exclusive reply queue or direct reply-to;
  - each request is paired with its reply.
- [ ] Templates:
  - RPC;
  - priority queue;
  - single active consumer;
  - quorum poison message;
  - stream replay;
  - worker pipeline.

### M5 · Learn & build
- [ ] Guided lessons:
  - UI highlights;
  - goal cards that check themselves;
  - each step accepts either the gesture or the typed command.
- [ ] Challenges: puzzles with automatic checking and hints.
- [ ] Concept glossary with links to the official docs.
- [ ] Code generation:
  - C# (RabbitMQ.Client 7, async API) first;
  - then Python (pika), Node (amqplib), Java and Go (amqp091-go);
  - and `rabbitmqadmin` commands.
- [ ] Embed mode: an iframe snippet generator, read-only or interactive.

### Later
- A phone layout (view and play only).
- Several vhosts side by side on one canvas.
- Super streams.
- Exchange plugins (consistent-hash, delayed-message).
- Optional short share links through a .NET API ([ADR-0006](0006-client-only-app-dotnet-api-when-needed.md),
  [ADR-0013](0013-self-contained-share-links.md)).
- Internationalisation.

## Consequences

### Positive

- A usable MVP early. M1 alone is already better than earlier simulators in every area.
- Each milestone builds on the one before, so nothing is built twice.
- The checklists can be tracked directly as GitHub issues and milestones.

### Negative / trade-offs

- v1 is large. Without discipline, M3–M5 could slip; shipping each milestone from `main` makes progress visible.
- M1 is heavier than a minimal MVP because it carries the explicit linking, sharing and multiple-canvas requirements.

## Alternatives considered

- **Deliver everything at once.** Rejected: too risky, and nothing usable would exist for a long time.
- **A thin MVP, with the advanced semantics in v2.** Rejected by the product owner, who wants these behaviours in v1.

## Related

- [ADR-0002](0002-product-vision-and-scope.md): the vision and what users asked earlier simulators for.
- [ADR-0015](0015-testing-strategy-and-definition-of-done.md): the definition of done.

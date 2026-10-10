# ADR-0002: Product vision, scope and lessons from earlier simulators

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

Browser simulators that let people *see* RabbitMQ routing have existed for years, and the best known of them is showing
its age. The shortcomings below are the lessons we start from:

- **Canvas:** a fixed 800×410 canvas drawn with Processing.js. Elements are connected with **Alt/Shift+drag**, which is
  explained in a single line of small text.
- **Routing:** only **direct, fanout and topic** exchanges. There is **no headers exchange**; users asked for one and
  the request was closed as "not planned".
- **Editing:** small forms for names, the binding key and the message (payload, routing key, "every N seconds").
- **Broker interop:** import/export runs through a Node server with the hard-coded login `guest:guest`, and only works
  when that server is configured.
- **Missing:** undo, zoom, autosave, sharing, routing explanations, dark mode and mobile support. A "Player" mode for
  tutorials was never finished.
- **Maintenance:** the project is effectively unmaintained, and contributions stalled on a contributor licence
  agreement (CLA).

We went through all 17 issues and 8 pull requests that users of such a simulator had filed. They are the best evidence
we have of what users need.

## Decision

We will build **RabbitMQ Playground**: a browser-based, visual and faithful RabbitMQ playground for **learning**,
**teaching and presenting**, and **designing topologies**.

### Product principles

1. **Teach by showing.** Every routing decision can be explained: "why did or didn't this message reach Q?"
2. **Nothing hidden.** Every gesture has a visible hint, a keyboard shortcut and a typed command, and the UI tells you
   the command for each action you take ([ADR-0011](0011-explicit-linking-and-command-layer.md)).
3. **Zero friction.** No install, no account, no server configuration, and it works offline. Canvases live in the
   browser and can be shared as links ([ADR-0006](0006-client-only-app-dotnet-api-when-needed.md),
   [ADR-0012](0012-multiple-canvases-and-local-persistence.md), [ADR-0013](0013-self-contained-share-links.md)).
4. **Faithful to RabbitMQ.** Behaviour follows a pinned broker version and is checked against a real broker
   ([ADR-0008](0008-rabbitmq-fidelity-baseline.md)).
5. **Tested all the way.** Engine, UI, persistence and user journeys are covered by automated tests
   ([ADR-0015](0015-testing-strategy-and-definition-of-done.md)).

### Parity: everything earlier simulators do, done better

| Earlier simulators | RabbitMQ Playground |
|---|---|
| Fixed 800×410 canvas | Canvas that fills the window, with zoom/pan, auto-layout, minimap and presentation mode |
| Alt/Shift+drag to connect | Five explicit ways to link, including a typed command bar ([ADR-0011](0011-explicit-linking-and-command-layer.md)) |
| Direct, fanout and topic exchanges | The same, plus the **headers exchange** ([ADR-0009](0009-headers-exchange-support.md)) |
| Exchange-to-exchange bindings, round-robin delivery | The same, following the rules of the pinned RabbitMQ version, plus prefetch, acks, DLX, TTL, alternate exchanges, confirms, quorum queues, streams and RPC ([ADR-0003](0003-roadmap-and-milestones.md)) |
| Message form (payload, key, interval) | Message composer with headers, properties, bursts, rotating keys and presets |
| Plain-text log | Filterable event log, message inspector, route overlay ("Why?"), what-if tester, timeline |
| "Advanced mode" that shows the default exchange | A default-exchange toggle with its implicit bindings explained |
| Broker import/export through a Node server with `guest:guest` | `definitions.json` import/export in the browser, with no credentials ([ADR-0014](0014-broker-interop-via-definitions-json.md)) |
| Unfinished "Player" | Share links, embed mode, guided lessons and challenges |

### What users asked earlier simulators for

Every request and bug report in the trackers of earlier simulators is covered below, apart from one that was spam.

| Ask or bug | How we cover it | Milestone |
|---|---|---|
| Headers exchange and bindings (the request was closed "not planned") | Headline feature, [ADR-0009](0009-headers-exchange-support.md) | M1 |
| "I can't create a link": Alt+drag moved the element instead, so Shift was added as a fallback | Five explicit ways to link, with an always-visible hint bar ([ADR-0011](0011-explicit-linking-and-command-layer.md)) | M1 |
| Can't delete links or elements without starting over | Delete from the keyboard, context menu, inspector or command bar; everything is undoable | M1 |
| Rename producers/consumers | Inline rename on every node, plus the `rename` command | M1 |
| Zoom/pan, and a tidy layout for many exchanges | Zoom/pan and auto-layout (M1); minimap (M2) | M1 / M2 |
| Full-screen / resizable canvas | Canvas fills the window; full-screen presentation mode | M1 / M2 |
| Labels overlap and are hard to read | Labels placed to avoid overlap, draggable, and summarised as chips | M1 |
| A consumer can't subscribe to more than one queue | Consumers can subscribe to several queues | M1 |
| Bug: with two consumers, the first message went to **both** | Deterministic engine ([ADR-0007](0007-deterministic-simulation-engine.md)) plus a regression test that checks a message reaches one consumer only | M1 |
| Bug: messages kept going to a deleted consumer | Removing a consumer closes its channel: unacked messages are requeued as *redelivered* and new ones wait in the queue. Regression test | M1 |
| Save/load to a JSON file without RabbitMQ installed | Multiple canvases autosaved in the browser, plus JSON file save/load ([ADR-0012](0012-multiple-canvases-and-local-persistence.md)) | M1 |
| Import/Export buttons hidden behind server config; deployment, port, path and credential setup | Static app with no server configuration and no credentials; every feature always visible ([ADR-0006](0006-client-only-app-dotnet-api-when-needed.md)) | M1 |
| Crash on import (`TypeError: binding is null`) | Imports are schema-validated and come with an import report instead of crashing. Regression test | M2 |
| vhost support; import/export a single vhost | Vhost-aware `definitions.json` ([ADR-0014](0014-broker-interop-via-definitions-json.md)) | M1 / M2 |
| Load a config from a URL in play-only mode (popular, never merged) | Share links (M1), `?src=<url>` (M2), embed mode (M5) ([ADR-0013](0013-self-contained-share-links.md)) | M1–M5 |
| Link consumers to producers (a worker consumes Q1 and publishes to Q2) | **Worker** node (consume → transform → publish), also used for RPC | M4 |
| Project looked abandoned; contributions blocked by a CLA | Public ADRs and roadmap, CI on every push, CONTRIBUTING.md, no CLA ([ADR-0004](0004-trunk-based-development-on-main.md)) | M1 |

### Scope

The scope is organised into feature areas, each with its own ADR where a decision is involved. The milestone checklist
is in [ADR-0003](0003-roadmap-and-milestones.md):

- Canvas, editing, explanation and accessibility ([ADR-0010](0010-explanation-first-editor-ux.md))
- Linking and the command bar ([ADR-0011](0011-explicit-linking-and-command-layer.md))
- Topology elements and RabbitMQ semantics ([ADR-0008](0008-rabbitmq-fidelity-baseline.md),
  [ADR-0009](0009-headers-exchange-support.md))
- Canvases, persistence and sharing ([ADR-0012](0012-multiple-canvases-and-local-persistence.md),
  [ADR-0013](0013-self-contained-share-links.md))
- Broker interop ([ADR-0014](0014-broker-interop-via-definitions-json.md))
- Learning content and developer extras: templates, guided lessons, challenges, glossary, code generation and embed mode
  ([ADR-0003](0003-roadmap-and-milestones.md))

### Non-goals

- Connecting to, or verifying against, a live broker from the app
  ([ADR-0014](0014-broker-interop-via-definitions-json.md)).
- Multi-user collaboration, accounts or cloud storage in v1.
- Modelling throughput or latency, i.e. performance benchmarking of real brokers.
- Clustering, federation, shovel, and protocols other than AMQP 0-9-1.
- Managing users and permissions.

## Consequences

### Positive

- A clear product identity: a faithful, explainable playground, not a toy.
- Every known pain point of earlier simulators is mapped to a feature and a milestone.
- The headers exchange becomes a first-class feature.

### Negative / trade-offs

- Being faithful takes real effort: semantics have to be tracked against a broker version, and conformance tests have
  to be maintained.
- The scope is broad ([ADR-0003](0003-roadmap-and-milestones.md)), so we need a disciplined milestone order.

## Alternatives considered

- **Fork and modernise an existing simulator.** Rejected. Their Processing.js codebase, their dependency on a Node server and their
  licensing and CLA history make a rewrite cheaper than a refactor.
- **Contribute upstream.** Rejected. The projects are inactive, and earlier contributions stalled.
- **A pure "textbook" simulator that doesn't follow a broker version.** Rejected. It would teach behaviour that real
  brokers don't have ([ADR-0008](0008-rabbitmq-fidelity-baseline.md)).

## Related

- [ADR-0003](0003-roadmap-and-milestones.md): roadmap and milestone checklist.

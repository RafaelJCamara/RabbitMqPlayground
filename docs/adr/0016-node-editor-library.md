# ADR-0016: Node editor library

- **Status:** Proposed
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

We need an Angular-native node-graph editor ([ADR-0005](0005-frontend-angular.md)). It must support:

- custom nodes for producers, exchanges, queues, consumers and workers;
- handle-based linking with validation ([ADR-0011](0011-explicit-linking-and-command-layer.md));
- edges that carry several key chips;
- a message-animation overlay that stays in sync with the viewport
  ([ADR-0007](0007-deterministic-simulation-engine.md)).

As of October 2026, two maintained, MIT-licensed candidates stand out:

| | [Foblex Flow](https://github.com/Foblex/f-flow) | [ngx-vflow](https://github.com/artem-mangilev/ngx-vflow) |
|---|---|---|
| Angular support | 17.3+ (current 19.x line) | 19.2+ (v2.x) |
| Signals / zoneless | Signals-compatible, ready for zoneless | Signals-based |
| Connections | Drag to connect, connection rules, waypoints | Handles, edge creation with validation, reconnection |
| Navigation | Pan, zoom, minimap, fit to screen | Pan, zoom, minimap |
| Layout | Dagre and ELK auto-layout support | Works with external layout libraries |
| Scale | Virtualisation, render caching | Virtualisation |

## Decision (proposed)

Settle the choice with a **time-boxed spike of 1–2 days**. Build the same prototype with both libraries:

- the five node types;
- handle linking with our connection rules;
- an edge with several chips;
- keyboard linking;
- auto-layout;
- an animation overlay that follows pan and zoom at 60 fps with 500 dots.

**Must-haves:**

- custom node and edge templates, done as Angular components;
- connection validation hooks;
- a viewport transform API (or events) for syncing the overlay;
- touch support;
- works in zoneless mode;
- MIT or similar licence;
- actively maintained.

**Weighted criteria:**

- the developer experience of the prototype;
- performance at 200 nodes / 500 edges;
- keyboard and accessibility hooks;
- support for edge labels and markers;
- minimap and layout integration;
- bundle size;
- documentation;
- release cadence.

**Fallback:** if neither library meets the must-haves, build a custom SVG editor on Angular CDK.

When the spike is done, this ADR is updated with the choice and its status changes to **Accepted**.

## Consequences

### Positive

- The choice is made on measured fit, not on marketing.

### Negative / trade-offs

- Up to two days of throwaway prototype code.
- Until the spike is done, editor-specific work in M1 waits.

## Alternatives considered

- **Choose now without a spike.** Rejected: switching editor libraries later is expensive.
- **Build a custom editor from the start.** Kept only as the fallback: it means more code to write and test.

## Related

- [ADR-0005](0005-frontend-angular.md), [ADR-0011](0011-explicit-linking-and-command-layer.md),
  [ADR-0007](0007-deterministic-simulation-engine.md)

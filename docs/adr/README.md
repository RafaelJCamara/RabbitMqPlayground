# Architecture Decision Records

This folder holds the decisions behind **RabbitMQ Playground**, a browser-based visual RabbitMQ simulator inspired by
[tryrabbitmq.com](https://tryrabbitmq.com). It aims to have a much better UI/UX than the original, support for the
headers exchange, and behaviour that matches a real broker.

Each record explains the context, the decision and its consequences, so that later work builds on decisions instead of
re-arguing them. The format is described in [ADR-0001](0001-record-architecture-decisions.md).

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-product-vision-and-scope.md) | Product vision, scope and lessons from the original simulator | Accepted |
| [0003](0003-roadmap-and-milestones.md) | Roadmap: MVP and v1 milestones | Accepted |
| [0004](0004-trunk-based-development-on-main.md) | Trunk-based development directly on `main` | Accepted |
| [0005](0005-frontend-angular.md) | Frontend framework: Angular | Accepted |
| [0006](0006-client-only-app-dotnet-api-when-needed.md) | Client-only app; a .NET API only when needed | Accepted |
| [0007](0007-deterministic-simulation-engine.md) | Deterministic discrete-event simulation engine | Accepted |
| [0008](0008-rabbitmq-fidelity-baseline.md) | RabbitMQ fidelity baseline (4.3.x) | Accepted |
| [0009](0009-headers-exchange-support.md) | Headers exchange support | Accepted |
| [0010](0010-explanation-first-editor-ux.md) | Explanation-first editor UX | Accepted |
| [0011](0011-explicit-linking-and-command-layer.md) | Explicit linking and a single command layer | Accepted |
| [0012](0012-multiple-canvases-and-local-persistence.md) | Multiple canvases and local persistence | Accepted |
| [0013](0013-self-contained-share-links.md) | Self-contained share links | Accepted |
| [0014](0014-broker-interop-via-definitions-json.md) | Broker interoperability via `definitions.json` only | Accepted |
| [0015](0015-testing-strategy-and-definition-of-done.md) | Testing strategy and definition of done | Accepted |
| [0016](0016-node-editor-library.md) | Node editor library: Foblex Flow | Accepted |

## Where to start

- **What we're building and in what order:** [0002](0002-product-vision-and-scope.md), then
  [0003](0003-roadmap-and-milestones.md).
- **How it's built:** [0005](0005-frontend-angular.md), [0006](0006-client-only-app-dotnet-api-when-needed.md),
  [0007](0007-deterministic-simulation-engine.md), [0011](0011-explicit-linking-and-command-layer.md).
- **What "correct" means:** [0008](0008-rabbitmq-fidelity-baseline.md), [0009](0009-headers-exchange-support.md),
  [0015](0015-testing-strategy-and-definition-of-done.md).

## Adding or changing a decision

1. Copy [`template.md`](template.md) to `NNNN-short-title.md`, using the next free number.
2. Set its status to **Proposed**. Once agreed, change it to **Accepted** (or **Rejected**).
3. Accepted ADRs are not rewritten. To change a decision, write a new ADR. The only edit allowed on the old one is
   setting its status to **Superseded by ADR-NNNN**.
4. Add the ADR to the index above in the same commit.

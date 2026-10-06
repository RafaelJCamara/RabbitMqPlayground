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
| [0008](0008-rabbitmq-fidelity-baseline.md) | RabbitMQ fidelity baseline (4.3.x) | Accepted (rule 28 superseded by 0021, rule 4 extended by 0022) |
| [0009](0009-headers-exchange-support.md) | Headers exchange support | Accepted (integers extended by 0023) |
| [0010](0010-explanation-first-editor-ux.md) | Explanation-first editor UX | Accepted |
| [0011](0011-explicit-linking-and-command-layer.md) | Explicit linking and a single command layer | Accepted (keyboard parts superseded by 0017, patches clause by 0019, vocabulary extended by 0025, command layer by 0026) |
| [0012](0012-multiple-canvases-and-local-persistence.md) | Multiple canvases and local persistence | Accepted (record, files and loader settled by 0027, repository and autosave by 0028) |
| [0013](0013-self-contained-share-links.md) | Self-contained share links | Accepted (the validator is the loader of 0027) |
| [0014](0014-broker-interop-via-definitions-json.md) | Broker interoperability via `definitions.json` only | Accepted |
| [0015](0015-testing-strategy-and-definition-of-done.md) | Testing strategy and definition of done | Accepted |
| [0016](0016-node-editor-library.md) | Node editor library: Foblex Flow | Accepted |
| [0017](0017-canvas-keyboard-model.md) | Canvas keyboard model: Foblex Flow's keyboard layer | Accepted |
| [0018](0018-workspace-layout-and-dependency-rules.md) | Workspace layout and dependency rules | Accepted |
| [0019](0019-undo-through-immutable-document-snapshots.md) | Undo through immutable document snapshots | Accepted (choices extended by 0026) |
| [0020](0020-mit-licence.md) | MIT licence | Accepted |
| [0021](0021-transient-queues-are-refused.md) | RabbitMQ 4.3 refuses transient queues, and the refusals the simulator reproduces | Accepted (the `durable` flag settled by 0024) |
| [0022](0022-topic-binding-keys-have-at-most-two-hash-wildcards.md) | A topic binding key may have at most two `#` wildcards | Accepted |
| [0023](0023-header-integers-are-limited-to-safe-integers.md) | Header integers are limited to the safe-integer range | Accepted |
| [0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md) | A queue that is not durable is refused, with the root cause first and the broker's reply after it | Accepted |
| [0025](0025-the-command-grammar.md) | The grammar of the typed command | Accepted |
| [0026](0026-commands-name-elements-and-ids-stay-in-the-document.md) | Commands name elements, ids stay in the document, and a refusal says whose rule it is | Accepted |
| [0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md) | A canvas is a record, a file and a bundle, and one function loads all of them | Accepted |
| [0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md) | The canvas repository, autosave, and what the browser may do to the storage | Accepted |

## Where to start

- **What we're building and in what order:** [0002](0002-product-vision-and-scope.md), then
  [0003](0003-roadmap-and-milestones.md).
- **How it's built:** [0005](0005-frontend-angular.md), [0006](0006-client-only-app-dotnet-api-when-needed.md),
  [0007](0007-deterministic-simulation-engine.md), [0011](0011-explicit-linking-and-command-layer.md),
  [0018](0018-workspace-layout-and-dependency-rules.md), [0019](0019-undo-through-immutable-document-snapshots.md),
  [0025](0025-the-command-grammar.md), [0026](0026-commands-name-elements-and-ids-stay-in-the-document.md),
  [0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md),
  [0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md).
- **What "correct" means:** [0008](0008-rabbitmq-fidelity-baseline.md), [0009](0009-headers-exchange-support.md),
  [0021](0021-transient-queues-are-refused.md), [0022](0022-topic-binding-keys-have-at-most-two-hash-wildcards.md),
  [0023](0023-header-integers-are-limited-to-safe-integers.md),
  [0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md),
  [0015](0015-testing-strategy-and-definition-of-done.md).

## Adding or changing a decision

1. Copy [`template.md`](template.md) to `NNNN-short-title.md`, using the next free number.
2. Set its status to **Proposed**. Once agreed, change it to **Accepted** (or **Rejected**).
3. Accepted ADRs are not rewritten. To change a decision, write a new ADR. The only edit allowed on the old one is
   setting its status to **Superseded by ADR-NNNN**.
4. Add the ADR to the index above in the same commit.

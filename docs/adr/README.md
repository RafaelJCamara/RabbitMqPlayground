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
| [0010](0010-explanation-first-editor-ux.md) | Explanation-first editor UX | Accepted (visual language settled by 0032) |
| [0011](0011-explicit-linking-and-command-layer.md) | Explicit linking and a single command layer | Accepted (keyboard parts superseded by 0017, patches clause by 0019, vocabulary extended by 0025, command layer by 0026, state and bus by 0031, hint bar by 0035) |
| [0012](0012-multiple-canvases-and-local-persistence.md) | Multiple canvases and local persistence | Accepted (record, files and loader settled by 0027, repository and autosave by 0028) |
| [0013](0013-self-contained-share-links.md) | Self-contained share links | Accepted (the validator is the loader of 0027) |
| [0014](0014-broker-interop-via-definitions-json.md) | Broker interoperability via `definitions.json` only | Accepted |
| [0015](0015-testing-strategy-and-definition-of-done.md) | Testing strategy and definition of done | Accepted (the editor's tests settled by 0036, the contract suite by 0034) |
| [0016](0016-node-editor-library.md) | Node editor library: Foblex Flow | Accepted (adapter built as 0033 says, guarded by 0034) |
| [0017](0017-canvas-keyboard-model.md) | Canvas keyboard model: Foblex Flow's keyboard layer | Accepted (keyboard service settled by 0035) |
| [0018](0018-workspace-layout-and-dependency-rules.md) | Workspace layout and dependency rules | Accepted (the editor's folders settled by 0030, what is tested where by 0036) |
| [0019](0019-undo-through-immutable-document-snapshots.md) | Undo through immutable document snapshots | Accepted (choices extended by 0026, the store by 0031) |
| [0020](0020-mit-licence.md) | MIT licence | Accepted |
| [0021](0021-transient-queues-are-refused.md) | RabbitMQ 4.3 refuses transient queues, and the refusals the simulator reproduces | Accepted (the `durable` flag settled by 0024) |
| [0022](0022-topic-binding-keys-have-at-most-two-hash-wildcards.md) | A topic binding key may have at most two `#` wildcards | Accepted |
| [0023](0023-header-integers-are-limited-to-safe-integers.md) | Header integers are limited to the safe-integer range | Accepted |
| [0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md) | A queue that is not durable is refused, with the root cause first and the broker's reply after it | Accepted |
| [0025](0025-the-command-grammar.md) | The grammar of the typed command | Accepted |
| [0026](0026-commands-name-elements-and-ids-stay-in-the-document.md) | Commands name elements, ids stay in the document, and a refusal says whose rule it is | Accepted (a document that a command made always loads, made true by 0029, the bus by 0031) |
| [0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md) | A canvas is a record, a file and a bundle, and one function loads all of them | Accepted (the caps of a canvas are the domain's, by 0029) |
| [0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md) | The canvas repository, autosave, and what the browser may do to the storage | Accepted (wired into the app by 0031) |
| [0029](0029-the-commands-refuse-at-the-size-caps.md) | The commands refuse at the size caps, so that a canvas that commands made always loads | Accepted |
| [0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md) | The editor's folders, and how it is loaded behind its flag | Accepted (the adapter settled by 0033) |
| [0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md) | The editor's state: signal stores, one command bus, and where ids come from | Accepted (the zoom is held by `FlowViewport`, 0033) |
| [0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md) | The editor's visual language: tokens, themes, a colour and a shape for each kind of node, and forms that explain | Accepted |
| [0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md) | The Foblex adapter: one component, intents out, and the four workarounds | Accepted (the fit is the app's, by 0038, and a menu on the canvas itself is the key's, by 0040) |
| [0034](0034-the-foblex-contract-suite-and-how-an-upgrade-fails-loudly.md) | The Foblex contract suite, and how an upgrade fails loudly | Accepted |
| [0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md) | The keyboard service: scope, modifiers and text fields | Accepted (its listener moved to the document by 0037, the menu held open by 0039, and a menu on the canvas itself made the key's by 0040) |
| [0036](0036-the-test-strategy-of-the-editor.md) | The test strategy of the editor | Accepted (the quota test changed by 0037, and the pointer tests by 0039) |
| [0037](0037-the-editors-keys-are-heard-on-the-document-and-the-browsers-refusal-is-made-at-its-api.md) | The editor's keys are heard on the document, and the browser's refusal is made at its API | Accepted |
| [0038](0038-the-app-fits-the-canvas-and-does-not-ask-the-library-to.md) | The app fits the canvas, and does not ask the library to | Accepted |
| [0039](0039-the-context-menu-stays-open-through-the-end-of-the-click-that-opened-it.md) | The context menu stays open through the end of the click that opened it | Accepted |
| [0040](0040-a-menu-on-the-canvas-itself-is-for-a-key-and-the-last-thing-done-says-whether-it-was-one.md) | A menu on the canvas itself is for a key, and the last thing done says whether it was one | Accepted |

## Where to start

- **What we're building and in what order:** [0002](0002-product-vision-and-scope.md), then
  [0003](0003-roadmap-and-milestones.md).
- **How it's built:** [0005](0005-frontend-angular.md), [0006](0006-client-only-app-dotnet-api-when-needed.md),
  [0007](0007-deterministic-simulation-engine.md), [0011](0011-explicit-linking-and-command-layer.md),
  [0018](0018-workspace-layout-and-dependency-rules.md), [0019](0019-undo-through-immutable-document-snapshots.md),
  [0025](0025-the-command-grammar.md), [0026](0026-commands-name-elements-and-ids-stay-in-the-document.md),
  [0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md),
  [0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md),
  [0029](0029-the-commands-refuse-at-the-size-caps.md), [0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md),
  [0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md),
  [0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md),
  [0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md),
  [0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md), [0037](0037-the-editors-keys-are-heard-on-the-document-and-the-browsers-refusal-is-made-at-its-api.md),
  [0038](0038-the-app-fits-the-canvas-and-does-not-ask-the-library-to.md),
  [0039](0039-the-context-menu-stays-open-through-the-end-of-the-click-that-opened-it.md),
  [0040](0040-a-menu-on-the-canvas-itself-is-for-a-key-and-the-last-thing-done-says-whether-it-was-one.md).
- **What "correct" means:** [0008](0008-rabbitmq-fidelity-baseline.md), [0009](0009-headers-exchange-support.md),
  [0021](0021-transient-queues-are-refused.md), [0022](0022-topic-binding-keys-have-at-most-two-hash-wildcards.md),
  [0023](0023-header-integers-are-limited-to-safe-integers.md),
  [0024](0024-a-queue-that-is-not-durable-is-refused-with-the-brokers-reply.md),
  [0015](0015-testing-strategy-and-definition-of-done.md), [0034](0034-the-foblex-contract-suite-and-how-an-upgrade-fails-loudly.md),
  [0036](0036-the-test-strategy-of-the-editor.md).

## Adding or changing a decision

1. Copy [`template.md`](template.md) to `NNNN-short-title.md`, using the next free number.
2. Set its status to **Proposed**. Once agreed, change it to **Accepted** (or **Rejected**).
3. Accepted ADRs are not rewritten. To change a decision, write a new ADR. The only edit allowed on the old one is
   setting its status to **Superseded by ADR-NNNN**.
4. Add the ADR to the index above in the same commit.

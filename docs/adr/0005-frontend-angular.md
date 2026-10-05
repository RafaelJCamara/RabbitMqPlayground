# ADR-0005: Frontend framework — Angular

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

The app is a rich, single-page tool. It needs:

- a node-graph editor;
- animations synced to the editor's viewport;
- panels, inspectors and forms;
- a lot of keyboard handling and accessibility work;
- a long-lived codebase with clear structure.

The product owner chose **Angular** for the frontend, and .NET for any backend
([ADR-0006](0006-client-only-app-dotnet-api-when-needed.md)).

## Decision

- **Framework.**
  - Use **Angular**, at the latest stable major when the project is scaffolded, created with the Angular CLI.
  - Use **standalone components**, **signals** for reactive state, and **zoneless** change detection.
  - TypeScript runs in `strict` mode.
- **Styling.**
  - **Tailwind CSS**, with design tokens (CSS custom properties) for the light and dark themes.
  - **Angular CDK** for overlays, focus management, accessibility helpers and drag-and-drop.
  - No heavy component library, so the visual design stays our own.
- **Workspace layout.**
  - The simulation engine is a separate library in the workspace with **no Angular or DOM imports**
    ([ADR-0007](0007-deterministic-simulation-engine.md)).
  - The app consumes the engine through its command/event API ([ADR-0011](0011-explicit-linking-and-command-layer.md)).
- **Node editor.** We'll use an Angular-native library, chosen through a spike in
  [ADR-0016](0016-node-editor-library.md).
- **Animation.**
  - Message animation runs **outside Angular change detection**, in a `requestAnimationFrame` overlay that stays in
    sync with the editor's viewport.
  - Messages are never diagram nodes.
- **Testing tools.**
  - **Vitest** with Angular Testing Library for unit and component tests.
  - **Playwright** for end-to-end tests ([ADR-0015](0015-testing-strategy-and-definition-of-done.md)).
- **Upgrades.** We keep up with Angular's six-month major release cycle using `ng update`.

## Consequences

### Positive

- It's the product owner's preferred framework.
- It brings strong conventions, dependency injection, typed forms and the CDK's accessibility primitives.
- Signals and zoneless change detection fit a UI that updates many times a second.

### Negative / trade-offs

- There are fewer mature node-editor libraries than in the React ecosystem, where React Flow is the reference.
  [ADR-0016](0016-node-editor-library.md) reduces that risk, and the fallback is a custom SVG editor.
- Angular's frequent major releases mean regular upgrade work.
- `.gitignore` currently holds only .NET entries. Node and Angular entries are added when we scaffold.

## Alternatives considered

- **React + TypeScript + React Flow.** It has the strongest node-editor ecosystem. Rejected because of the product
  owner's preference for Angular.
- **Blazor WebAssembly (C#).** Rejected: it has weaker diagram libraries, needs JavaScript interop on every animation
  frame, and has a larger first download.

## Related

- [ADR-0007](0007-deterministic-simulation-engine.md): the engine, which is independent of the framework.
- [ADR-0016](0016-node-editor-library.md): choosing the node editor library.

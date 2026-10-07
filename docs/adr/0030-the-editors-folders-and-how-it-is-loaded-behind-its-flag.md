# ADR-0030: The editor's folders, and how it is loaded behind its flag

- **Status:** Accepted. What the adapter in `canvas/flow/` is and does is settled by [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md). The folders of the simulation, and where they sit in the order, are settled by [ADR-0057](0057-what-building-s6-settled-folders-that-run-one-way-a-strip-that-is-a-region-frames-that-cannot-jump-and-colours-read-through-a-probe.md).
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** section 1 of the [M1 plan](../plans/m1.md) (the layout of `projects/app`) and [ADR-0018](0018-workspace-layout-and-dependency-rules.md)
  (who may import what), for the code that S4 ([#6](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/6)) adds.

## Context

The plan names the folders of the app (`core/`, `canvas/flow/`, `canvas/overlay/`, `editor/`, and one for each later slice) and
says that the editor loads lazily (section 6). It does not say what goes where, which way the dependencies run, how the root
component chooses between the placeholder and the editor, or what the production bundle must not contain. S4 adds the first real
screen, and every later slice builds on the shape that it gives the app, so it is decided here and checked by tools.

## Decision

### Folders, and the direction of dependencies

All of it is under `web/projects/app/src/app/`.

| Folder | What is in it | May import |
|---|---|---|
| `core/` | What the whole app shares and that has no screen of its own: the app's name, the flags, the debug handle, the announcer, the theme, the command bus and the stores, the canvas session (the repository and autosave) | `@rmq/*` libraries, Angular |
| `canvas/model/` | The pure part of the canvas: the view model that is drawn from a document, the intents that the canvas reports, the ids of connectors and edges, the lists of valid link targets, the maths of the live transform, the catalogue of messages that a screen reader speaks | `core/`, the libraries |
| `canvas/flow/` | The Foblex adapter and nothing else: the one component that draws the canvas and the one service that the rest of the app steers it with | `canvas/model/`, `core/`, Foblex |
| `editor/` | The shell and its parts: the top bar, the toolbox, the inspector, the hint bar, the status line, the context menu, the keyboard service, and the code that turns an intent into a command | everything above |

- **Everything that can be pure lives outside `canvas/flow/`**, because that folder is the one that is left out of the coverage
  of the app ([ADR-0018](0018-workspace-layout-and-dependency-rules.md)) and is covered by the end-to-end journeys and the contract
  suite instead. The adapter holds only what talks to Foblex, so that what is left out is small.
- **The direction is `core` ← `canvas/model` ← `canvas/flow` ← `editor`.** `core/` imports nothing from `canvas/` or `editor/`, and
  `canvas/` imports nothing from `editor/`. ESLint enforces it, and a spec lints sample code at each path, as for ADR-0018's table.
- **Later slices add folders beside these**: `canvas/overlay/` (S6), `command-bar/` (S5), `simulation/`, `explain/`, `canvases/`,
  `share/` and `onboarding/`, each behind its flag, each importing `core/`.
- **`main.ts` and `app.config.ts` stay thin.** They are left out of coverage, so they hold wiring and no logic. The providers that
  only the editor needs are on the editor component, so that they are made when it starts and are not in the first bundle.

### Loading

- **The root component chooses.** `App` reads the `editor` flag once, as every flag is read, and shows the placeholder (what S0
  built) or the editor. The editor is inside a `@defer (on immediate)` block, so the compiler splits it into its own chunk, with
  Foblex, dagre, zod, `idb` and the libraries that only it uses. A visitor without the flag downloads none of it.
- **While the chunk loads, and if it fails**, the page says so in words, in a region that is announced. A failure to load is an
  error that a learner can act on (reload), and not a blank page.
- **The editor is the page.** It has the one `h1`, the name of the product, in its top bar, as the placeholder has.
- **The theme is applied by the root**, because it is a property of the page and not of the editor: the choice is read when the app
  starts, so that the page is never shown in the wrong theme for a moment once a learner has chosen one.

### What the production bundle must not contain

- **The debug handle**, as before: `__rmq` and `RMQ_E2E` are not in any file of the deployed build, and nor is `drawnEdges`, a name that
  only the handle uses, which CI checks as well. The editor reaches the handle only through code behind `RMQ_E2E`, which the build
  replaces with `false`, so that the code and the strings are gone.
- **Nothing from `@rmq/testing`**, which ESLint keeps out of every file that is not a spec.
- **No Foblex code in the first chunk.** The budgets on the initial bundle stay errors (500 kB warning, 1 MB error), and an
  end-to-end test proves that a page without the flag requests no chunk and that a page with the flag does.

### The catalogue of what is deferred

- A Content Security Policy (S10) has to allow `worker-src blob:`, because Foblex computes the geometry of connections in a Web
  Worker that it makes from a Blob URL. This is written here so that S10 meets it before it ships a policy.

## Consequences

### Positive

- The part of the app that is covered by unit tests is large and the part that is not is small and named, and ESLint keeps it so.
- A visitor who does not have the flag costs nothing, and the owner can look at the editor on the deployed site with `?ff=editor`.
- Later slices have places to go, and cannot reach the wrong way.

### Negative / trade-offs

- A chunk that loads on demand shows a loading state for a moment on a slow connection, and a failed download is a state that has
  to be written and tested.
- The folders `canvas/model/` and `canvas/flow/` split one idea in two, and a change to what the canvas reports touches both. The
  alternative is the adapter holding logic that no unit test reaches.
- A rule that stops `core/` importing the editor is one more rule to keep in the configuration and in its spec.

## Alternatives considered

- **A router with a lazy route for the editor.** Rejected for now: there is one screen and no URL for it. S9 (canvases) and S10
  (share links) decide about routes, and `@defer` can be replaced by a lazy route without changing what is in the chunk.
- **Load the editor with a dynamic `import()` and `ngComponentOutlet`.** Rejected: `@defer` does the same with the compiler's
  help and has blocks for loading and for failure.
- **Put the pure parts of the canvas in `canvas/flow/` and test them through the end-to-end journeys.** Rejected: that folder is
  outside the gate, and the logic that is hardest to get right (which drop is invalid, what is a valid target) would have no
  unit test.

## Related

- [ADR-0005](0005-frontend-angular.md), [ADR-0016](0016-node-editor-library.md), [ADR-0018](0018-workspace-layout-and-dependency-rules.md).
- [ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md): the state that `core/` holds.
- [M1 plan](../plans/m1.md), sections 1, 2.4 and 6.

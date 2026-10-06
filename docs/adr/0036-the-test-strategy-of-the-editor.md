# ADR-0036: The test strategy of the editor

- **Status:** Accepted. How the quota test makes the browser refuse is settled by [ADR-0037](0037-the-editors-keys-are-heard-on-the-document-and-the-browsers-refusal-is-made-at-its-api.md),
  and that a test of the pointer sends its events in the order of every system by [ADR-0039](0039-the-context-menu-stays-open-through-the-end-of-the-click-that-opened-it.md).
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0015](0015-testing-strategy-and-definition-of-done.md) (the tiers and the definition of done) and
  [ADR-0018](0018-workspace-layout-and-dependency-rules.md) (what the coverage of the app leaves out), for the first screen that has
  a canvas, which S4 ([#6](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/6)) builds.

## Context

ADR-0015 chose the tiers and ADR-0018 left the Foblex adapter out of the coverage of the app and said that the end-to-end journeys
cover it. The editor is the first thing that needs the two to meet: a canvas that a unit test cannot draw (jsdom has no layout, no
`ResizeObserver` and no worker), a handle for the browser tests, an accessibility check in two themes, a number for how fast a big canvas
is drawn, and a browser database that has to be filled before the app starts. Every later slice writes its tests on what this
decides.

## Decision

### What is tested where

| Tier | What it covers in the editor | What it does not |
|---|---|---|
| **Unit and component** (`ng test`, jsdom, Testing Library) | The stores, the bus, the session, the intent handler, the conversion of the library's events, hit tests, drops, the shortcuts and their scope, the toolbox, the inspector, the hint bar, the menus, the editor as a whole | Anything that needs the library to draw |
| **Contract** ([ADR-0034](0034-the-foblex-contract-suite-and-how-an-upgrade-fails-loudly.md)) | The behaviours of the library that the adapter depends on | What the editor does with them |
| **End-to-end** (Playwright, Chromium, the production-optimised build under the Pages base path) | The journeys: add, rename, move by drag and by `M`, delete three ways, undo and redo, layout, zoom, fit, themes, reload; the durable toggle; the quota | Rules that a unit test reaches |
| **Accessibility** (axe in the end-to-end tier) | Every screen of the editor, in both themes | The manual pass with a screen reader (S12) |
| **Performance** (end-to-end) | That 200 nodes and 500 edges are drawn within a budget | Frame rates on real hardware (S12) |

- **The canvas is faked in component tests, and nothing else is.** The editor's spec replaces the adapter with a component that takes
  the same inputs and reports the same intents, so that jsdom never has to draw. Everything else is the real thing: the stores, the bus,
  the repository (the in-memory one), the history. The fakes are at the edges only: the clock, the timer of the autosave and the
  storage manager.
- **A test of a screen is a test of what a learner sees**: a role and a name, a visible text, a key. Nothing reaches into a
  component's fields.
- **What the app's coverage leaves out is still `canvas/flow/**`** and the entry files. The threshold is 85% on all four metrics and
  is not lowered.

### The debug handle

- **`window.__rmq` exists only in the end-to-end build** and is not in the production bundle ([ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md)).
  CI checks the deployed bundle for the names that only it uses.
- **It reads and never writes.** A test cannot put the app into a state that a learner could not, so a test that passes shows that a
  learner can do it. It offers: the flags that are on, the document, the selection, the keys of the edges that are drawn, the intents
  that the canvas reported (the last 200), and the live viewport of the canvas. Each is empty or `null` until the editor has started.
- **A slice that needs more adds a getter, with the same rule**, and a spec of the handle.

### The end-to-end tier

- **The app is started on a canvas that a test chose.** A helper builds a document with the commands of the domain, so that it is one
  that the app could have made, and writes it into IndexedDB in the layout that the app uses ([ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md))
  before the app starts, from a page of the same origin that is not the app. The app then opens it as the canvas that was open last. No hook in the app
  is there for the test.
- **A test waits for what it reads**: the canvas to be drawn and fitted (`data-ready`), the edges to be drawn, the intent that it
  expects, the selection that it made. It never waits for a time. Playwright does not retry a test, and a test that is flaky has a
  cause that is found.
- **Every test has its own browser context**, so its own storage, and the tests run in parallel.
- **A page object per screen** holds the selectors, so that a change of markup is one change.

### Accessibility

- **axe runs in the end-to-end tier on every screen of the editor, in the light and in the dark theme**, with the rules for WCAG 2.0
  and 2.1 at A and AA, and 2.2 at AA. It runs for the editor with an empty canvas, with a canvas that has one of each kind of node and
  one of each kind of edge, with each kind of node selected and its inspector showing, with a refusal showing, with a context menu open, and with a
  name being edited. No rule is switched off, and an exemption would have to be written here with its reason.
- **The theme is chosen the way that a learner chooses it**, with the switch, and the page is checked after it has applied.

### How fast a big canvas is drawn

- **A canvas of 200 nodes and 500 edges is drawn in under 3 seconds**, from the moment that the page is asked for to the moment that
  the last edge has been drawn, in CI. The plan sets the budget (section 6), and the spike measured 349 ms for the first render, so the
  budget is generous for a shared runner with software rendering and is a guard against a hundredfold slowdown, not a benchmark. The
  time is written into the report of the test. Frame rates, with the overlay of S6 running, are measured on real hardware in S12.
- **The canvas is made with the commands of the domain**, as above, so that it is a canvas that the app could hold.

### The quota

- **The first end-to-end test that fills the browser's storage** lowers the quota of the origin with the Chrome DevTools Protocol
  (`Storage.overrideQuotaForOrigin`), makes a change, and checks that the learner is told, first that the space is running out and then that
  the canvas was not kept, in words that say why. It is the only test that talks to the protocol, so the way in is in one helper.

### Checking the tests themselves

- **Each new spec is checked by breaking the code**: a change that should make it fail is made, the right test is watched to fail, and the code is
  put back. The sweeps for pure code generate the changes (`mutation-sweep/`, beside `web/`), and the adapter and the browser tests
  are checked by hand. The way that each was checked is written in the closing comment of the slice's issue.
- **A property added to a spec runs at 5,000 runs with several seeds** before it is pushed, because the pre-push hook runs it at 100
  with one, and the nightly run uses a random seed at 5,000 ([ADR-0015](0015-testing-strategy-and-definition-of-done.md)).

## Consequences

### Positive

- A unit test never has to draw a canvas, and the editor is still tested as a whole, with every part real but the canvas.
- A browser test starts from a canvas that the app could have made, and cannot cheat, because the handle only reads.
- Accessibility and speed are checked on every push, so they cannot quietly get worse.

### Negative / trade-offs

- The fake canvas is a second copy of the adapter's interface. A change to the inputs or the intents is made in two places, and the
  compiler says if one is missed, because the fake must be accepted where the real one is.
- The browser tests have to build the app first (`npm run build:e2e`), and the build is not the one that is deployed, though it
  is optimised in the same way.
- A budget of 3 seconds on a shared runner can fail on a bad day. If it does, the cause is looked for before the number is raised.

## Alternatives considered

- **Draw the real canvas in jsdom with polyfills** for `ResizeObserver` and the worker. Rejected: the library measures things that
  jsdom does not have, and a test that passes on a polyfill says nothing about a browser.
- **A handle that can set the document**, to start a test faster. Rejected: a test could then reach a state that a learner cannot,
  and the seed through IndexedDB is a test of the real way that the app opens a canvas.
- **Visual regression screenshots** of the editor. Not for now: the look is checked by axe's contrast rules in both themes and by the
  owner on the deployed site, and screenshots would be the first thing to break on a font or a library upgrade.

## Related

- [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0018](0018-workspace-layout-and-dependency-rules.md),
  [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md), [ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md).
- [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md),
  [ADR-0034](0034-the-foblex-contract-suite-and-how-an-upgrade-fails-loudly.md).
- [M1 plan](../plans/m1.md), sections 6 and 7.

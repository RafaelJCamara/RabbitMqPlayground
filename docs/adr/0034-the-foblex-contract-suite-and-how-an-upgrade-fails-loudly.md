# ADR-0034: The Foblex contract suite, and how an upgrade fails loudly

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0016](0016-node-editor-library.md) (the exact pin and "guarded by tests that fail loudly on a library upgrade") and
  [ADR-0015](0015-testing-strategy-and-definition-of-done.md) (the end-to-end tier), for journey 13 of the [M1 plan](../plans/m1.md).

## Context

The editor depends on things that Foblex Flow does not document: when it reads a list, what its keyboard layer matches first, where
its events put a point. [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md) lists them. They
are safe only while the version is the one that was tested, and they break without an error: a drag that does not light the valid
targets, a key that picks a node up that it should not, a point that is a few pixels off. Someone who upgrades the library in a
hurry would find out from a learner.

## Decision

### One suite, in a real browser, on every push

- **`web/e2e/foblex-contract.spec.ts`** runs against the real library in Chromium, in the same end-to-end job as every other
  journey (`npm run test:e2e`, in CI on every push, with no retries). It is not skipped, expected to fail, or focused, and
  a spec of the tools checks that ([`tools/deps/foblex.spec.ts`](../../web/tools/deps/foblex.spec.ts)).
- **Each group of tests is named for what it guards**, with the number of the workaround, as in ADR-0033: "the live viewport
  (workaround 1 of ADR-0016)", "the list of valid targets is read when a drag starts (workaround 2…)", "edges are drawn after
  their elements exist (workaround 3…)", "a drop on a node that is not valid is not a drop on nothing (workaround 4…)". The spec
  fails if one of the four has no group.
- **It also pins what the keyboard layer does that the editor relies on** ([ADR-0017](0017-canvas-keyboard-model.md)): the canvas is
  one tab stop and the nodes are not; the arrow keys move the selection and `aria-activedescendant` follows it; Ctrl/Cmd+A and
  Escape; `M` picks up and drops, ten units a step; Delete is a request that the editor carries out; Ctrl, Cmd or Alt with `M` does
  not pick a node up; and the library speaks in our words.
- **And what it reports from the pointer**: a context menu and a double click are intents, a double click on the empty canvas does
  not zoom, a drag of a node is one move that says it came from a pointer, and a drop from the toolbox is reported where the middle of its
  preview was.
- **It says which version it ran against**, in the report of every test.
- **A test asks the page, not the editor.** The suite reads the intents that the adapter reported, the live viewport, the edges that
  are drawn and the selection, from the debug handle of the end-to-end build ([ADR-0036](0036-the-test-strategy-of-the-editor.md)). It
  does not test what the editor does with an answer. Those are the editor's journeys.
- **It waits for what it reads and never for a time.** The library reports a moment after a gesture, a key a little later than a
  pointer, and draws edges after the elements. The suite waits for the canvas to say that it is drawn and fitted, for the edges to be
  drawn, for the intent that it expects to have been reported, and for a selection to have reached the editor before it presses a key
  that is for it. A test that passed because it looked too early is the kind of test that fails on a slower machine.

### The version is one line, and an upgrade changes it on purpose

- **`@foblex/flow` is an exact version in `package.json`**, with no range. `tools/deps/foblex.spec.ts` fails if it is a range, if the
  lock file resolves another version, or if the installed package is another one, so a refreshed lock file cannot move it.
- **Its helper packages** (`@foblex/2d`, `@foblex/mediator`, `@foblex/platform`, `@foblex/utils`) are the ranges that it asks for.
  They move with it, in one group.
- **Dependabot has a group for `@foblex/*`**, so an upgrade is one pull request, and CI runs the contract suite on it like on any
  push. A red suite names the behaviour that changed, by the name of the group and of the test.

### What to do when it fails

1. **Read the name of the test.** It is the behaviour, and the number of the workaround, that changed.
2. **Change the adapter, not the test**, when the library now does something else and the editor needs what it did before. The
   adapter is the one place that knows the library, and the test is the specification of what it has to give.
3. **Delete the workaround and its test together**, in one commit with an ADR that says so, when the library now does what the
   workaround made up for (a viewport signal, a validator callback: the two that are to be asked of the library, ADR-0016).
4. **Stay on the old version** when neither is worth it. The pin is the decision, and a pull request that stays open is fine.
5. **Never skip, quarantine or retry a test** to get the upgrade through. A contract test that cannot pass is a behaviour that was
   lost.

## Consequences

### Positive

- A library upgrade cannot change one of the behaviours that the editor depends on without a red test that names it.
- The suite is also the specification of the adapter, in the one place, with the numbers of ADR-0033 on it.
- Dependabot can propose upgrades without anyone having to re-test by hand.

### Negative / trade-offs

- The suite is a few seconds of browser time on every push, and it is tied to Chromium. A behaviour that differs in another browser
  is not covered until the plan adds one.
- Its tests read the page, so some of them know class names and attributes of the library (`f-external-item-preview`, the names of the
  elements that it adds). When an upgrade renames one, a test fails for that reason too, and the fix is in the test.
- A test that waits for what it reads is slower to write than one that sleeps, and it has to be given a thing to wait for.

## Alternatives considered

- **Unit tests of the adapter with the library mocked.** Rejected: the behaviours are the library's, and a mock says what we believe
  that it does.
- **Run the suite only when the dependency changes.** Rejected: the adapter changes too, and a change there can break a
  behaviour that the library did not.
- **A caret range, and trust the suite.** Rejected: the suite would then fail on a night when nobody chose to upgrade. An exact
  pin makes the upgrade a decision, with the suite as the check on it.

## Related

- [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0016](0016-node-editor-library.md), [ADR-0017](0017-canvas-keyboard-model.md).
- [ADR-0033](0033-the-foblex-adapter-one-component-intents-out-and-the-four-workarounds.md),
  [ADR-0036](0036-the-test-strategy-of-the-editor.md).

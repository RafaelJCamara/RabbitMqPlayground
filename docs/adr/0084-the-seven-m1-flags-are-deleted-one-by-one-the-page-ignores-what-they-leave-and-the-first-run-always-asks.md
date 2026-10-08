# ADR-0084: The seven M1 flags are deleted one by one, the page ignores what they leave behind, and the first run always asks

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0004](0004-trunk-based-development-on-main.md) ("feature flags add some code paths, which have to be cleaned up once a feature ships"),
  and for the places where a flag is read, [ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md) (`editor`),
  [ADR-0057](0057-what-building-s6-settled-folders-that-run-one-way-a-strip-that-is-a-region-frames-that-cannot-jump-and-colours-read-through-a-probe.md) (`simulation`),
  [ADR-0064](0064-the-what-if-and-the-topic-tester-read-the-canvas-and-change-nothing-and-explain-is-one-flag-in-two-halves.md) (`explain`),
  [ADR-0069](0069-the-headers-flag-has-three-halves-the-producers-table-commits-row-by-row-and-s8-adds-no-key.md) (`headers`),
  [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md) (`canvases`),
  [ADR-0078](0078-a-link-is-made-from-the-canvas-as-it-is-a-shared-canvas-opens-in-an-editor-that-keeps-nothing-and-its-text-is-only-text-under-a-policy.md) and
  [ADR-0080](0080-what-building-s10-settled-the-root-loads-the-codec-for-a-link-only-zod-does-not-compile-and-a-copy-is-called-name-shared.md) (`share`, and the flags in a link) and
  [ADR-0082](0082-the-first-run-is-a-library-with-no-canvas-and-asks-what-to-start-with-the-same-chooser-opens-from-the-home.md) (`onboarding`),
  for what S12 ([#14](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/14)) deletes.

## Context

Every feature of M1 shipped behind a flag that is off by default (ADR-0004), so that `main` was always releasable while the slices were built. There are seven: `editor`, `simulation`, `explain`, `headers`, `canvases`, `share` and `onboarding`. The plan says that a finished feature's flag is deleted, and the acceptance of M1 says
"no M1 feature flags remain". A flag is read in about thirty places of the app, by about forty of its specs and by the page objects of the end-to-end tests, which open the page with `?ff=editor,simulation,…`. Four things are not obvious.

1. **Order.** The flags lean on each other: `onboarding` needs `editor`, `canvases` and `simulation`; `headers` has three halves that need `editor`, `simulation` and `explain`; `explain` needs `editor` and `simulation`; `share` needs `editor`.
2. **What a page does with the flags that are left in the world.** The owner has bookmarks with `?ff=…` and a `localStorage['rmq.flags']`, and a link that was made while the flags existed carries the sender's flags (`<page>?ff=editor,canvases,share#c=v1.…`, ADR-0080), so that it opens as it was made.
3. **The placeholder.** Without the flag `editor` the page is the "Under construction" page that S0 built. It is the page of every visitor of the deployed site today.
4. **The first run.** Without `onboarding` the library makes a blank canvas for a learner who has none. With it, it asks what to start with (ADR-0082). Every end-to-end test and many unit specs start from a library with no canvas.

## Decision

### What is deleted

- **The seven flags, and everything that is only there for them**: the registry (`FLAGS`, `FlagName`, `FLAG_NAMES`, `parseFlagList`, `resolveFlags`, `readFlagSources`, the storage key and the query parameter), its service (`FeatureFlags`, `FLAG_SOURCES`), the unit test that fails if a default is on, the `flags()` of the debug handle and the `flag` of a row of the table of keys, the "Under construction" page, the branches that a page without a flag took, and the tests that held those branches.
  The page is the whole of M1 for everyone; there is no switch.
- **What stays is not a flag**: `RMQ_E2E` and the debug handle are a switch of the build, not of the page, and the production bundle does not have them (ADR-0030). The loading of the workspace in a chunk of its own (`@defer`) stays, and so do the budgets of the initial chunk (ADR-0080).

### How: one flag at a time, in the order of what leans on what

- **One commit for each flag, with its tests, in this order: `onboarding`, `share`, `headers`, `explain`, `canvases`, `simulation`, `editor`, and then the registry.** The first is the one that needs the most others and the last is the one that everything needs, so a flag is never deleted while another that is still there depends on a half of it that is gone. Each commit leaves `main` building and its tests passing (ADR-0004). When a flag leaves the type `FlagName`, the compiler lists every place that reads it, specs included.
- **A test that held what a page without the flag did is deleted with the flag**, and not rewritten as a test of the page with the flag: the page with it is what the other tests of the feature already hold. A test that merely turned the flag on keeps its subject and loses its set-up.

### What the page does with the flags that were left

- **`?ff=` in the address and `localStorage['rmq.flags']` are not read, not warned about and not removed.** There is no registry to say that a name is unknown, and a key of a few characters in the owner's own browser is not worth a line of code that has to be kept for ever.
- **A link that carries flags opens like any link**: a link is its fragment (ADR-0077), and the query is the page's. A test holds it with a link made as S10 made them.
- **A link that is made now is the page and the fragment, without a query** (`linkBase` loses its second argument), and **leaving a link goes to the page without a query** (`PageAddress.home()` is `base()`, and goes).

### The first run always asks

- **With `onboarding` gone a library that has no canvas at start always asks what to start with** (ADR-0082): the chooser is the first thing a new visitor meets, over the empty home, and Escape, the backdrop and Cancel mean "build from scratch", as that ADR decided.
- **The tests answer the question the way a learner does, and the product has no way round it.** The page objects of the end-to-end tests press Escape on the chooser when it appears, so that a journey that is not about the chooser starts, as a learner who skipped it does, on a blank canvas called "Untitled canvas"; the journeys about the chooser answer it with the control that they are about. A unit spec that mounts the library over an empty repository gives it a chooser that answers "from scratch" (`OnboardingDialogs` is provided in the root, and a spec overrides it).
  No query, storage key, build switch or "seen" marker skips the question for a test (ADR-0082 rejected the marker for a learner, and a switch that only tests use is a path that the product does not have).

## Consequences

### Positive

- One page, one set of tests: nothing is held twice (once with the flag and once without), and the 41 specs that gave the page a list of flags get shorter.
- The deployed site shows the product. A link that is sent is shorter by its query and means the same for the sender and the receiver for as long as the page does.
- The root of the page loses its branches: a link in the address, a link that failed, or the workspace.

### Negative / trade-offs

- **There is no switch to turn a feature off.** A defect in a feature after the release is a revert or a fix, as ADR-0004 says of a red `main`. A flag for a later feature (M2) is added again with an ADR of its own.
- **Every journey of the end-to-end suite pays for the question at its start**, a few hundred milliseconds that the page objects spend on it; what was a `?ff=` is now a keypress. The workspace's strip and home are around every editor test, and so a test that measured the editor alone (a position, a count of canvases) is measured with them.
- **A visitor's first sight is a dialog.** It is what ADR-0082 chose for the finished product, and the plan wanted a first-run chooser; the owner may find that a welcome that cannot be skipped by a click outside it is too much. The way out is one line (the BLANK that Escape answers is already the default), not a flag.
- The stale `rmq.flags` in the owner's browsers stays there until they clear it.

## Alternatives considered

- **Keep the flags until `v0.1.0` is tagged, and delete them in the tag's own commit.** Rejected: the tag waits for a person, a laptop and the calendar (ADR-0086), and a flag that cannot be turned off by anyone, in a repository that has no other user than its owner, is a dead branch that the tests would hold twice for days or weeks.
- **Turn every default on and delete the registry later.** Rejected: `default: false` is a literal type (a default that is on does not compile) and the unit test for it would have to be turned inside out; a switch that is on for everyone is not a switch.
- **One commit that deletes all seven.** Rejected: ADR-0004 and the owner's rule are small commits with their tests, and the order above is how a failure is found where it was made.
- **Skip the first-run question in the tests with a switch of the e2e build** (as the debug handle is). Rejected: the question is the first thing a learner meets, and a build that does not ask is a build that does not test it; the page objects answer it by the keyboard, which is also a journey (S11 holds the others).
- **Remove a stale `rmq.flags` when the page starts.** Rejected: it is a line that is kept for ever for one browser.

## Related

- [ADR-0004](0004-trunk-based-development-on-main.md), [ADR-0082](0082-the-first-run-is-a-library-with-no-canvas-and-asks-what-to-start-with-the-same-chooser-opens-from-the-home.md), [ADR-0086](0086-the-release-waits-for-a-person-a-laptop-and-the-calendar-and-says-exactly-what-is-left.md)
- Issue [#14](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/14); "What S12 inherits" in [OPEN_QUESTIONS](../../OPEN_QUESTIONS.md).

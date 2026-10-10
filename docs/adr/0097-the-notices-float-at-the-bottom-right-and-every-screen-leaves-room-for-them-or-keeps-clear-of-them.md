# ADR-0097: The notices float at the bottom right, and every screen leaves room for them or keeps clear of them

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0085](0085-targets-are-24-pixels-nothing-that-stays-is-drawn-over-the-canvas-and-every-screen-is-checked-in-both-themes-from-a-list.md) (what floats must not cover what a learner needs).
  It supersedes the placement of the notices in [ADR-0074](0074-delete-clear-and-delete-all-ask-once-and-can-be-taken-back-with-an-undo-that-says-how-long-it-lasts.md) ("at the bottom of the screen") and the section "The notices are in the flow" of [ADR-0076](0076-what-building-s9-settled-the-notices-are-in-the-flow-the-strip-is-the-banner-a-view-is-said-aloud-and-a-tab-can-be-renamed.md). What a notice says, how long it waits, its Undo, its Dismiss, Escape on it, the limit of three and the announcement stand.

## Context

- ADR-0076 put the notices in the flow: a bar across the bottom of the workspace, under the view, that takes room from it. That is what fixed a real defect: a notice that was fixed to the corner of the page covered the **Delete** of the last card of the home, and a learner who deleted the cards one after another could not press the last one.
- A bar in the flow is also not what a learner expects of a notice. It is a stripe that moves the whole view up and down each time a notice comes or goes, it is as wide as the page, and it looks like a part of the screen and not like something that happened.
- The request is the usual one: a notice that **floats** at the bottom right, on the home, in the editor and in the shared view. The defect of ADR-0076 must not come back, and the editor must not lose room for the canvas (ADR-0085).

## Decision

- **A stack of cards at the bottom right of the page.** The region **Notices** is `fixed` at the right edge, 20 rem wide, the width of the inspector (`w-80`), with its cards in it, the newest at the bottom, each with a border and a shadow, above everything of the page but a dialog. It is there only while there is a notice. Only the cards take the pointer: the stack does not stand between the pointer and what is around it. What a card says, its Undo, its Dismiss, Escape, the 30 seconds that stop when the pointer or the cursor is on it, the limit of three, the one announcement through the announcer and that the region is not a live region are as they were.
- **The stack never covers what is needed. There are two ways to keep that rule, and each screen has one.**
  - **A screen that scrolls leaves room.** The host measures its stack (`offsetHeight`, again whenever the stack changes size) and publishes `--toast-room`, its height and the space around it, as a length of the page, and `0px` when there is no notice. The home pads the foot of its scrolling area with it (`padding-bottom`) and sets it as `scroll-padding-bottom`. So the last card can always be scrolled above the stack, and a control that gets the cursor is brought clear of the stack by the browser (WCAG 2.4.11, Focus Not Obscured). That is the guard of ADR-0076's defect, and its test, "puts the cursor on the card that takes the place of the one deleted ... when none is left", passes unchanged.
  - **The editor keeps clear.** The stack is as wide as the inspector and floats over its foot, so it is never over the canvas, which is what ADR-0085 asks, and never over the bars at the foot of the editor: the log, the command bar, the hints and the status are in one box that the editor measures, and `--toast-bottom` lifts the stack by its height. The inspector pads its foot and sets `scroll-padding-bottom` with `--toast-room`, as the home does, so its last control is reached too.
  - The shared view is an editor, and has the same.
- **The properties are of the page** (the `html` element), because the host, the home and the editor are three components that have no parent in common that is not the page. The host takes `--toast-room` away when it goes, and the editor takes `--toast-bottom` away when it goes.
- **No pointer is needed, and nothing moves for long.** The cards come and go without an animation, and nothing here depends on the pointer.

## Consequences

### Positive

- A notice looks like one, and does not move the view.
- A learner can still delete every card, one after another, and press the last **Delete**.
- The canvas keeps all its room: the stack is over the inspector, which scrolls.

### Negative / trade-offs

- The stack is over something in every screen: the foot of the home's cards, and the foot of the inspector. The padding and the scroll padding are what make that harmless, and they are held by browser tests that put three notices on each and ask what is at the middle of the controls.
- Two lengths are published on the page, and a screen that scrolls at the right of the page and does not pad its foot with `--toast-room` would be covered. A new screen of that kind must do so; the test of the home and of the editor are the examples.
- On a window narrower than the toolbox, the canvas and the inspector together, the stack is still 20 rem, over what is there. This is the same for the inspector, which does not shrink either.

## Alternatives considered

- **Keep the bar in the flow and only style it as a card.** It would still move the view and be as wide as the page.
- **Float over the corner and add nothing.** This is the defect of ADR-0076.
- **Float at the bottom of the canvas.** It would cover nodes, which ADR-0085 forbids.
- **Put the notices in the top bar's status line.** Too small for an Undo, and the status line already says what the last change was.

## Related

- [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md) (a deleted canvas is kept for a minute), [docs/accessibility.md](../accessibility.md).
- Tests: `projects/app/src/app/core/ui/toast-host.spec.ts`, `projects/app/src/app/editor/editor.spec.ts` ("the notices that float over the inspector"), `e2e/focus-not-obscured.spec.ts` ("what floats at the bottom right does not cover what is needed"), `e2e/canvases-delete.spec.ts` (unchanged), and the two axe states with three notices in `e2e/canvases-a11y.spec.ts`.

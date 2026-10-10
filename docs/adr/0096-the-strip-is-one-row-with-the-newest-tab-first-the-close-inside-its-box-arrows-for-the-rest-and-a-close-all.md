# ADR-0096: The strip is one row with the newest tab first, the close inside its box, arrows for the rest, and a Close all

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md) (the strip) and [ADR-0076](0076-what-building-s9-settled-the-notices-are-in-the-flow-the-strip-is-the-banner-a-view-is-said-aloud-and-a-tab-can-be-renamed.md) (the strip is the banner and holds the one heading).
  It supersedes two sentences of ADR-0072: "The strip wraps to more lines when it has more than fits, and does not scroll sideways, so no item is hidden", and the order of the tabs, where a canvas that is opened is added at the end. The rest stands.

## Context

- A canvas that is opened adds a tab, and nothing takes one away, so the strip grew without a limit. Because it wrapped (ADR-0072), twelve open canvases made a strip of four lines, and the editor under it lost a third of its height. The room for the canvas is the point of the editor (ADR-0085 keeps things off it), and the strip was taking it.
- The newest canvas is the one a learner is working on, and it was at the far end of the row, where the row wraps.
- The close of a tab was a button beside the box of the tab, so the tab was two boxes. A tab is one thing: its close is at its right end, inside it.
- To close the strip's canvases a learner had to press a close for each. Nothing took them all away.
- The name of the product is the one heading of the page (ADR-0076), and a learner who clicks it expects the front page, which here is My canvases.
- ADR-0072 wanted no item hidden (WCAG 1.4.10, reflow), and was right to: a strip that scrolls without a way to reach what it hides is worse than one that wraps.

## Decision

- **One row, however many tabs.** The name of the product, **My canvases**, **New canvas** and **Close all** stay where they are. Only the list of tabs scrolls sideways, with its scrollbar hidden. The strip has the same height with no tab as with fifty, so opening or closing a tab never moves the editor. When the window is too narrow for the buttons that stay, the strip wraps as before, and the tabs then have a row of their own.
- **Nothing is out of reach.**
  - Two buttons at the ends of the tabs, **Show newer canvases** and **Show older canvases**, each with a name in words, at least 24 by 24 pixels (ADR-0085), are there only while there are tabs out of sight on that side. A press scrolls by about four fifths of what is in sight, gently, and without motion when the learner asked for less (ADR-0010).
  - Every tab is a button that Tab reaches, and a tab that gets the cursor is scrolled into view by the browser, so a keyboard user passes through all of them without the arrows. That is what keeps the strip within WCAG 1.4.10 (no loss of content or function) and 2.1.1 (keyboard).
  - When the arrow that has the cursor goes, because there is nothing more on its side, the cursor goes to the tab at that end, so that it is not lost (WCAG 2.4.3).
  - When the canvas that is shown changes, its tab is scrolled into view. A tab that is closed, renamed or made does not move the strip under a learner who scrolled it.
- **The newest first.** A canvas that is opened or made is put at the start of the strip, which is the left. A canvas that is open already keeps its place when it is shown again, so tabs never jump under the pointer. The order that is saved (`openCanvases`) is the order that is shown, so a strip that was saved before this change is read as it is and nothing is migrated. A canvas that is brought back by the Undo of a delete goes to the place it had. Closing the one that is shown still shows the one on its left (the newer one), or on its right if it was the first.
- **The close is inside the box of its tab.** The `li` of a tab is the box (border, corners, colours of the tab that is shown and of the others), and holds two buttons that are its siblings and not one inside the other: the name, with no border, and a close of 24 by 24 pixels at its right end, with no border. The name keeps its tooltip, its double click and F2 (ADR-0076). They are not nested, which is ADR-0072's reason for not using the ARIA tabs pattern, and it stands.
- **Close all.** A button **Close all** (its name is "Close all tabs") is in the strip while a tab is open. It closes every tab, shows My canvases, saves the strip as empty, says "Closed all tabs.", and puts the cursor on My canvases. It deletes no canvas, so it asks nothing and offers no Undo: every canvas is on the home and opens again from its card. **Delete all** on the home is unchanged, and is the way to take the canvases away.
- **The name of the product shows My canvases.** In the workspace the `h1` holds a button with the name of the product, which shows the home. It is still the one heading of the page, and the name is still the constant of the app. The shared view, and the top bar outside the workspace, keep a plain heading.

## Consequences

### Positive

- The editor keeps the same room however many canvases are open, and the newest canvas is where the eye is.
- A tab is one box that has its close in it, as every tab a learner has met.
- A learner can take every tab away at once and does not lose anything.

### Negative / trade-offs

- A strip that scrolls hides tabs from a pointer's first look. The arrows are there only when something is hidden, and they say so by their names; the tab of the canvas that is shown is always in view.
- A strip that was saved before this change has its oldest tab first, until new canvases are put in front of it. It is the order the learner had.
- A press on Close all is not asked about. The only things it can lose are the places in the strip, which are one press of a card each.
- The widths are a layout of the browser, and jsdom has none: the arrows are held by the unit tests with the sizes given by hand, and by browser tests with real ones.

## Alternatives considered

- **Keep wrapping and cap the tabs at some number.** A cap is arbitrary, and a learner who wants a thirteenth tab would have to close one.
- **Put the tabs in a menu when there are more than fit.** A menu hides every tab behind a press, and a canvas that is open is a thing to see.
- **Drag the strip with the pointer and no arrows.** There is no way to do it with a keyboard or a screen reader, and no sign that there is more.
- **Ask before Close all.** Nothing is lost by it, and every question that is not needed teaches a learner to press through questions.
- **Move a canvas that is shown to the start.** Tabs would jump under the pointer each time one is pressed.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md) (reduced motion), [ADR-0085](0085-targets-are-24-pixels-nothing-that-stays-is-drawn-over-the-canvas-and-every-screen-is-checked-in-both-themes-from-a-list.md) (targets of 24 pixels, and nothing drawn over the canvas), [docs/accessibility.md](../accessibility.md).
- Tests: `projects/app/src/app/canvases/workspace.spec.ts`, `library.spec.ts`, `library-first-run.spec.ts`, `e2e/canvases-strip.spec.ts`, and the axe state "in the workspace with more open canvases than the strip holds, and the arrows that show the rest" in `e2e/canvases-a11y.spec.ts`.

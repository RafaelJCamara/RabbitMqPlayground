# ADR-0095: A press on the drawing of a card opens the canvas, and a double click on its name renames it

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0073](0073-the-home-is-a-grid-of-cards-from-one-read-and-a-canvas-that-cannot-be-read-is-listed-with-its-reason.md) (the card). It supersedes one sentence of it, "The name and the thumbnail are not the button: a click on them selects nothing", and the rest stands.

## Context

- The card of a canvas on the home has a drawing, a name and six buttons, and **Open** is the only way to open the canvas from the home with the pointer. A learner who sees a drawing of a canvas presses the drawing, and nothing happens. The name does nothing either, and the tab of a canvas in the strip already renames on a double click (ADR-0076), so the same gesture on the name of a card is what a learner tries.
- ADR-0073 left both out on purpose, "so that a learner who reads the card does not open it". Reading is done with the eyes and the pointer resting on the card, not with a press, and a press on a picture of a canvas that opens the canvas is what the picture promises. The risk that remains is a single press on the name, which opens nothing and stays so.
- Everything a pointer can do on the card must be possible without one (WCAG 2.1.1), and a keyboard user and a screen-reader user must meet one **Open** and one **Rename** per card and no extra stop.

## Decision

- **The drawing is a button that opens the canvas**, `type="button"` around the thumbnail, with `tabindex="-1"` and `aria-hidden="true"`. It is a pointer's copy of **Open**: it emits the same `open` as the button, so the library, the strip and the editor see one thing. It has no tab stop and is not in the accessibility tree, so a keyboard and a screen reader meet one Open per card, as before. A focusable element that is hidden is not allowed, but one that cannot be reached with Tab (`tabindex="-1"`) is, and the axe states of the home say so. The drawing shows the pointer as a pointer.
- **A double click on the name renames the canvas**, with the same dialog as the **Rename** button, the same `rename` output and the same name in the field. A single press on the name does nothing. The name is `select-none`, so that the double click does not select a word behind the dialog. Its tooltip says "(double-click to rename)" after the whole name, which it already showed when the name is cut.
- **Nothing is only for the pointer.** **Open** and **Rename** stay as buttons with the name of the canvas (`Open Orders`, `Rename Orders`), and the whole card is what it was for a keyboard, a screen reader and voice control. On a touch screen a press on the drawing opens, and a double tap on a name may or may not rename depending on the browser, so **Rename** is the way.
- **The tab strip, the other buttons and the order of the card do not change.**

## Consequences

### Positive

- The biggest thing on a card opens it. A learner does not need to find the small button.
- Renaming a card is the gesture of renaming a tab.

### Negative / trade-offs

- A name that is `select-none` cannot be selected with the pointer to be copied. It can be copied from the rename dialog, which has the name selected, and from the tab.
- A hidden control is a copy of a visible one, which is a thing to keep in step: the two share the one `open` output, and a spec counts the buttons of a card (six, one of them Open) so that a second visible or tabbable one cannot appear unnoticed.
- A press on the drawing of a card opens a canvas without a confirmation, as **Open** does. Opening is not destructive, and a learner closes the tab.

## Alternatives considered

- **Make the whole card the button (a link around it).** The card holds six buttons, and buttons inside a link are not valid (ADR-0072 has the same reason for the strip). Not chosen.
- **Make the drawing a visible, focusable button named "Open <name>" and drop the Open button.** The drawing is decoration (ADR-0073), a keyboard user would meet a button that has no words, and the visible word is what voice control says.
- **A single click on the name opens the canvas.** This is the thing ADR-0073 kept out: a learner who reads would open it. Not chosen.

## Related

- [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md), [ADR-0076](0076-what-building-s9-settled-the-notices-are-in-the-flow-the-strip-is-the-banner-a-view-is-said-aloud-and-a-tab-can-be-renamed.md) (a tab is renamed with a double click), [docs/accessibility.md](../accessibility.md).
- Tests: `projects/app/src/app/canvases/card.spec.ts`, `home.spec.ts`, `e2e/canvases-basics.spec.ts` ("opens a canvas when its drawing is pressed, and renames it when its name is double-clicked").

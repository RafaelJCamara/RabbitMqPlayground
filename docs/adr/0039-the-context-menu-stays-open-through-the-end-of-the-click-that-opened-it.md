# ADR-0039: The context menu stays open through the end of the click that opened it

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md) (a menu opens from a pointer and from a key, and
  gives the focus back) and [ADR-0036](0036-the-test-strategy-of-the-editor.md) (the end-to-end tests run on one system at a time), for
  what the first run of S4's tests on Linux showed ([#6](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/6)).

## Context

The context menu of a node or an edge is the CDK's. The canvas knows what was pointed at, and a key opens the menu as well, so the editor
tells the CDK to open it at a point (`open(coordinates)`), and does not leave the opening to the CDK's own `contextmenu` listener.

Browsers do not send the events of a right click in one order. Windows sends `contextmenu` after the button comes up. macOS and Linux send
it when the button goes down, so the menu is open while the button is still held, and the release that follows, an `auxclick` (a `click`
for the Control click of a Mac), is a click outside a menu that has just opened. The CDK closes a menu on a click outside it. It guards
against this when its own listener opens the menu, by skipping the first `auxclick` and a first Control click, and it does not when it
is told to open a menu at a point.

So the menu opened and closed in the same click on macOS and on Linux, and worked on the system that the author uses. The end-to-end tests
that right-click passed on Windows and failed in CI, which runs on Linux. A test that sent the events in the order of macOS and Linux
reproduced it on Windows.

## Decision

- **The menu holds the end of the click that opened it.** From the moment it opens, the first `click` or `auxclick` outside the menu is
  stopped before the CDK hears it (a listener on the document, in the capture phase), and that ends the hold.
- **A press or a key ends the hold as well**, because from then on a click outside is meant to close the menu. The press that opened the
  menu came before it opened, so it never reaches the hold. On Windows there is no end of a click to hold, and the hold lasts until the next
  press, which is the click that is meant to close the menu.
- **A click in the menu is never held.** It is a choice, and a screen reader's "click" arrives with no press or key before it.
- **The menu does not need to know how it was opened.** One that a key opens is held in the same way, and the next press or key ends it.
- **Tests send the events in both orders, on whichever system they run.** A unit test of the menu sends what follows its opening, and an
  end-to-end test sends `pointerdown`, `mousedown`, `contextmenu`, `pointerup`, `mouseup` and the click that ends it
  (`rightClickMenuFirst`, in the editor's page object), for the right button and for the Control click.

## Consequences

### Positive

- The menu works on the three systems, and the tests do not depend on the system that runs them.
- The hold is one small piece, in the component of the menu.

### Negative / trade-offs

- It adds a guard of ours where the CDK has one on its own path. If the CDK guards `open()` as well, the two do the same thing and
  nothing breaks.
- A click that comes with no press and no key, after the menu is opened and before anything else, is held once. A script does that, and
  so does an assistive technology that clicks outside the menu. The next click closes it.

## Alternatives considered

- **Let the CDK open the menu from its own `contextmenu` listener.** Rejected: the listener would have to be on an element that covers the
  canvas, the canvas is what decides what was pointed at, and a key has no event.
- **Send the CDK an event that we make** (a `contextmenu` on its trigger), so that its guard applies. Rejected: the button, the modifier
  keys and the position would have to be carried from the real event, and the CDK's guard would become part of how the menu works.
- **Ignore clicks for some milliseconds after it opens.** Rejected: the button may be held for as long as the learner likes, so no time is
  the right one.
- **Open the menu with the pointer inside it.** Rejected: the first item would be under the pointer, and a second click would choose it.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md),
  [ADR-0036](0036-the-test-strategy-of-the-editor.md).

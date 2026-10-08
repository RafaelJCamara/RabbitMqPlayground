# ADR-0085: Targets are 24 pixels, nothing that stays on the screen is drawn over the canvas, and every screen is checked in both themes from a list

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0017](0017-canvas-keyboard-model.md) (section 5, "toasts and panels must not cover the active item", and section 6, "connection handles keep their 12 px dot but get a hit area of at least 24 × 24 px"),
  [ADR-0015](0015-testing-strategy-and-definition-of-done.md) ("a complete keyboard-only journey: create → link → publish", "no serious or critical axe violations on the main screens"),
  [ADR-0010](0010-explanation-first-editor-ux.md) (WCAG 2.2 AA) and
  [ADR-0062](0062-why-is-painted-by-the-adapter-with-classes-from-an-emphasis-and-the-reasons-are-words-on-the-labels.md) (the card of Why?),
  for what S12 ([#14](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/14)) checks and fixes.

## Context

Eleven slices each brought their own accessibility tests, and S12 is asked for four things: a keyboard-only journey, axe on every screen in both themes, handle hit areas of at least 24 × 24 pixels, and a focused item that is never covered. Looking at what is there first:

- **Axe** runs in every `*-a11y` journey with the tags of WCAG 2.0 to 2.2 A and AA and the best-practice rules, and `target-size` (2.5.8) is one of them. There are about two hundred states in both themes, one per screen state that a slice thought of. Nothing says whether a screen was missed, and a slice that adds a component has no reason to ask.
- **The hit area of a handle** has been 24 × 24 pixels in the style sheet since S4, with a 12 pixel dot in it. No test measures it, and axe cannot: a Foblex handle has no role.
- **A focused item that is covered** is not hypothetical. The card of Why? (ADR-0062) is drawn over the canvas in its top left corner, and at the size of the browser of the tests (1280 by 720) with the event log open the canvas is a little over two hundred pixels tall, so the card covers the middle of a node. Two journeys found it when the Share and Export buttons, which were behind a flag, made the top bar two rows tall: they could not click the producer, because the card was in the way. A learner who selects that node with the arrow keys would have its ring under the card.
- **A journey with the keyboard alone** exists in pieces (the editor, the command bar, the canvases), and none goes from an empty canvas to a message in a queue without a pointer, nor holds that the single-key shortcuts leave a text field alone (WCAG 2.1.4) or that Ctrl or Cmd with M does not pick a node up.

## Decision

### Nothing that stays is drawn over the canvas

- **A card, a strip or a note that is there because of a state of the document or the simulation is in the flow of the page, in a column or a row of its own, and is never drawn over the canvas.** What is opened by the learner at a point, and goes with Escape or when the cursor leaves it (the popovers that ask for a key or for conditions, the menus, the picker of "Link to…", the card of a chip that is looked at), may be over the canvas: it takes the cursor when it opens and gives it back when it goes (ADR-0035, ADR-0066), so the focused thing is in it.
- **The card of Why? moves from the corner of the canvas to the top of the inspector column**, where the message inspector and the what-if tester already are, and has the width of the column. It is the same component with the same words, the same legend and the same button; it is no longer a card on a shadow but a block of the column, and it is not drawn over anything.
- **How it is held**: a test in the browser, at the size of the others, opens each thing that stays (the event log with a message open, the Why? of a message, the answer of the what-if tester, a template that has messages) and asks, for every node, which element is at the middle of its box (`elementsFromPoint`): it must be the node, a part of it or something that lets the pointer through. A node that something else is at the middle of fails the test and says what. The keyboard journey asks the same of the item that has the cursor, after each key.

### Targets are 24 by 24 pixels

- **Every target of a pointer is at least 24 by 24 CSS pixels at 100% zoom of the canvas** (WCAG 2.5.8), or has the 24 pixel circle of the exception clear of the others. Axe holds the controls of the page (its `target-size` rule runs in every state below, in both themes). The targets that axe cannot see are measured in the browser: the handles of the nodes (the box that the pointer finds, 24 by 24, with the dot of 12 in it), the markers of the messages (`HIT_RADIUS` is 12, which is a circle of 24), and the controls that are drawn on the canvas.
- **Below 100% zoom the canvas scales its handles with everything else**, and a handle on a canvas fitted to 50% is 12 pixels across. That is the learner's own zoom of their own content, and every drag has an alternative that does not depend on it (ADR-0017, section 6: the picker, the keyboard, the command bar). The test measures at scale 1 and says so.

### Every screen is in a list, and the list is held to the app

- **`docs/accessibility.md` lists the screens and states of the app, each with the test that runs axe on it in both themes**, written for a person who has to look at it: what is on the screen, which spec and which test, and what the manual pass of a screen reader should do there. A **unit test holds the list to the code**: every component of the app (every `rmq-…` selector) is in a row of the table, either as a screen or a part of one that is named; every row names a spec file that exists and a test in it whose words are in the file; and every a11y spec runs the same states in both themes. A component that is added without a row fails the test, which is the reminder that a slice that adds a screen has to say where axe looks at it.
- **Gaps are closed with tests, in both themes**, in the same journeys as their neighbours: the states that the list shows no test for.

### The keyboard-only journey has no pointer

- **A journey of the keyboard alone is a test whose page cannot use a pointer**: the page that it is given throws when anything calls `mouse`, `click`, `hover`, `tap` or `dragTo`, so that a test that reaches for the pointer fails instead of passing. It goes from an empty canvas to a message in a queue and a consumer (add by the keyboard, link with `L` and the arrows, bind, publish with `P`, step), reads what each step said (the status line and the live region), and holds two rules of ADR-0017: **a single key does nothing in a text field** (the keys of the page are typed into the name field, the field of the command bar and the fields of the inspector, and only text is the result), and **Ctrl or Cmd with M does not pick a node up**.

## Consequences

### Positive

- Nothing on the screen can cover the node that has the cursor, and a test says so for every state that stays, so a new card cannot put itself over the canvas without a failing test.
- The hit area of a handle is a number that a test reads, and a screen without an axe test is a failing unit test and not a thing that nobody noticed.
- The journey that the issue asks for is one that cannot be passed by a mouse.

### Negative / trade-offs

- **The card of Why? is no longer next to the lines that it explains.** It is a block at the top of the right column, which a learner who looks at the canvas has to look across to. The column is scrolled, so the card can scroll out of sight, and the inspector below it starts lower while it is there (at 720 pixels of height with the log open, the column is a little over two hundred pixels tall, and the card is most of it). The card is short and has its button.
- The table of screens is a document that has to be kept, and the unit test that holds it is as strict as the people who write the rows are: a row can name a test that does not check what the row says. The test checks that the words are in the file, not that they mean it.
- The test that no pointer is used patches the methods of the locator for the length of the journey, which is a thing a future version of the test library may not allow.

## Alternatives considered

- **Keep the card over the canvas and move it out of the way** (to the corner with the least on it, or away from the node that has the cursor). Rejected: a card that moves is a layout that a learner has to find again (WCAG 3.2.3 asks for what repeats to be in the same place), and it is a rule that is hard to test and easy to break.
- **Put the card in the flow under the canvas, or above it.** Rejected: under it, the card (a legend, a sentence and a button) takes sixty or more pixels of a canvas that is already small when the log is open; above it, the canvas and what is lit on it move down under the learner's eyes when the card comes.
- **Let the learner dismiss the card, and call the criterion met** (the card has its button). Rejected: 2.4.11 asks that the item is not entirely hidden when it takes the cursor, and a learner who arrives at a node with the keys does not know that something is over it.
- **Measure the handles at every zoom.** Rejected: 2.5.8 is about the size of the target at the default scale; a canvas that the learner has made smaller is theirs, and zooming in makes the target bigger.
- **Run axe at the end of every end-to-end test, in whatever state it ended**, in place of a list. Rejected for now: it would give breadth for free and no way to say which screens were seen, and it turns tests that end in odd states (a page being left, a closed dialog) into tests of those states. It could be added on top of the list.

## Related

- [ADR-0017](0017-canvas-keyboard-model.md), [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0062](0062-why-is-painted-by-the-adapter-with-classes-from-an-emphasis-and-the-reasons-are-words-on-the-labels.md), [ADR-0084](0084-the-seven-m1-flags-are-deleted-one-by-one-the-page-ignores-what-they-leave-and-the-first-run-always-asks.md)
- [WCAG 2.2: 2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum), [2.5.8 Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum), [2.1.4 Character Key Shortcuts](https://www.w3.org/TR/WCAG22/#character-key-shortcuts)

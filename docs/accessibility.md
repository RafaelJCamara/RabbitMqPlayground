# Accessibility

RabbitMQ Playground aims at WCAG 2.2 level AA ([ADR-0010](adr/0010-explanation-first-editor-ux.md)), and [ADR-0085](adr/0085-targets-are-24-pixels-nothing-that-stays-is-drawn-over-the-canvas-and-every-screen-is-checked-in-both-themes-from-a-list.md) says how that is kept. This page is for a person who has to look at it: what machines check, which screens and states they look at, which criteria of WCAG 2.2 matter here and where each is met, and the script of the one pass that a machine cannot make, with a screen reader, to be followed once for each release.

The tables below are held to the code by a unit test, `tools/accessibility/accessibility.spec.ts` (run it from `web/` with `npx vitest run tools`). It fails when a component of the app is in no row of the tables, when a row names a test that is not there or words that are not in it, when a spec starts to run axe on a state that has no row, and when axe runs in only one theme. A slice that adds a screen has to say here where axe looks at it.

**To add a state:** put it in the array of states of the matching `*-a11y` spec (or add a test that calls `expectNoAxeViolations(page)`), inside the loop over the two themes; run it in both themes; and add a row to the table of its area, with the components that it shows (the `rmq-…` selectors, apart from those that are always on screen) and a reference to its test: the path of the spec in backticks, a middle dot, and the exact name of the state in quotes, as in `e2e/editor-a11y.spec.ts` · "with nothing selected". The words of a reference are checked against the file.

## What machines check

| What | Where | What it holds |
|---|---|---|
| Axe on every screen and state of the tables below | `e2e/support/axe.ts` | axe-core with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` and `best-practice`, which are the rules of WCAG 2.0 to 2.2 at A and AA and its best practices, with no rule switched off. It fails on any violation, not only on the serious and critical ones that ADR-0015 asks for, and it fails if fewer than eleven of the rules passed, which says that axe did not run. It includes `color-contrast` (1.4.3) and `target-size` (2.5.8) for what is on the page. |
| Both themes | the specs named in the tables, `e2e/smoke.spec.ts` | Every call of axe is inside `for (const colorScheme of ['light', 'dark'] as const)`, which sets the `prefers-color-scheme` of the page, and most specs have a test that the page really is in the theme that it is tested in. The exceptions are in the unit test, each with its reason: two tests of `e2e/smoke.spec.ts` set `data-theme` on the page, one for each theme, to hold that the choice made on the page wins over the system's. |
| The keyboard alone | `e2e/keyboard-only.spec.ts` · "creates, links with L and the arrows, binds, publishes with P, steps"<br>`e2e/support/no-pointer.ts` | A journey from an empty canvas to a message in a queue and a consumer, on a page that throws on any call of `mouse`, `click`, `hover`, `tap` or `dragTo`: add with the toolbox, link with `L` and the arrows, bind (the key is asked in a popover), publish with `P`, step, read what was said (the status line and the live region), open the log. More tests hold two rules of ADR-0017: a single key does nothing in a text field (2.1.4), and Control or Command with `M` does not pick a node up. |
| Targets of 24 by 24 pixels | `e2e/targets.spec.ts` · "are 24 by 24 pixels at the scale of 100%"<br>`projects/app/src/app/canvas/overlay/overlay.spec.ts` · "a press on a shape" | The handle of a node is a dot of 12 pixels in a box of 24 by 24 that the pointer finds over the whole of it, measured in the browser at 100% zoom of the canvas. The shape of a message is found by a press up to `HIT_RADIUS` (12 pixels) from its middle, which is a circle of 24; the unit test holds the number. The controls of the page are axe's `target-size`, in every state below. |
| A focused thing is not covered | `e2e/focus-not-obscured.spec.ts` · "has no node covered by the card of Why? of the message that was routed last, with the event log open" | At 1280 by 720 with the event log open, in each state that stays on the screen (a message open, the Why? of a message, the answer of the what-if tester), it asks of every node which element is at its middle. The card of Why? is the top of the inspector, and nothing that stays is drawn over the canvas (2.4.11). |
| Reflow at 320 pixels | `e2e/smoke.spec.ts` · "has no horizontal scrolling at 320 px wide in the welcome and on the home" | The welcome and the home do not scroll sideways at 320 pixels wide (1.4.10). The canvas is a diagram and keeps its two dimensions, which the criterion allows. |
| The colours | `tools/theme/tokens.spec.ts` | The colour tokens of `styles.css`, for each theme, held to 4.5:1 for text and 3:1 for graphics, borders and the focus ring, for every pair that the editor draws. Axe reads the rendered page; this fails first when a colour is changed to one that cannot be read. |
| This page | `tools/accessibility/accessibility.spec.ts` | The rows and references of this page, and the loops over the two themes, as the paragraphs above say. |

## Screens and states

Every row is a state of the app that has an axe test in both themes, the light one and the dark one. The first column says what the screen shows. The second lists the components (`rmq-…`) that were on the screen with a box when axe ran, measured in the browser, apart from the ones that are always there, which the first table lists. The third names the spec and the exact name of the state in it. A state is an entry of the `states` of a spec, or a test that calls `expectNoAxeViolations`.

### Always on screen

These are on the screen in every state of the editor, and are not repeated in the rows. The last column is the first state in which axe looks at them.

| Components | What they are | Axe sees them first in |
|---|---|---|
| `rmq-root`, `rmq-workspace`, `rmq-icon` | The page: the name of the product, which is its one heading, the strip of open canvases, and the icons, which are decoration and hidden from a screen reader. | `e2e/onboarding-a11y.spec.ts` · "the question at the first run has no axe violations" |
| `rmq-editor` | The editor of one canvas, in the regions that follow. | `e2e/editor-a11y.spec.ts` · "with nothing selected" |
| `rmq-top-bar` | Undo and redo, auto-layout, the view, Share, Export, the help and the theme. | `e2e/editor-a11y.spec.ts` · "with nothing selected" |
| `rmq-toolbox` | The toolbar that adds a node: one tab stop, the arrow keys go along it. | `e2e/editor-a11y.spec.ts` · "with nothing selected" |
| `rmq-flow-canvas`, `rmq-message-overlay`, `rmq-node-stats` | The canvas, which is the diagram; the picture of the messages over it, which takes no pointer and is hidden from a screen reader; and the numbers under each node, which say the same in words. | `e2e/editor-a11y.spec.ts` · "with nothing selected" |
| `rmq-inspector`, `rmq-what-if`, `rmq-switch` | The inspector, the button of the what-if tester under it, and the switches. | `e2e/editor-a11y.spec.ts` · "with nothing selected" |
| `rmq-hint-bar`, `rmq-status-bar` | The line of the keys for what is selected, and the status line, where a notice or a refusal of the editor is said. | `e2e/editor-a11y.spec.ts` · "with nothing selected" |
| `rmq-simulation-bar`, `rmq-log-toggle`, `rmq-command-bar` | The strip of the simulation, the button of the event log, and the command bar, which is one line while it is closed. | `e2e/editor-a11y.spec.ts` · "with nothing selected" |
| `rmq-context-menu` | The anchor of the context menu and of the menu that a link let go on nothing opens. It draws nothing until a menu is opened. | `e2e/editor-a11y.spec.ts` · "with the context menu of a node open" |

### First run, and the start of the page

| State | Components | Axe test, both themes |
|---|---|---|
| The editor on an empty canvas | `rmq-how-to-link` | `e2e/editor-shell.spec.ts` · "has no axe violations" |
| The editor with the theme chosen on the control of the top bar, light and then dark | `rmq-how-to-link` | `e2e/editor-shell.spec.ts` · "has no axe violations, whatever the operating system says" |
| The welcome: the question at the first run | `rmq-home`, `rmq-template-chooser` | `e2e/onboarding-a11y.spec.ts` · "the question at the first run has no axe violations" |
| The page while the canvas of a link is unpacked | — | `e2e/onboarding-a11y.spec.ts` · "the page while it unpacks the canvas of a link has no axe violations" |
| The same question, asked from the home | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-template-chooser`, `rmq-thumbnail` | `e2e/onboarding-a11y.spec.ts` · "the question from the home has no axe violations" |
| A template that was opened, with the notice that says what to try | `rmq-toast-host` | `e2e/onboarding-a11y.spec.ts` · "a template that was opened, with the notice that says what to try, has no axe violations" |
| The editor on the new canvas that the first question leaves, with the card of How to link | `rmq-how-to-link` | `e2e/smoke.spec.ts` · "has no axe violations" |
| The same page with the dark theme chosen on the page, over a light system | `rmq-how-to-link` | `e2e/smoke.spec.ts` · "data-theme="dark" wins over a light operating system setting, with no axe violations" |
| The same page with the light theme chosen on the page, over a dark system | `rmq-how-to-link` | `e2e/smoke.spec.ts` · "data-theme="light" wins over a dark operating system setting, with no axe violations" |

### The workspace and the home

| State | Components | Axe test, both themes |
|---|---|---|
| In the workspace, on a first run, with the strip and the editor | `rmq-how-to-link` | `e2e/canvases-a11y.spec.ts` · "in the workspace, on a first run, with the strip and the editor" |
| In the workspace with several open canvases, one of them shown | `rmq-how-to-link` | `e2e/canvases-a11y.spec.ts` · "in the workspace with several open canvases, one of them shown" |
| On the home, with a card for each canvas, a drawing for each, and a name that is cut | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "on the home, with a card for each canvas, a drawing for each, and a name that is cut" |
| On the home, with nothing to show | `rmq-home`, `rmq-home-notices`, `rmq-toast-host` | `e2e/canvases-a11y.spec.ts` · "on the home, with nothing to show" |
| On the home, with a search that matches no canvas | `rmq-home`, `rmq-home-notices` | `e2e/canvases-a11y.spec.ts` · "on the home, with a search that matches no canvas" |
| On the home, sorted by name with a search that matches some | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "on the home, sorted by name with a search that matches some" |
| On the home, with more canvases than a page of cards holds, and the button that shows more | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "on the home, with more canvases than a page of cards holds, and the button that shows more" |
| On the home, scrolled to its foot: the disclaimer and the links to the source, the decisions and the progress | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "on the home, scrolled to its foot: the disclaimer and the links to the source, the decisions and the progress" |
| On the home, with a canvas that cannot be opened beside the ones that can | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "on the home, with a canvas that cannot be opened beside the ones that can" |
| On the home, with the reminder to make a backup and how much room the canvases take | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "on the home, with the reminder to make a backup and how much room the canvases take" |
| On the home, with the warning that the room is nearly gone and that the browser did not promise to keep the canvases | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "on the home, with the warning that the room is nearly gone and that the browser did not promise to keep the canvases" |
| On the home, with the warning that almost no room is left | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "on the home, with the warning that almost no room is left" |
| On the home, when the browser keeps nothing | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "on the home, when the browser keeps nothing" |
| On the home, with the problem that a backup could not be made | `rmq-home`, `rmq-home-notices`, `rmq-toast-host` | `e2e/canvases-a11y.spec.ts` · "on the home, with the problem that a backup could not be made" |

### Dialogs and notices of the canvases

| State | Components | Axe test, both themes |
|---|---|---|
| With a notice that offers to take a delete back | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-thumbnail`, `rmq-toast-host` | `e2e/canvases-a11y.spec.ts` · "with a notice that offers to take a delete back" |
| With a notice whose Undo did not work, and says why | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-thumbnail`, `rmq-toast-host` | `e2e/canvases-a11y.spec.ts` · "with a notice whose Undo did not work, and says why" |
| With the dialog that asks for a name | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-name-dialog`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "with the dialog that asks for a name" |
| With the dialog that asks for a name, and says why the name cannot be used | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-name-dialog`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "with the dialog that asks for a name, and says why the name cannot be used" |
| With the question before a canvas is deleted | `rmq-canvas-card`, `rmq-confirm-dialog`, `rmq-home`, `rmq-home-notices`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "with the question before a canvas is deleted" |
| With the question before every canvas is deleted | `rmq-canvas-card`, `rmq-delete-all-dialog`, `rmq-home`, `rmq-home-notices`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "with the question before every canvas is deleted" |
| With the question before every canvas is deleted, after a backup was saved | `rmq-canvas-card`, `rmq-delete-all-dialog`, `rmq-home`, `rmq-home-notices`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "with the question before every canvas is deleted, after a backup was saved" |
| With the question before every canvas is deleted, when the backup that it offers could not be made | `rmq-delete-all-dialog`, `rmq-home`, `rmq-home-notices`, `rmq-toast-host` | `e2e/canvases-a11y.spec.ts` · "with the question before every canvas is deleted, when the backup that it offers could not be made" |
| With the dialog that says why a file could not be opened | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-message-dialog`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "with the dialog that says why a file could not be opened" |
| With the report of a backup that was put back, and what could not be | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-restore-dialog`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "with the report of a backup that was put back, and what could not be" |
| With the report of a backup that was put back, and more that could not be than the report lists | `rmq-canvas-card`, `rmq-home`, `rmq-home-notices`, `rmq-restore-dialog`, `rmq-thumbnail` | `e2e/canvases-a11y.spec.ts` · "with the report of a backup that was put back, and more that could not be than the report lists" |
| In the editor, with the notice after a clear | `rmq-how-to-link`, `rmq-toast-host` | `e2e/canvases-a11y.spec.ts` · "in the editor, with the notice after a clear" |
| In the editor, with the warning that the room is nearly gone and the note that the browser did not promise to keep the canvases | `rmq-help`, `rmq-how-to-link`, `rmq-queue-messages` | `e2e/canvases-a11y.spec.ts` · "in the editor, with the warning that the room is nearly gone and the note that the browser did not promise to keep the canvases" |
| In the editor, with the note that a canvas saved in this browser could not be opened | `rmq-how-to-link` | `e2e/canvases-a11y.spec.ts` · "in the editor, with the note that a canvas saved in this browser could not be opened" |

### The editor and its panels

| State | Components | Axe test, both themes |
|---|---|---|
| With nothing selected | — | `e2e/editor-a11y.spec.ts` · "with nothing selected" |
| With a producer selected | `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer` | `e2e/editor-a11y.spec.ts` · "with a producer selected" |
| With an exchange selected | `rmq-help` | `e2e/editor-a11y.spec.ts` · "with an exchange selected" |
| With an internal exchange selected | `rmq-help` | `e2e/editor-a11y.spec.ts` · "with an internal exchange selected" |
| With a queue selected | `rmq-help`, `rmq-queue-messages` | `e2e/editor-a11y.spec.ts` · "with a queue selected" |
| With a consumer selected | `rmq-consumer-settings`, `rmq-help`, `rmq-number-field` | `e2e/editor-a11y.spec.ts` · "with a consumer selected" |
| With an edge selected | `rmq-help` | `e2e/editor-a11y.spec.ts` · "with an edge selected" |
| With a link from a producer selected, and the button that changes its target | — | `e2e/editor-a11y.spec.ts` · "with a link from a producer selected, and the button that changes its target" |
| With a subscription selected | — | `e2e/editor-a11y.spec.ts` · "with a subscription selected" |
| With the implicit binding of the default exchange selected | — | `e2e/editor-a11y.spec.ts` · "with the implicit binding of the default exchange selected" |
| With everything selected | — | `e2e/editor-a11y.spec.ts` · "with everything selected" |
| With a refusal shown under the durable switch | `rmq-help`, `rmq-queue-messages`, `rmq-refusal-notice` | `e2e/editor-a11y.spec.ts` · "with a refusal shown under the durable switch" |
| With a refusal shown under a name | `rmq-help`, `rmq-queue-messages`, `rmq-refusal-notice` | `e2e/editor-a11y.spec.ts` · "with a refusal shown under a name" |
| With the help of a field open | `rmq-help` | `e2e/editor-a11y.spec.ts` · "with the help of a field open" |
| With the field that renames a node open | `rmq-help`, `rmq-queue-messages`, `rmq-rename-field` | `e2e/editor-a11y.spec.ts` · "with the field that renames a node open" |
| With the field that renames a node open and a name refused | `rmq-help`, `rmq-queue-messages`, `rmq-refusal-notice`, `rmq-rename-field` | `e2e/editor-a11y.spec.ts` · "with the field that renames a node open and a name refused" |
| With the card of a label that has more keys than it shows | `rmq-label-card` | `e2e/editor-a11y.spec.ts` · "with the card of a label that has more keys than it shows" |
| With the default exchange shown and selected | — | `e2e/editor-a11y.spec.ts` · "with the default exchange shown and selected" |

### Linking: popovers, pickers and menus

| State | Components | Axe test, both themes |
|---|---|---|
| With the context menu of a node open | `rmq-context-menu`, `rmq-help`, `rmq-queue-messages` | `e2e/editor-a11y.spec.ts` · "with the context menu of a node open" |
| With the link of a node being chosen from the keyboard | `rmq-help` | `e2e/editor-a11y.spec.ts` · "with the link of a node being chosen from the keyboard" |
| With the picker of "Link to…" open | `rmq-help`, `rmq-link-picker` | `e2e/editor-a11y.spec.ts` · "with the picker of "Link to…" open" |
| With the picker of "Link to…" open and nothing that matches what was typed | `rmq-help`, `rmq-link-picker` | `e2e/editor-a11y.spec.ts` · "with the picker of "Link to…" open and nothing that matches what was typed" |
| With the picker of "Link to…" open and the reason that there is nothing to link to | `rmq-header-rows`, `rmq-help`, `rmq-how-to-link`, `rmq-link-picker`, `rmq-number-field`, `rmq-producer-composer` | `e2e/editor-a11y.spec.ts` · "with the picker of "Link to…" open and the reason that there is nothing to link to" |
| With the key of a binding being asked | `rmq-binding-key`, `rmq-help`, `rmq-topic-tester` | `e2e/editor-a11y.spec.ts` · "with the key of a binding being asked" |
| With the key of a binding refused under its field | `rmq-binding-key`, `rmq-help`, `rmq-refusal-notice`, `rmq-topic-tester` | `e2e/editor-a11y.spec.ts` · "with the key of a binding refused under its field" |
| With the menu of what a link that was let go on nothing can make | `rmq-context-menu`, `rmq-help` | `e2e/editor-a11y.spec.ts` · "with the menu of what a link that was let go on nothing can make" |
| With the topic tester in the popover that asks for a key, inviting one to be typed | `rmq-binding-key`, `rmq-help`, `rmq-how-to-link`, `rmq-topic-tester` | `e2e/explain-a11y.spec.ts` · "with the topic tester in the popover that asks for a key, inviting one to be typed" |
| With the topic tester in the popover listing the keys that a key matches and the keys that it does not | `rmq-binding-key`, `rmq-help`, `rmq-how-to-link`, `rmq-topic-tester` | `e2e/explain-a11y.spec.ts` · "with the topic tester in the popover listing the keys that a key matches and the keys that it does not" |
| With the topic tester in the popover saying that a key cannot be a binding key | `rmq-binding-key`, `rmq-help`, `rmq-how-to-link`, `rmq-topic-tester` | `e2e/explain-a11y.spec.ts` · "with the topic tester in the popover saying that a key cannot be a binding key" |
| With the topic tester and the refusal of the binding together, under the field of the popover | `rmq-binding-key`, `rmq-help`, `rmq-how-to-link`, `rmq-refusal-notice`, `rmq-topic-tester` | `e2e/explain-a11y.spec.ts` · "with the topic tester and the refusal of the binding together, under the field of the popover" |
| With the topic tester under the key field of a binding in the inspector, with keys that match and keys that do not | `rmq-help`, `rmq-topic-tester` | `e2e/explain-a11y.spec.ts` · "with the topic tester under the key field of a binding in the inspector, with keys that match and keys that do not" |

### The command bar and the help

| State | Components | Axe test, both themes |
|---|---|---|
| With the command bar open | — | `e2e/editor-a11y.spec.ts` · "with the command bar open" |
| With the command bar listing what could be typed | — | `e2e/editor-a11y.spec.ts` · "with the command bar listing what could be typed" |
| With a line that the command bar could not read, and what was meant | `rmq-refusal-notice` | `e2e/editor-a11y.spec.ts` · "with a line that the command bar could not read, and what was meant" |
| With a refusal in the command bar, and the broker answer after it | `rmq-refusal-notice` | `e2e/editor-a11y.spec.ts` · "with a refusal in the command bar, and the broker answer after it" |
| With the help of the command bar shown | `rmq-help-view` | `e2e/editor-a11y.spec.ts` · "with the help of the command bar shown" |
| With the cheat-sheet open | `rmq-cheat-sheet` | `e2e/editor-a11y.spec.ts` · "with the cheat-sheet open" |

### The simulation

| State | Components | Axe test, both themes |
|---|---|---|
| The strip, the numbers on the nodes and a message on its way, with the clock stopped | `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer`, `rmq-why-card` | `e2e/simulation-screen.spec.ts` · "has no axe violations for the strip, the numbers on the nodes and a message on its way" |
| The strip while the clock runs, with a message on its way | `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer` | `e2e/simulation-screen.spec.ts` · "has no axe violations for the strip while the clock runs, with a message on its way" |
| The inspector of a queue that holds messages, of a producer and of a consumer | `rmq-consumer-settings`, `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer`, `rmq-queue-asked`, `rmq-queue-messages`, `rmq-queue-why`, `rmq-why-card` | `e2e/simulation-screen.spec.ts` · "has no axe violations for the inspector of a queue that holds messages, of a producer and of a consumer" |
| A producer that is linked to nothing, saying under its button why it cannot publish | `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer`, `rmq-refusal-notice` | `e2e/simulation-screen.spec.ts` · "has no axe violations while a producer that is linked to nothing says under its button why it cannot publish" |
| A queue that holds more messages than its node and its inspector draw, and a consumer that may hold more than its node draws | `rmq-consumer-settings`, `rmq-help`, `rmq-number-field`, `rmq-queue-asked`, `rmq-queue-messages`, `rmq-queue-why`, `rmq-why-card` | `e2e/simulation-screen.spec.ts` · "has no axe violations for a queue that holds more messages than its node and its inspector draw, and a consumer that may hold more than its node draws" |
| A field that says why it was refused, and the cheat-sheet that lists the keys | `rmq-cheat-sheet`, `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer`, `rmq-refusal-notice` | `e2e/simulation-screen.spec.ts` · "has no axe violations while a field says why it was refused, and while the cheat-sheet lists the keys" |

### The explanation

| State | Components | Axe test, both themes |
|---|---|---|
| With the event log open and nothing in it | `rmq-event-log-panel` | `e2e/explain-a11y.spec.ts` · "with the event log open and nothing in it" |
| With the event log open and a few events in it | `rmq-event-log-panel`, `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with the event log open and a few events in it" |
| With the event log full, and the note of what it dropped | `rmq-event-log-panel`, `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer` | `e2e/explain-a11y.spec.ts` · "with the event log full, and the note of what it dropped" |
| With the event log filtered to one kind of event | `rmq-event-log-panel`, `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with the event log filtered to one kind of event" |
| With the event log filtered to nothing | `rmq-event-log-panel`, `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer` | `e2e/explain-a11y.spec.ts` · "with the event log filtered to nothing" |
| With a row of the event log chosen, and what it is about lit on the canvas | `rmq-bind-from-message`, `rmq-event-log-panel`, `rmq-header-rows`, `rmq-help`, `rmq-message-inspector`, `rmq-number-field`, `rmq-producer-composer`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with a row of the event log chosen, and what it is about lit on the canvas" |
| With the Why? of a message on the canvas, a binding that missed and its reason on its label | `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with the Why? of a message on the canvas, a binding that missed and its reason on its label" |
| With the Why? of a message on the canvas, after a queue that it was about was deleted, and the note of how many parts of it are gone | `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with the Why? of a message on the canvas, after a queue that it was about was deleted, and the note of how many parts of it are gone" |
| With the Why? of a message on the canvas and the event log open beside it | `rmq-event-log-panel`, `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with the Why? of a message on the canvas and the event log open beside it" |
| With a message open, its route laid out word by word, and the queue that did not get it | `rmq-bind-from-message`, `rmq-event-log-panel`, `rmq-header-rows`, `rmq-help`, `rmq-message-inspector`, `rmq-number-field`, `rmq-producer-composer`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with a message open, its route laid out word by word, and the queue that did not get it" |
| With a message open, and the conditions of a headers binding, each held or not | `rmq-bind-from-message`, `rmq-event-log-panel`, `rmq-header-rows`, `rmq-help`, `rmq-message-inspector`, `rmq-number-field`, `rmq-producer-composer`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with a message open, and the conditions of a headers binding, each held or not" |
| With a message open, and the reasons that a queue did not get it | `rmq-bind-from-message`, `rmq-event-log-panel`, `rmq-header-rows`, `rmq-help`, `rmq-message-inspector`, `rmq-number-field`, `rmq-producer-composer`, `rmq-queue-why`, `rmq-reason-list`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with a message open, and the reasons that a queue did not get it" |
| With a message that has not got to the broker open, and what would happen to it | `rmq-bind-from-message`, `rmq-event-log-panel`, `rmq-header-rows`, `rmq-help`, `rmq-message-inspector`, `rmq-number-field`, `rmq-producer-composer`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with a message that has not got to the broker open, and what would happen to it" |
| With a message open that the broker refused, because the exchange it was sent to was deleted on the way, and what the broker replied | `rmq-bind-from-message`, `rmq-event-log-panel`, `rmq-header-rows`, `rmq-help`, `rmq-message-inspector`, `rmq-number-field`, `rmq-producer-composer`, `rmq-route-tree`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with a message open that the broker refused, because the exchange it was sent to was deleted on the way, and what the broker replied" |
| With a message open that the log does not keep any more, and the sentence that says so | `rmq-event-log-panel`, `rmq-header-rows`, `rmq-help`, `rmq-message-inspector`, `rmq-number-field`, `rmq-producer-composer`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with a message open that the log does not keep any more, and the sentence that says so" |
| With a message open and a queue selected, whose inspector says why it did not get the message | `rmq-bind-from-message`, `rmq-event-log-panel`, `rmq-help`, `rmq-message-inspector`, `rmq-queue-asked`, `rmq-queue-messages`, `rmq-queue-why`, `rmq-reason-list`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with a message open and a queue selected, whose inspector says why it did not get the message" |
| With the messages of a queue as buttons, and one of them open | `rmq-bind-from-message`, `rmq-help`, `rmq-message-inspector`, `rmq-queue-asked`, `rmq-queue-messages`, `rmq-queue-why`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with the messages of a queue as buttons, and one of them open" |
| With a queue that did not get the message asked about | `rmq-help`, `rmq-queue-asked`, `rmq-queue-messages`, `rmq-queue-why`, `rmq-reason-list`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with a queue that did not get the message asked about" |
| With the what-if tester shut | — | `e2e/explain-a11y.spec.ts` · "with the what-if tester shut" |
| With the what-if tester open and nothing written in it | `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with the what-if tester open and nothing written in it" |
| With the what-if tester saying which queue would get a message, the canvas lit and its card in it | `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with the what-if tester saying which queue would get a message, the canvas lit and its card in it" |
| With the what-if tester saying that no queue would get the message | `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with the what-if tester saying that no queue would get the message" |
| With the what-if tester and the route of its answer open | `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with the what-if tester and the route of its answer open" |
| With the what-if tester saying that a message cannot be read | `rmq-refusal-notice` | `e2e/explain-a11y.spec.ts` · "with the what-if tester saying that a message cannot be read" |
| With the what-if tester answering a message with headers, and the route of a headers exchange open | `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with the what-if tester answering a message with headers, and the route of a headers exchange open" |
| With the what-if tester answering, and the event log open beside it, with the simulation on | `rmq-event-log-panel`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/explain-a11y.spec.ts` · "with the what-if tester answering, and the event log open beside it, with the simulation on" |

### Headers

| State | Components | Axe test, both themes |
|---|---|---|
| With the popover that asks for conditions, empty | `rmq-binding-conditions`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-segmented` | `e2e/headers-a11y.spec.ts` · "with the popover that asks for conditions, empty" |
| With the popover and a row of each type, the mode all-with-x and the sentence of what it asks | `rmq-binding-conditions`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-segmented` | `e2e/headers-a11y.spec.ts` · "with the popover and a row of each type, the mode all-with-x and the sentence of what it asks" |
| With the popover saying what is wrong with its rows: a value that is missing, a name that is there twice, and x-match as a name | `rmq-binding-conditions`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-segmented` | `e2e/headers-a11y.spec.ts` · "with the popover saying what is wrong with its rows: a value that is missing, a name that is there twice, and x-match as a name" |
| With the popover refusing a type that the text cannot have, under its row | `rmq-binding-conditions`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-segmented` | `e2e/headers-a11y.spec.ts` · "with the popover refusing a type that the text cannot have, under its row" |
| With the popover telling that an x- name is not counted and what the lint says of it | `rmq-binding-conditions`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-segmented` | `e2e/headers-a11y.spec.ts` · "with the popover telling that an x- name is not counted and what the lint says of it" |
| With the editor of a binding in the inspector | `rmq-binding-conditions`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-segmented` | `e2e/headers-a11y.spec.ts` · "with the editor of a binding in the inspector" |
| With the editor of a binding in the inspector, changed and not applied, and what is wrong with it | `rmq-binding-conditions`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-segmented` | `e2e/headers-a11y.spec.ts` · "with the editor of a binding in the inspector, changed and not applied, and what is wrong with it" |
| With the editor of a binding whose key is not read by a headers exchange, and says so | `rmq-binding-conditions`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-segmented` | `e2e/headers-a11y.spec.ts` · "with the editor of a binding whose key is not read by a headers exchange, and says so" |
| With a binding that matches no message: the badge on its label, and the warning in the inspector and in its editor | `rmq-binding-conditions`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-segmented` | `e2e/headers-a11y.spec.ts` · "with a binding that matches no message: the badge on its label, and the warning in the inspector and in its editor" |
| With the inspector of a binding that has header arguments which a direct exchange does not read, and the note that says so | `rmq-help` | `e2e/headers-a11y.spec.ts` · "with the inspector of a binding that has header arguments which a direct exchange does not read, and the note that says so" |
| With the editors of the two bindings of an edge, one above the other | `rmq-binding-conditions`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-segmented` | `e2e/headers-a11y.spec.ts` · "with the editors of the two bindings of an edge, one above the other" |
| With the chips of two bindings on the canvas, which go on to more lines, and one that is not counted | — | `e2e/headers-a11y.spec.ts` · "with the chips of two bindings on the canvas, which go on to more lines, and one that is not counted" |
| With the card of a chip, listing every condition, while the pointer is over its label | `rmq-label-card` | `e2e/headers-a11y.spec.ts` · "with the card of a chip, listing every condition, while the pointer is over its label" |
| With the table of the headers of a producer, and the note under its routing key | `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer` | `e2e/headers-a11y.spec.ts` · "with the table of the headers of a producer, and the note under its routing key" |
| With the table of the headers of a producer saying what is wrong with two of its rows | `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer` | `e2e/headers-a11y.spec.ts` · "with the table of the headers of a producer saying what is wrong with two of its rows" |
| With the table of recent messages in the editor of a binding, with no message yet | `rmq-binding-conditions`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-segmented` | `e2e/headers-a11y.spec.ts` · "with the table of recent messages in the editor of a binding, with no message yet" |
| With the table of recent messages in the editor of a binding, a message that holds and one that differs | `rmq-binding-conditions`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-segmented`, `rmq-why-card` | `e2e/headers-a11y.spec.ts` · "with the table of recent messages in the editor of a binding, a message that holds and one that differs" |
| With the table of recent messages in the popover that asks for conditions | `rmq-bind-from-message`, `rmq-binding-conditions`, `rmq-event-log-panel`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-message-inspector`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-segmented`, `rmq-why-card` | `e2e/headers-a11y.spec.ts` · "with the table of recent messages in the popover that asks for conditions" |
| With "Bind from this message" open, the headers of the message ticked and the line that it makes | `rmq-bind-from-message`, `rmq-event-log-panel`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-message-inspector`, `rmq-number-field`, `rmq-producer-composer`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-segmented`, `rmq-why-card` | `e2e/headers-a11y.spec.ts` · "with "Bind from this message" open, the headers of the message ticked and the line that it makes" |
| With "Bind from this message" open and an x- header and x-match among the headers | `rmq-bind-from-message`, `rmq-event-log-panel`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-message-inspector`, `rmq-number-field`, `rmq-producer-composer`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-segmented`, `rmq-why-card` | `e2e/headers-a11y.spec.ts` · "with "Bind from this message" open and an x- header and x-match among the headers" |
| With "Bind from this message" open for a message that was published to an exchange that does not read headers | `rmq-bind-from-message`, `rmq-event-log-panel`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-message-inspector`, `rmq-number-field`, `rmq-producer-composer`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-segmented`, `rmq-why-card` | `e2e/headers-a11y.spec.ts` · "with "Bind from this message" open for a message that was published to an exchange that does not read headers" |
| With "Bind from this message" open and the warning of a binding that would match no message | `rmq-bind-from-message`, `rmq-event-log-panel`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-message-inspector`, `rmq-number-field`, `rmq-producer-composer`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-segmented`, `rmq-why-card` | `e2e/headers-a11y.spec.ts` · "with "Bind from this message" open and the warning of a binding that would match no message" |
| With "Bind from this message" open for a message that has no headers | `rmq-bind-from-message`, `rmq-event-log-panel`, `rmq-header-rows`, `rmq-help`, `rmq-message-inspector`, `rmq-number-field`, `rmq-producer-composer`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/headers-a11y.spec.ts` · "with "Bind from this message" open for a message that has no headers" |
| With "Bind from this message" open on a canvas that has no headers exchange | `rmq-bind-from-message`, `rmq-event-log-panel`, `rmq-header-rows`, `rmq-help`, `rmq-message-inspector`, `rmq-number-field`, `rmq-producer-composer`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-why-card` | `e2e/headers-a11y.spec.ts` · "with "Bind from this message" open on a canvas that has no headers exchange" |
| With the binding that "Bind from this message" made selected, and its editor in the inspector | `rmq-bind-from-message`, `rmq-binding-conditions`, `rmq-event-log-panel`, `rmq-header-rows`, `rmq-headers-live`, `rmq-help`, `rmq-message-inspector`, `rmq-route-exchange`, `rmq-route-tree`, `rmq-segmented`, `rmq-why-card` | `e2e/headers-a11y.spec.ts` · "with the binding that "Bind from this message" made selected, and its editor in the inspector" |

### Sharing and export

| State | Components | Axe test, both themes |
|---|---|---|
| The panel that makes a link, with the link made | `rmq-share-panel` | `e2e/share-a11y.spec.ts` · "has no axe violations with the link made" |
| The panel with the choice of messages: without, with, and switched off for want of messages | `rmq-header-rows`, `rmq-help`, `rmq-number-field`, `rmq-producer-composer`, `rmq-share-panel`, `rmq-why-card` | `e2e/share-a11y.spec.ts` · "has no axe violations with the choice of messages, either way, and with the choice switched off" |
| The panel with a link too long to send, and the file offered instead | `rmq-share-panel` | `e2e/share-a11y.spec.ts` · "has no axe violations with a link too long to send, and the file offered instead" |
| The panel with the notice that the link was copied | `rmq-share-panel` | `e2e/share-a11y.spec.ts` · "has no axe violations with the notice that the link was copied" |
| The panel with the notice that the browser did not let the page copy the link | `rmq-share-panel` | `e2e/share-a11y.spec.ts` · "has no axe violations with the notice that the browser did not let the page copy the link, which is selected instead" |
| The panel when the browser cannot make a link, with the file offered instead | `rmq-share-panel` | `e2e/share-a11y.spec.ts` · "has no axe violations when the browser cannot make a link, and says so, with the file offered instead" |
| The dialog that exports for a broker, with what it leaves out listed | `rmq-export-dialog` | `e2e/share-a11y.spec.ts` · "has no axe violations with what it leaves out listed" |
| The same dialog with everything in the file, and with a virtual host that cannot be one | `rmq-export-dialog` | `e2e/share-a11y.spec.ts` · "has no axe violations with everything in the file, and with a virtual host that cannot be one" |
| The same dialog when there is nothing to put in a file | `rmq-export-dialog`, `rmq-how-to-link` | `e2e/share-a11y.spec.ts` · "has no axe violations when there is nothing to put in a file" |
| The page that a link opens, with its banner | `rmq-shared-view` | `e2e/share-a11y.spec.ts` · "has no axe violations" |
| The same page with the problem of a copy that cannot be kept | `rmq-shared-view` | `e2e/share-a11y.spec.ts` · "has no axe violations with the problem of a copy that cannot be kept" |
| The page of a link that cannot be opened | `rmq-link-failed` | `e2e/share-a11y.spec.ts` · "the page of a link that cannot be opened has no axe violations" |

### The tour

| State | Components | Axe test, both themes |
|---|---|---|
| The tour at its first step, and at the step that lists the five ways to link | `rmq-help`, `rmq-queue-messages`, `rmq-tour` | `e2e/onboarding-a11y.spec.ts` · "the tour has no axe violations at its first step, nor at the step that lists the ways to link" |
| The tour with a step that is done and waits for Next, and at each step from the third to the last, with Finish | `rmq-help`, `rmq-queue-messages`, `rmq-tour` | `e2e/onboarding-a11y.spec.ts` · "the tour has no axe violations with a step that is done and waits to be moved on, and at each step after the one that lists the ways to link, to the last" |

### What no axe state holds

Parts of screens that no browser test can hold still, or reach, with the reason. Each is held by the unit test of its component, and each is made of components that axe looks at in the rows above. They were found by listing every `data-testid` of the templates of the app and asking which were on the screen, with a box, when axe ran.

| Part (`data-testid`) | Where | Why no axe state holds it |
|---|---|---|
| `opening-canvases` | `rmq-workspace` | A status line for the few tens of milliseconds that the browser takes to open the database of canvases. A browser test cannot hold it still without replacing the database. The unit test of the workspace holds its words and its role. |
| `opening-shared` | `rmq-shared-view` | The same, while the canvas of a link is put in memory. |
| `share-making` | `rmq-share-panel` | "Making the link…", while the link is compressed: milliseconds. The unit test holds the link back to see the panel. |
| `shared-notice` | `rmq-shared-view` | The notice that the messages of a link could not be put back. A link whose messages do not fit its canvas is refused whole by the reader of links (ADR-0077), so the engine is never given messages that it refuses, and a link cannot reach the notice. It is the second guard, held by the unit test of the shared view. |
| `conditions-problem`, `composer-headers-count` | `rmq-binding-conditions`, `rmq-producer-composer` | More than a hundred conditions or headers, which is the limit of the document, typed row by row. They are drawn with `rmq-refusal-notice`, which axe looks at in ten states. |
| `conditions-refusal`, `composer-headers-problem`, `bind-refusal` | `rmq-binding-conditions`, `rmq-producer-composer`, `rmq-bind-from-message` | A refusal of arguments that the editor accepted and the command layer did not. The editor checks the same rules before it asks, so nothing typed in the browser makes them disagree. They are drawn with `rmq-refusal-notice`. |
| `open-file`, `restore-file` | `rmq-home` | The hidden fields behind the buttons "Open a file…" and "Restore a backup…". The buttons are in every state of the home. |

## WCAG 2.2 AA: the criteria that matter here

These are the criteria that the editor can fail, and where each is met, or why it is exempt. The others of level A and AA are in the rules that axe runs, or are about things that the app does not have (time limits, media, forms that submit, authentication).

| Criterion | Where it is met, or why it is exempt |
|---|---|
| 1.4.3 Contrast (Minimum) | The colours are tokens in `styles.css`, one pair for each theme. `tools/theme/tokens.spec.ts` computes 4.5:1 for every text and its background that the editor draws, in both themes, and axe's `color-contrast` reads the rendered page in every state above. The messages on the canvas are drawn on a `<canvas>`, which axe cannot read: they are graphics (3:1, the same unit test), and everything they say is text elsewhere, in the log, the numbers under the nodes and the card of Why?. |
| 1.4.10 Reflow | The welcome and the home reflow at 320 pixels. The canvas, and the editor around it, are a diagram with tools, which the criterion lets keep two dimensions (the editor is 208 pixels wider than a window of 320).<br>`e2e/smoke.spec.ts` · "has no horizontal scrolling at 320 px wide in the welcome and on the home" |
| 1.4.11 Non-text Contrast | Borders, the focus ring, the handles and the lines that Why? lights are held to 3:1 by `tools/theme/tokens.spec.ts`, in both themes. Colour is never the only sign: what Why? lights has words on the labels and a legend (ADR-0062), and a message has a shape and a number as well as a colour (ADR-0055). |
| 2.1.1 Keyboard | Everything that has a pointer has a keyboard: the toolbox is a toolbar of the arrow keys, the canvas has a keyboard model for selecting, moving, linking and renaming (ADR-0017), and the command bar types every command. The journey is done on a page that throws on a pointer.<br>`e2e/keyboard-only.spec.ts` · "creates, links with L and the arrows, binds, publishes with P, steps" |
| 2.1.4 Character Key Shortcuts | The single keys (`L`, `M`, `P`, `E`, `/`, `?`, `.`, Space) act when the canvas has the cursor, and do nothing in a text field: the test types them into the name field and the command bar and sees that only text is the result.<br>`e2e/keyboard-only.spec.ts` · "does nothing for a single key in a text field" |
| 2.4.7 Focus Visible | `:focus-visible` in `styles.css` is an outline of 2 pixels in `--rmq-focus`, held to 3:1 on the page, on the canvas and on the fill of every kind of node by `tools/theme/tokens.spec.ts`. That a ring is drawn is looked at in the manual pass; no machine sees it. |
| 2.4.11 Focus Not Obscured (Minimum) | Nothing that stays on the screen is drawn over the canvas (ADR-0085). What the learner opens at a point (the popovers, the menus, the picker) takes the cursor, is put inside the canvas and the window, and goes with Escape.<br>`e2e/focus-not-obscured.spec.ts` · "has no node covered by the card of Why? of the message that was routed last, with the event log open" |
| 2.5.7 Dragging Movements | Every drag has a way that needs none: a click adds from the toolbox, a link is made with `L` and the arrows, with the picker "Link to…" of the inspector or of the menu, or with the command bar, and a node is moved with `M` and the arrows (ADR-0017, ADR-0041). The picker is one of the ways.<br>`e2e/linking.spec.ts` · "by "Link to…" in the inspector, which lists the targets that the rules allow" |
| 2.5.8 Target Size (Minimum) | 24 by 24 pixels. The controls are axe's `target-size`, in every state above; the handles of the nodes and the shapes of the messages are measured. Below 100% zoom of the canvas the handles are scaled with everything else: that is the learner's own zoom, and every drag has a way that does not depend on it.<br>`e2e/targets.spec.ts` · "are 24 by 24 pixels at the scale of 100%"<br>`projects/app/src/app/canvas/overlay/overlay.spec.ts` · "a press on a shape" |
| 4.1.3 Status Messages | What was done is said once, politely, in one live region (`body > [role="status"][aria-live="polite"]`), and written in the status line. A refusal is said once, assertively, by the command bus, and written beside the field that made it, which is not a live region itself, so that it is not heard twice; the notices are not live regions either (ADR-0074). Axe does not test live regions: steps 4, 6, 7, 11, 12 and 13 of the manual pass do. |

## The manual pass with a screen reader

Machines cannot tell whether a screen reader says something a person can use. This pass is for a person, once for each release, with **NVDA on Windows** (Firefox or Chrome) and/or **VoiceOver on macOS** (Safari). One of the two is enough for the release; the other is welcome. It takes about 40 minutes.

**Where it stands.** This pass does not block `v0.1.0` ([ADR-0090](adr/0090-the-manual-screen-reader-pass-does-not-block-v0-1-0-and-is-tracked-in-issue-20.md)); it is tracked in [#20](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/20). Post the table there.

**Before you start**

- Use the deployed site (<https://rafaeljcamara.github.io/RabbitMqPlayground/>) in a window of a normal size, in a private window so that it is a first run. Note the version of the screen reader, of the browser and of the system.
- NVDA: speech on, "Speak typed characters" on, browse mode on its default. VoiceOver: Safari, VoiceOver Utility at its defaults, quick nav off while you use the canvas.
- The canvas is an application region: the screen reader's own reading keys stop there, and the arrow keys are the canvas's. If a step says "leave the canvas", press Tab or Shift+Tab.
- Do not use the mouse. If a step cannot be done without it, that is the finding.

**How to record it.** For each step write *pass*, or *fail* with what was said and what should have been. A step that fails is a bug: open an issue with the step number, the screen reader and the words. Post the table in a comment on [#14](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/14).

| # | Do | Expect to hear (the words may differ a little; the meaning must not) | Fails if |
|---|---|---|---|
| 1 | Open the site. | A dialog: "Welcome to RabbitMQ Playground", with the six tutorials as a list of buttons, "Take the tour (about a minute)" and "Build from scratch". The cursor is on the first control. | The dialog is not announced, or the page behind it is read. |
| 2 | Tab through the dialog, then press Escape. | Tab stays inside it. Escape closes it and you land on a canvas called "Untitled canvas". | The cursor leaves the dialog, or is lost after Escape. |
| 3 | Find the heading level 1, the navigation "Open canvases" and the regions "Editor tools", "Toolbox", "Canvas", "Inspector" (use the landmarks list of the screen reader). | One heading, "RabbitMQ Playground". Each region once, with its name. | A region has no name, or two have the same name. |
| 4 | Tab to the toolbox. Press Enter on "Producer", ArrowDown to "Direct exchange" and Enter, ArrowDown to "Queue" and Enter, ArrowDown to "Consumer" and Enter. | Each button is a button with its name. After each, the status line and the live region say it ("Added producer producer1."). | A press says nothing, or the added node is not said. |
| 5 | Tab to the canvas. | "Canvas", and how to use it: the arrow keys move between nodes and connections, M picks up the selection, L links the selected node, Delete removes, F2 renames, Control and Z undoes. | The canvas has no instructions. |
| 6 | ArrowLeft until "Producer producer1". Press L. | "Linking from producer producer1. The arrow keys choose a target, Enter links, Escape cancels.", and then "Target 1 of 2: exchange exchange1, direct, 1 warning" (or the same in other words). | No announcement, or a count that is wrong. |
| 7 | Press Enter. | The link is made and said ("Linked producer producer1 to exchange exchange1"). | Nothing is said. |
| 8 | Go to the exchange, press L, ArrowRight to the queue, Enter. | A popover "Binding key from exchange exchange1 to queue queue1" with the cursor in a field called "Binding key" and a sentence that says what a key is. | The field has no name, or the sentence is not read with it. |
| 9 | Type `eu`, press Enter. | The binding is made and said. The cursor is back on the canvas. | The popover stays, or the cursor is lost. |
| 10 | Go to the queue, L, Enter to link the consumer. | "Target 1 of 1: consumer consumer1", and then the link is said. | The consumer is not offered. |
| 11 | Go to the producer. Press Space (pause), then P. | "Paused." and then "Published 1 message from producer1." | A key does nothing silently. |
| 12 | Press the full stop to step. | What happened is said ("Stepped: …"). Press it again until the consumer has the message. | Nothing is said for a step. |
| 13 | Press E. | "Event log shown." and a region "Event log" with rows. Arrow keys move through the rows; each row is read with its time and its words. | The rows are not reachable, or are read as clutter. |
| 14 | On a row of the log, press Enter. | The message inspector opens, with the route in words. A card "Why?" is read as a sentence. | The route is only a picture. |
| 15 | Press Escape, then ? | A dialog "Keyboard shortcuts and commands" with tables. Tab stays in it; Escape closes it and gives the cursor back. | The tables have no headers, or Escape loses the cursor. |
| 16 | Press / and type `help`, Enter. | The command bar opens with the cursor in "Command". The help is read as a region. Escape closes it. | The result of a command is not said. |
| 17 | Go to the producer and press Enter. In the inspector, type `lmpe.?` in the name field. | The letters are typed. No link starts, nothing is sent, nothing moves. | A single key does something while you type. |
| 18 | Select a node and press Control+M (Command+M on a Mac), then an arrow key. | The node is not picked up: the arrow moves the cursor to another node. | The node moves. |
| 19 | Tab to "My canvases" and press Enter. | The home: a list of canvas cards, each with its name, when it was edited and what is on it. A search field with a name. | A card is read without its name. |
| 20 | On the home press the button "New from a template…" and choose "Hello World". | A dialog that is read with its choices, and then a notice that says what to try. | The notice is not read. |
| 21 | Open the Share button of the editor. | A dialog "Share “Untitled canvas”" (with the name of the canvas), with the warning that anyone who has the link can read the whole canvas, the choice of what to share, the link in a read-only field and "Copy link". | The warning is not read before the link. |
| 22 | Open the link in a second private window. | A banner that says it is a shared canvas that is not kept, "Save a copy to my canvases" and "Leave". The editor works as before. | The banner is not read first. |
| 23 | Switch the theme (the control "Theme" in the top bar) to dark and back. | The choice is said. Nothing else changes in what is read. | The control has no name. |

**What counts as done.** All 23 steps pass with at least one of the two screen readers, and each failed step has an issue that is closed or an ADR that says why it stays. Write the screen reader, its version, the browser and the date under the table.

# ADR-0076: What building S9 settled: the notices are in the flow, the strip is the banner, a view is said aloud, and a tab can be renamed

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md) (the order and the landmarks of the workspace, what a tab does, what `create` takes),
  [ADR-0074](0074-delete-clear-and-delete-all-ask-once-and-can-be-taken-back-with-an-undo-that-says-how-long-it-lasts.md) (where the notices are), and
  [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md) (what the reminder counts from), for what building S9
  ([#11](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/11)) and trying it in a browser showed that they had left to the code or had got wrong.

## Context

ADR-0072 to ADR-0075 settled, before S9 was built, how the workspace, the home, the deletes and the files work. Building it, and writing for each of them the journeys that a person would do, showed two decisions that did not survive a browser (where the notices are, and the landmarks of the
page), one gap that no sighted test sees (nothing told a screen reader that the view had changed), and a few choices that the ADRs left to the code and that are worth writing down because the first one that was tried was not always the one that is there.

## Decision

### The notices are in the flow of the page, under the view

ADR-0074 put the region of the notices "at the bottom of the screen", and ADR-0072 listed it between the strip and the view. It was first built as it was read: fixed to the bottom left corner, over the page. In a browser, a click on **Delete** on the last card of the home was caught by the
notices that the deletes before it had made, which were over the button. A learner who deletes canvases one after another could not reach the button of the last one, and no unit spec can see that, because jsdom does not lay anything out.

- **The region "Notices" is the last of the three things in the column of the workspace**: the strip, the view, and under the view the notices. It is a strip across the bottom of the workspace, **in the flow**, so it takes room from the view above it, which is what is left, and it covers
  nothing. This replaces the order in ADR-0072 and the corner in ADR-0074.
- It is still one region named "Notices" that is there only while there is a notice, it is still not a live region (the announcer says each notice, once, ADR-0074), its buttons are still reached by Tab, and up to three notices are in it, the newest last.
- A notice that comes makes the view shorter by its height while it is there. That was preferred to a notice that hides a button: the home scrolls, and the canvas of the editor fits what is left.

### In a workspace the strip is the banner, and the tools of the editor are a region

With the strip of open canvases in a `header` and the top bar of the editor in another, the first run of axe on the workspace found two banner landmarks (`landmark-no-duplicate-banner`, `landmark-unique`). Making the top bar a plain group instead put its buttons outside every landmark (`region`).
Both of them are things a screen reader user meets as soon as the page opens.

- **The strip is the one banner**, and holds the one `h1`, the name of the product (ADR-0072). The top bar of the editor is inside a `section` named **Editor tools**, which is a region, and a `header` inside a `section` is not a banner.
- Without the workspace nothing is different: the top bar is the banner and has the `h1`, as S8 left it. Both are held by unit specs and by the axe journeys of the workspace, which run with nothing switched off in the light theme and the dark one.

### A view is said aloud, and the cursor does not fall when a tab closes

There is no route and no change of the address (ADR-0072), so nothing told a person who uses a screen reader that the page had changed when a tab was chosen or closed.

- **The library says it, politely and through the announcer (ADR-0031)**: "Showing My canvases." or "Showing “Orders”.", when the view changes. Showing what is shown changes nothing and says nothing. The first view, which is chosen when the page starts, is not said: the page has just been loaded, and a screen reader says the page.
- **Closing a tab puts the cursor on the item of the strip that is shown now**, because the button that had it has gone with the tab and the cursor would have fallen to the top of the page. It is put after the next render, since the item that is shown may be a new one.
- The other acts say what they did in the same way, once and politely: "Made “Untitled canvas 2”.", "Renamed to “Orders”.", "Made “Orders (copy)”, a copy of “Orders”.", "“Orders” is back." after an Undo, and the opening of a file.

### A tab can be renamed, and `create` takes a name and a document

The issue asks for "tabs; new canvas, rename, duplicate". ADR-0072 gave rename to the card of the home only.

- **A double click on a tab, or F2 when it has the cursor**, opens the dialog that asks for a name, the same dialog as the card's (ADR-0073), with the name selected. F2 is the key that renames a node in the editor. The tab says so in its `title` and in `aria-keyshortcuts`, so that a learner who has not
  been told is told by the page. The button of the home is not a canvas and does nothing for either.
- **`create` takes `{ name?, document? }`.** Without them it makes the blank "Untitled canvas" (or the first "Untitled canvas 2" and so on that nobody has), as before. With a document it makes a canvas from it, and that is the one door by which the templates of S11
  ([#13](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/13)) will make a canvas: they need no code of their own in the library. Creating a canvas from a template is therefore not in S9, and the checklist of #11 says so.
- **Save as file is on the card of the home and not on the tab.** The file of a canvas is something a learner does from "My canvases", with the other things that leave the browser (open a file, restore a backup, back up everything), and a second place would be a second thing to keep the same.

### The reminder counts from the oldest canvas that has something on it

ADR-0075 says that when there has never been a backup the 14 days are counted "since the oldest canvas was made". The first run of the app makes a blank "Untitled canvas", so a learner who opened the page once a month ago and has just started to build would have been told today that they never
backed up, for a canvas with nothing in it. Now the 14 days are counted from the oldest canvas **that has at least one element**; if none has, nothing is due. After a backup, it is due 14 days later only when some canvas was edited since, as before.

### Two details of the notices and the files

- **Escape on a notice is heard on the document**, by the host, when the cursor is inside a notice. A `div` that handles a key without taking the cursor is what the lint rule `interactive-supports-focus` refuses, and the notice is not a thing to be tabbed to: its buttons are.
- **The file fields are emptied after each choice**, so that the same file can be chosen again after it was refused: a field that still holds the file does not say `change` for it the second time. The dialog that says why a file could not be opened starts with the cursor on OK.

### How it was measured

The home with three hundred canvases of seven elements each is in `e2e/performance.spec.ts`: the first 48 cards and their drawings are there 399 ms after the click on "My canvases", and a search, clearing it and a change of the sort take 126 ms, against the budget of three seconds of the big canvas
(ADR-0036). Reading the canvases once and keeping a summary of each and not its document, with the drawing as data (ADR-0073), is what keeps it there.

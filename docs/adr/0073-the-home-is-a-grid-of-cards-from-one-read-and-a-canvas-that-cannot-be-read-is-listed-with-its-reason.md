# ADR-0073: The home is a grid of cards from one read, and a canvas that cannot be read is listed with its reason

- **Status:** Accepted. "The name and the thumbnail are not the button" is superseded by [ADR-0095](0095-a-press-on-the-drawing-of-a-card-opens-the-canvas-and-a-double-click-on-its-name-renames-it.md) (the drawing opens the canvas and a double click on the name renames it), the rest stands.
- **Date:** 2026-10-08
- **Deciders:** @RafaelJCamara
- **Extends:** "UI (M1)" of [ADR-0012](0012-multiple-canvases-and-local-persistence.md), `list()` of [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md), and the arrangement of [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md).
  It settles question 10 of `OPEN_QUESTIONS.md` ("what do the home screen, the backup and 'delete all' do with a canvas that cannot be read?").

## Context

ADR-0012 asks for "a grid of thumbnails showing each canvas's name, when it was last edited and how many elements it has, with search and sort", and for the actions open, rename, duplicate, share, export and delete on each. S3 built `list()`, which answers the canvases that can be read, newest first, and apart from them the ones
that cannot (their id, their name if the record still has one, and why). What a screen does with those was left to S9 (question 10), and so were the sizes of the thing: how a thumbnail is drawn, how many cards are drawn, what search matches and how the order is decided when two canvases are equal.

## Decision

### One read, and a summary of each canvas

- The home asks the library, which reads the repository once when the home is shown and again after anything that changes the list (a new canvas, a rename, a delete and its Undo, an import). It does not poll, and it does not read while an editor is being used.
- **The library keeps a summary of each canvas and not its document**: id, name, `createdAt`, `updatedAt`, the number of elements and of edges (`elementCount` and `edgeCount` of the domain), and the thumbnail as data. A thousand documents in memory for a screen that shows their names is not what a screen needs. What needs the document (a duplicate, a file, opening it)
  asks the repository for that one canvas.

### The thumbnail is drawn from the layout, as data

- `thumbnailOf(document)` is a pure function of the document. It gives a box (`x`, `y`, `width`, `height` in canvas units, with a margin) that holds every node that has a position, the nodes (a kind, a position), and the edges (the ends of the line between the centres of two nodes). The card draws them in one SVG with that box as its `viewBox`, so there is no scaling to
  get wrong: a node is drawn at its own size, with the outline of its kind (`shapePath`, so that a thumbnail has the shapes of the canvas and colour is not the only sign), and a line is `vector-effect: non-scaling-stroke`. A canvas with nothing on it has no box, and the card says "Empty".
- **At most 150 nodes and 300 edges are drawn.** The first 150 nodes in the order of the document (exchanges, queues, producers, consumers) and the edges between those, up to 300. The card still says the true count in words. A thumbnail of a canvas that is 2,000 elements is a sketch of it, and a thousand of them would otherwise be 300,000 shapes on one page.
- **It is decoration**: `aria-hidden`, with no text. Everything it says is in the words of the card (the name, when it was edited, how many elements).
- Colours are the tokens of the canvas (`--rmq-exchange`, `--rmq-exchange-fill` and the others), so a thumbnail follows the theme with no code.

### The card

A card is a `li` of a list named "Canvases". It has, in this order:

1. the thumbnail;
2. the name as a heading (level 3, under the section heading "Canvases"), and below it **"Edited 3 hours ago"** as a `time` with the exact time as its `datetime` and its title, and **"12 elements"**;
3. a button **Open**, whose name includes the canvas's name (`Open Orders`), which opens the canvas in a tab of the strip and shows it (ADR-0072). The name and the thumbnail are not the button: a click on them selects nothing, so that a learner who reads the card does not open it;
4. the other actions as buttons with an icon and a name in words: **Rename**, **Duplicate**, **Save as file** and **Delete**, each named with the canvas (`Rename Orders`). **Share** (ADR-0013) is S10's, and the card is built so that it can take another button.

"Edited" counts from `updatedAt`, which the repository sets when a document is saved and not when a canvas is restored from a tombstone (ADR-0028). The words are made by a function of two times (`ago`): "just now" under a minute, "N minutes ago", "N hours ago", "yesterday", "N days ago" up to a week, and then the date. The clock is injected, so that a
spec does not wait.

### Search and sort

- **Search** is a text field named "Search canvases" that filters by name as the learner types: the text is trimmed, folded (case and accents do not matter) and matched anywhere in the name. An empty field shows all. The result is said in a live region ("3 of 12 canvases", or "No canvas has 'xyz' in its name") without moving the focus.
- **Sort** is a select named "Sort by": **Last edited** (newest first, the default), **Created** (newest first), **Name** (A to Z, numbers as numbers, the same on every machine), and **Size** (most elements first). A tie is broken by the name and then by the id, so that the order is the same every time and a card does not jump when something else changes.
- **The grid shows 48 cards and a button "Show more"** that adds 48. Search and sort cover all of them; only the drawing is paged. A learner with a thousand canvases (the cap of a backup) is not asked to draw a thousand cards on opening the home.
- The search and the sort are not kept: they are choices of the moment, and the home opens as it opens for everybody.

### The home's other parts

In this order, under the heading **My canvases**: the actions of the whole library (**New canvas**, **Open a file…**, **Restore a backup…**, **Back up everything**, **Delete all…**), the notices (the reminder to make a backup, ADR-0075; the promise of the browser and the room that is left, ADR-0075), the search and the sort, the list of
cards, and the section for canvases that cannot be read. When there is no canvas, it says "You have no canvases yet." with **New canvas** and **Open a file…**, and that the library of a first run is made when the app opens.

### Canvases that cannot be read (question 10)

- **The home lists them apart**, in a section **Canvases that could not be opened** that is there only when there is at least one. Each is a row: its name if the record still has one, and else its id; the **reason**, which is the message of S3 (root cause first, and, for a canvas that a newer version saved, to reload to get the newest version); and one action, **Delete**. There is no Open, because the
  app cannot, and no Rename. A learner who reads "reload the page to get the newest version" has been told what to do, and nothing has been changed.
- **"Delete all" counts them and says so.** The dialog says how many canvases it will delete, and that "N of them cannot be opened by this version of the app, so a backup cannot hold them" when any cannot. It does not leave them out: the learner asked for everything to go, the tombstones back an Undo for 60 seconds (ADR-0074), and a canvas that is left behind and unreachable
  is what this question was asking not to produce.
- **A backup holds the canvases that can be read, and says how many were left out.** After the file is saved, the notice says "Backed up 7 canvases. 2 could not be opened and are not in the file." It does not carry the record of a canvas as it is, so that a newer version of the app could read it later: that needs `list()` to give the raw record, which it does not, and a backup that holds
  what its own version cannot read has a format that a reader cannot vouch for (ADR-0027 refuses a file that is not whole). Nothing is lost by leaving them out: they stay in the browser until the learner deletes them. It is written in "Decisions taken in S9 that are easy to revisit".
- **The editor's status line** keeps its sentence about how many canvases could not be opened (S4), with the flag off. With the flag on the home has the section, and the status line does not repeat it.

### Where the focus goes

After a delete or a rename the card that was there may not be, so the focus goes to the next card's **Open** button, or to the search field when the list is empty. After "Show more" it stays on the button, which becomes the first of the new cards if there are no more to show. Nothing moves the focus without an action of the learner.

## Consequences

### Positive

- The home reads the repository once and draws from small summaries, so the cost of a screen is the cost of the read, which ADR-0028 already accepted ("a few milliseconds each").
- A thumbnail is data, so a unit test can say what it holds (a box that holds every node, no more than the cap, the shapes of the kinds) with no browser, and the browser only has to check that it is drawn.
- Question 10 is answered without a change to `list()` or to the formats: the section, the count in the dialog and the sentence of the backup.
- The order is a total order, so a spec and a learner see the same list.

### Negative / trade-offs

- A thumbnail of a very large canvas is a sketch, and one of a canvas whose nodes have no position (a document that a file or a command script made without a layout) is empty or partial. The `layout` of the document is a position for each element by id; a document that came from commands has them (ADR-0026), and a file that has none is an unusual case.
- A card's actions are five buttons, which on a narrow screen take two lines. A menu would take one, and put four of them one more key away; every action stays a button that Tab reaches.
- Paging by 48 means that a search that matches nothing on the first page and something on the second is still right (it covers all), but "Show more" can show a page that has few cards left. It is the plain behaviour of a paged list.
- A canvas that cannot be read cannot be exported or looked at. A learner who wants what a newer version wrote has to reload the page for the newest version, which the message says.

## Alternatives considered

- **A virtual-scroll grid** (the CDK's). Rejected: it takes items of one size in one column, and a grid of cards that wrap with the width of the window is not that; the paging is a button, which a keyboard reaches and a screen reader announces.
- **A thumbnail made by rendering the canvas to an image** and keeping the picture. Rejected: it needs the editor, the browser's `canvas` and a place to keep the picture, and it goes stale on every edit. A drawing from the layout is cheap, always current and testable.
- **Keep every record in memory for the home.** Rejected, see above.
- **Hide the canvases that cannot be read.** Rejected: a learner would have a database that holds something they cannot see or delete, which is the opposite of the home's purpose.
- **Put the raw record of an unreadable canvas in the backup.** Rejected for now, see above. It can be done by a later change of `list()` and of the backup format together.

## Related

- [ADR-0012](0012-multiple-canvases-and-local-persistence.md), [ADR-0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md), [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md), [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md).
- [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md), [ADR-0074](0074-delete-clear-and-delete-all-ask-once-and-can-be-taken-back-with-an-undo-that-says-how-long-it-lasts.md),
  [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md).
- `OPEN_QUESTIONS.md`, question 10.

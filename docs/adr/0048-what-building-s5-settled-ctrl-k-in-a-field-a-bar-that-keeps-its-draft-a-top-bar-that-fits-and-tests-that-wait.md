# ADR-0048: What building S5 settled: Ctrl+K in a field, a bar that keeps its draft, a top bar that fits, and tests that wait

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md) (text fields keep their keys), [ADR-0036](0036-the-test-strategy-of-the-editor.md) (what the tests wait for),
  [ADR-0045](0045-the-command-bar-a-panel-that-types-through-the-same-door.md), [ADR-0046](0046-the-equivalent-command-log-and-the-tests-that-hold-gestures-and-commands-together.md) and
  [ADR-0047](0047-guidance-the-hint-bar-the-how-to-link-card-and-the-cheat-sheet.md), for what S5 ([#7](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/7)) found when it built what they decided.

## Context

ADR-0041 to 0047 were written before the code. Building and testing it showed where they were silent, and where one thing in them did not survive the screen it was drawn on. None of these changes what a link, a command or the log is. They are
the small decisions that the tests had to make, written here so that the next slice does not make them again.

## Decision

### The keys and the bar

- **Ctrl/Cmd+K works in a field of text.** ADR-0035 leaves every key of a text field to the field, and ADR-0045 says that Ctrl/Cmd+K opens the bar "anywhere in the editor", and a learner who is typing a name in the inspector is in the editor. A row of the
  table of shortcuts may say `inFields`, and the service then takes it from a field too. Only a chord with Ctrl, Cmd or Alt may say so, because anything else is typed there, and only one that the field has no use for: Ctrl+Z is not one, as ADR-0035 says. A spec holds
  both. Without the exception the browser took the key for its address bar.
- **The bar keeps what was typed when it is closed**, and a refusal and a list go with it. Escape by mistake must not lose a long line, and the line that was refused is what the learner is mending.
- **A refusal of the bar is shown in the bar, beside the field that made it, and not again on the status line**, as one of the inspector is ([ADR-0031](0031-the-editors-state-the-command-bus-and-where-ids-come-from.md)). The bus still says it aloud, once, assertively.
  Typing takes the refusal away, because it is about the line that was typed. Help stays while the next line is typed, because it is about the command that is being typed.
- **Cursor keys shut the list**, and a click in the field does too. The list is for what is being typed, so it opens when the learner types and not when the cursor moves over a word that could be completed.
- **Taking an item goes on to the next word**, so Tab again takes what comes next: `bi`, Tab, Tab, Tab is `bind orders -> `. After a line from the history the list stays shut, as ADR-0045 says.
- **The domain exports `wordText`**, which it had, so that a name that was probably meant is written where the words at fault were the way the grammar reads it (`"my queue"`). It is the one change to the domain that S5 needed after `help`, and it changes no behaviour.
- **The place of a dragged label is kept to a thousandth** of the way along the edge. A drag ends at `0.4237594123`, and the log writes the line that would do the same, which a person reads as `at=0.424`. The grammar reads either, so the replay does not need the rounding, and the log does.

### The screen

- **The top bar fits one row at 1280 pixels.** With the switch of the default exchange and the Help button it did not fit when "Saving…" became "All changes saved", and the bar wrapped to a second row, and the canvas jumped 40 pixels under the pointer: a drag that
  had begun missed its node. Help and the theme are icons now (each has its name, as Zoom out has), the buttons are a little tighter, and the saving text keeps its width. The bar is 49 pixels before and after.
- **The card of the first run is a few chips, not a list.** ADR-0047 said "one line each", which was 126 pixels of a window that is 720 tall and left the canvas 418. The card says each way in a few words (`Click the dot, then click the target`) in two lines, 58 pixels, and
  the cheat-sheet has the sentence of each. Both are made from one list, so a way that is added is in both. The card still goes when the first edge is made, and the canvas moves up by its height once, which is the learner's own act.

### The tests

- **A test of the browser is promised that the browser keeps the canvases.** Headless Chromium does not promise, and the app says so in a note under the canvas that comes about 300 ms after the first change and takes 66 pixels from it, so a position that a test
  measured a moment after an add was not where it was a moment later. The promise is given to the prototype of the storage manager, so the tests of that note (`storage.spec.ts`), which put their own on the instance, still win. The shift is the app's, and is in `OPEN_QUESTIONS.md`.
- **The centre of an element is read once it has stopped moving**, as Playwright's own actions wait for. The mouse of a test does not, and it is what aimed at a node that moved a moment later, when the card went. Each typing waits for the cursor to be in its field.
- **The tests of the app have 30 seconds, as the libraries have 60**, for the reason that vitest.config.ts gives: the pre-push hook runs them beside the lint, the build and the coverage. A test that is wrong still fails.
- **The contract suite has what S5 relies on**, and not all that ADR-0046 listed. The keyboard layer that "reaches a connection that the app asked it to skip" is no longer a fact that the app uses, because the implicit edges of the default exchange are selectable
  and read-only. What is there instead: the content of a connection is at a fraction of the length of its line (at 0.25, 0.5 and 0.75), a press on a label does not pan the canvas and one on nothing does, a connector that is disabled starts no link and lights no target, and a finger
  that is dragged from a handle makes a link, and on a node moves it.
- **The replay is a property of the app, and the end-to-end journey is the same claim once.** The property plays what the intents, the link function with a surface that answers from the numbers of the action, the commands of the inspector, the top bar and the bar can do,
  with the links drawn from the pairs that the rules allow (a random pair is almost never one), a drop on nothing that is often given a key that is refused, and sessions of 8 to 60 actions. It runs at the 100 runs of the hook and CI, which finds the two hand mutations
  that it was checked with (ids that a refused batch spent, and an undo that is not logged), at 5,000 runs for each of seven seeds before the push, and in the Nightly job, which now runs the property suites of the app as well as those of the libraries with one seed for both.

## Consequences

### Positive

- A learner can open the command bar from the field that they are typing in, and does not lose a line to a keystroke.
- The top bar and the canvas do not move under a pointer when the save state changes, and the first-run card costs 58 pixels.
- The tests that measure a position wait for it, and the property finds a bug in the ids at the number of runs that the hook has.

### Negative / trade-offs

- A chip of the card says less than a sentence, and a learner who wants the whole of a way has the cheat-sheet.
- Help and the theme are icons: a learner who does not know the sign has the name when it is hovered and read, and the visible word is gone.
- Every test of the browser but those of the note is run with a promise that a visitor's browser may not make, so the note is tested alone.

## Alternatives considered

- **Ctrl/Cmd+K left to the field.** Rejected: the browser has it, and it would not be a shortcut of the editor where a learner types most.
- **A card that collapses to a line.** Rejected for now: a card that has to be opened is one that a first-run learner does not open. S11's tour may replace it.
- **Moving the switch of the default exchange out of the top bar.** Rejected: ADR-0043 puts it there, and the bar fits without moving it.
- **Retrying the tests that raced.** Never: ADR-0015. Each was a test that measured or typed before the page was ready, and each now waits for what it needs.

## Related

- [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md), [ADR-0036](0036-the-test-strategy-of-the-editor.md),
  [ADR-0043](0043-the-default-exchange-is-shown-on-request-and-is-not-in-the-document.md), [ADR-0045](0045-the-command-bar-a-panel-that-types-through-the-same-door.md),
  [ADR-0046](0046-the-equivalent-command-log-and-the-tests-that-hold-gestures-and-commands-together.md), [ADR-0047](0047-guidance-the-hint-bar-the-how-to-link-card-and-the-cheat-sheet.md).
- [`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md): the note that moves the canvas.

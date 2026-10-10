# ADR-0102: The file pickers take only JSON files, by name and type, and refuse anything else before they read it

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md) (opening a canvas file and putting back a backup, and the file that is not read when it is too big) and [ADR-0078](0078-a-link-is-made-from-the-canvas-as-it-is-a-shared-canvas-opens-in-an-editor-that-keeps-nothing-and-its-text-is-only-text-under-a-policy.md) (what comes in from outside is data, shown as text, under a policy). Nothing is superseded.

## Context

- The two pickers of the home (Open a file, Restore a backup) have `accept=".json,application/json"`. That only filters what the picker shows: a learner can switch the picker to "All files", and a file that was dragged or made by a script is not filtered at all. A file of any kind could be given to the app, and the app read all of it before it said that it was not JSON.
- The request: "we should only allow JSON format, as this is the format our app supports. We need to avoid people misusing our app and maybe importing things that are malicious, like scripts."
- What already protects the app is listed here, because it is the reason that a refusal by kind is a second wall and not the only one: a file over 200 MB is not read (ADR-0075); the text is parsed only as JSON (`JSON.parse`, never evaluated); the parsed value must pass a strict `zod` schema; every string from a file is drawn as text, never as markup (ADR-0078); and the page has `script-src 'self'` (ADR-0078), so a script that came in as text could not run in any case.

## Decision

- **A file is checked for its kind before anything is read: `isJsonFile`/`refusedKind` in `canvases/file-kind.ts`.** The name must end in `.json` (in any case), so `canvas.rmq.json` and `Backup.JSON` pass, and `canvas.js`, `page.html`, `canvas.json.exe` and `canvas` do not. The type that the browser gives must be empty, `application/json`, `text/json`, or a `+json` type (`application/vnd.api+json`), with any `;` parameters ignored and in any case. A file named `x.json` with the type `text/html` is refused, since the browser says that it is not JSON.
- **An empty type is accepted**, because browsers often report a `.json` file with no type, and the name has then said what it is.
- **The check is made in the one place that both pickers read through (`CanvasLibrary.textOf`), before the size and before `file.text()`.** A refused file is never read: the specs hold a spy on `text` and ask that it was not called, so that the page does not hold the bytes of a file that it will not use. The refusal is an `Outcome` failure that goes through the dialogs that the home already has for a file that could not be opened or put back, in words: "“canvas.js” is not a JSON file. This app opens only the JSON files it saves: a canvas (.rmq.json) or a backup."
- **`accept=".json,application/json"` stays on both inputs.** It keeps the picker useful (it shows the right files first); the check above is what enforces the kind.
- **The protections above are not changed.** The size cap, the JSON-only parse, the strict schema, the text-only drawing and the policy stay as they were.

## Consequences

### Positive

- A script, a page, an executable or an archive that is chosen by mistake or on purpose is refused at once, in words, with nothing read and nothing changed.
- The refusal is the same for open and for restore, and tested for both, and in the browser with a real canvas under the name `canvas.js`.

### Negative / trade-offs

- **The check trusts the name and the type that the browser gives.** A file that is named `x.json` and is not JSON passes the first wall and is refused by the second (the parse says "This is not JSON"); a file that is JSON and is named `x.txt` is refused though it would have opened. A learner who has a backup under another name has to rename it. `OPEN_QUESTIONS.md` has it.
- A file with the type `application/octet-stream` and a `.json` name is refused. Some systems do give that type to unknown files; if it comes up, the list of types is one function.

## Alternatives considered

- **Look at the first bytes** (`{`) as well. It would read a little of a file that is refused by kind, and the parse already refuses it with a better message.
- **Only the extension.** A file that says it is `text/html` would pass. The type costs nothing to ask.
- **Remove the pickers' `accept`.** It helps the learner, and nothing depends on its absence.

## Related

- [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md), [ADR-0078](0078-a-link-is-made-from-the-canvas-as-it-is-a-shared-canvas-opens-in-an-editor-that-keeps-nothing-and-its-text-is-only-text-under-a-policy.md).
- Tests: `projects/app/src/app/canvases/file-kind.spec.ts`, `library.spec.ts` ("opening a file", "putting a backup back"), `e2e/canvases-files.spec.ts`.

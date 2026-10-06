# ADR-0037: The editor's keys are heard on the document, and the browser's refusal is made at its API

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md) (where its one listener stands) and
  [ADR-0036](0036-the-test-strategy-of-the-editor.md) (how the quota is tested), for what building them in S4
  ([#6](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/6)) showed.

## Context

Two statements of the ADRs of this slice were written before the code that they describe, and the code showed that each was not enough.

1. **ADR-0035 puts the one keyboard listener on the root of the editor.** When the control that has the focus is switched off, the focus
   falls on the page itself, which is outside that root. The Undo button is such a control: it has nothing left to undo after the last
   undo, so it is disabled, and it was in the focus. Ctrl+Y and Ctrl+Shift+Z then did nothing, until the learner clicked something.
   An end-to-end test of undo followed by redo found it.
2. **ADR-0036 tests the quota with `Storage.overrideQuotaForOrigin` of the DevTools protocol.** It was tried first, in the Chromium that
   Playwright 1.63 installs, headless and full, and it does not do what the test needs:
   - `Storage.getUsageAndQuota` reports the quota that was set, and `navigator.storage.estimate()`, which is what the app reads, does not;
   - a write of a canvas into IndexedDB succeeds with a quota of 50 KB, with the usage above it, because a canvas is a plain value and
     is not checked against the quota. Only a `Blob` in IndexedDB, and the Cache API, throw `QuotaExceededError` when the quota is
     overridden.

   So the override cannot make the app's own write fail, nor change the estimate that the app warns from.

## Decision

- **The editor hears keys on the document, in the bubble phase, and takes a key only when its target is in the editor or is the page
  itself**, which is where the focus goes when nothing has it. A key that goes to anything else on the page is not the editor's.
  Everything else in ADR-0035 holds: the table, one handler for the rules, the library having its turn first (its listener is on the
  canvas, below the document), and the scopes. The Escape of the inspector and of the field for a name are still their own.
- **The browser's refusal is made where the browser makes it: at its API.** The end-to-end test puts, before the app starts, a wrapper
  on `IDBObjectStore.prototype.put` that throws the `DOMException` named `QuotaExceededError` while a flag of the test is set, and one on
  `navigator.storage.estimate` and `persist` that say what the test has chosen. The app, the database and the browser are real, and so is
  everything that the learner sees and hears. If a later Chromium checks small values against the override, the test may go back to the
  protocol.
- **A warning about room is polite right after a write has failed**, so that the sentence that says that the canvas was not saved is
  not taken from the learner by the warning that follows it. The failure is assertive and the warning is not.

## Consequences

### Positive

- Undo and redo work from the keyboard however the focus got to the page, which includes after a button that switched itself off.
- The quota is tested with a refusal of the kind that the browser makes, in a real browser, and the learner's whole path is covered: the top
  bar, the aloud message, the warning, the work that is still on the page, and saving again.

### Negative / trade-offs

- The refusal is simulated, so the test is only as true as the error that it throws. It throws the one that the persistence layer
  recognises by name and code, which is what the browsers give.
- A listener on the document hears every key press of the page while the editor is open. It answers at once for a key that is not the
  editor's, and the editor is the whole page for now.

## Alternatives considered

- **Keep the listener on the root, and put the focus back there** whenever a control is switched off. Rejected: every control that
  can switch itself off would have to know, and one that forgot would make the keys stop.
- **Make the root focusable and focus it.** Rejected for the same reason, and it would draw a focus ring on a container.
- **Fill the origin's storage until the browser refuses.** Rejected: the quota is gigabytes, and a test that writes them is slow and
  hurts the machine.
- **Use blobs for the canvas, so that the override applies.** Rejected: it would change how canvases are kept so that a test could work.

## Related

- [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md), [ADR-0035](0035-the-keyboard-service-scope-modifiers-and-text-fields.md),
  [ADR-0036](0036-the-test-strategy-of-the-editor.md).

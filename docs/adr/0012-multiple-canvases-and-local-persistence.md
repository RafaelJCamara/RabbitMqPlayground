# ADR-0012: Multiple canvases and local persistence

- **Status:** Accepted. The record, the files and the loader that "Storage" and "Files" need are settled by
  [ADR-0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md), and the repository, the
  tombstones and the autosave by
  [ADR-0028](0028-the-canvas-repository-autosave-and-what-the-browser-may-do.md). The screens, the strip of open canvases, the home, the delete and the clear, and the files and the reminder are settled by [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md), [ADR-0073](0073-the-home-is-a-grid-of-cards-from-one-read-and-a-canvas-that-cannot-be-read-is-listed-with-its-reason.md), [ADR-0074](0074-delete-clear-and-delete-all-ask-once-and-can-be-taken-back-with-an-undo-that-says-how-long-it-lasts.md) and [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md).
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

The product owner requires that users can:

- create **multiple canvases**;
- **delete one**;
- **clean all**: both clearing a canvas and deleting every canvas.

The original had no way to save locally. Users asked for "save to and load from a file, without RabbitMQ installed"
([#13](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/13)). There is no backend
([ADR-0006](0006-client-only-app-dotnet-api-when-needed.md)), so everything has to persist in the browser.

## Decision

### The canvas

A canvas is the unit of work. It contains:

- an `id`, a `name`, and `createdAt` / `updatedAt` timestamps;
- the topology and layout, and its settings;
- optionally, a runtime snapshot;
- a `schemaVersion` and a `rabbitmqBaseline` ([ADR-0008](0008-rabbitmq-fidelity-baseline.md)).

### UI (M1)

- **Tabs** for the open canvases, with **+ New canvas** (blank, or from a template).
- **"My canvases" home.** A grid of thumbnails showing each canvas's name, when it was last edited and how many
  elements it has, with search and sort.
- **Per-canvas actions.** Open, rename, duplicate, share ([ADR-0013](0013-self-contained-share-links.md)), export, and
  **delete**. Delete asks for confirmation, then shows an **Undo** toast.
- **Clear canvas.** Removes every element but keeps the canvas. It can be undone, and is also available as the `clear`
  command.
- **Delete all canvases.**
  - A confirmation dialog states how many canvases will be deleted and offers **"Export a backup first"**.
  - After deleting, an **Undo** toast appears briefly.
- **Backup.** Export all canvases to one file, and import it again.

### Storage

- Canvases are stored in **IndexedDB**, behind a small repository interface so storage can be replaced in tests.
- Every command autosaves, with a debounce.
- The app asks for persistent storage (`navigator.storage.persist()`) and warns when storage is nearly full.

### Files

- A canvas can be saved and loaded as **native JSON**. A backup bundle holds all canvases.
- **Schema.** Files are versioned and validated, with **ordered migrations** for every version change.
  A file from a newer version than the app understands is refused with a clear message, never half-loaded.

### Multiple browser tabs (M2)

- If the same canvas is open in two browser tabs, this is detected through `BroadcastChannel`. The user is warned and
  offered a reload, so one tab never silently overwrites the other.

## Consequences

### Positive

- Users can run several scenarios side by side, and nothing is lost when the tab closes.
- Data stays private and is available offline. The original's request #13 is met.

### Negative / trade-offs

- Data is tied to one browser profile on one device. Backups, files and share links make it portable.
- Browsers can evict storage. We mitigate this with the persistence request and with backups, and offer a backup
  before "delete all".
- Every schema change needs a migration and a migration test
  ([ADR-0015](0015-testing-strategy-and-definition-of-done.md)).

## Alternatives considered

- **`localStorage`.** Rejected: its size limit (~5 MB) and synchronous API are too restrictive.
- **Server-side storage.** Rejected for v1 ([ADR-0006](0006-client-only-app-dotnet-api-when-needed.md)).
- **A single canvas.** Rejected by the product owner's requirements.

## Related

- [ADR-0013](0013-self-contained-share-links.md): sharing a specific canvas.
- [ADR-0014](0014-broker-interop-via-definitions-json.md): `definitions.json` import and export.

# ADR-0013: Self-contained share links

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

Users must be able to **create a link that shares a specific canvas** with someone. The product owner chose links that
are **self-contained**: no server, and nothing stored. In the original simulator, loading a configuration from a URL
was a popular request that was never merged
([PR #11](https://github.com/RabbitMQSimulator/RabbitMQSimulator/pull/11)).

## Decision

### Creating a link (M1)

- **Where.** Share is available from the canvas toolbar, the canvas's menu in "My canvases", and the `share` command.
  It opens a panel with a **Copy link** button.
- **What it holds.** The link contains a compressed **snapshot** of that one canvas, placed in the **URL fragment**:
  `<app-url>/#c=<payload>`.
  - The fragment is never sent to any server, so it never appears in hosting logs.
  - The exact route is settled when it is implemented.
- **Encoding.**
  - A format version prefix (`v1.`), followed by the canvas as canonical JSON, deflated, then base64url-encoded.
  - The version prefix leaves room for future formats.
  - The engine stores typed header values, which are preserved ([ADR-0009](0009-headers-exchange-support.md)).
- **Snapshot behaviour.** The sender's later edits don't change a link that has already been shared.
- **Options.** Share the **topology only** (the default), or include the messages currently queued.

### Opening a link

- The canvas opens in a **"Shared canvas"** view. It can be explored and played, and has a
  **"Save a copy to my canvases"** button.
- The recipient's own canvases are never overwritten, and nothing is saved until they choose to save.

### Limits and security

- **Long links.** Above ~8,000 characters, some chat apps and email clients cut links short. The app warns about this
  and offers **Download file** instead.
- **Untrusted input.** Incoming links are treated as untrusted:
  - the compressed and decoded sizes are capped, which prevents decompression bombs;
  - the content is strictly schema-validated, using the same validator as file import
    ([ADR-0012](0012-multiple-canvases-and-local-persistence.md));
  - payloads and names are rendered **as plain text only**;
  - nothing in a link can execute code or load remote resources.

### Related features

- **QR code** for a share link, for classrooms and talks (M2).
- **`?src=<url>`** loads canvas JSON from a URL the user supplies, if CORS allows it. The same validation applies (M2).
- **Embed mode** reuses this encoding in an iframe snippet, read-only or interactive (M5).

### Later

- **Short links** (`/s/abc123`) through an ASP.NET Core API, only if self-contained links prove too long in practice.
  This needs a new ADR ([ADR-0006](0006-client-only-app-dotnet-api-when-needed.md)).

## Consequences

### Positive

- Works on static hosting with no infrastructure and no privacy concerns. Links work for as long as the app exists.
- One encoding serves share links, embeds and `?src=`.

### Negative / trade-offs

- Big canvases make long links, which is why the app warns and offers a file instead.
- Links can't be revoked or updated after sharing. They are snapshots by design.
- The share-link format becomes a compatibility contract. Old links have to keep opening, through migrations.

## Alternatives considered

- **Short links stored by a .NET API.** Deferred: it needs hosting, storage and abuse handling
  ([ADR-0006](0006-client-only-app-dotnet-api-when-needed.md)).
- **Encoding the canvas in the query string.** Rejected: the query string is sent to the server and logged.
- **Third-party paste services, such as GitHub Gist.** Rejected: they need authentication and an external dependency.

## Related

- [ADR-0012](0012-multiple-canvases-and-local-persistence.md): canvases and the shared validator.
- [ADR-0015](0015-testing-strategy-and-definition-of-done.md): round-trip and malicious-input tests.

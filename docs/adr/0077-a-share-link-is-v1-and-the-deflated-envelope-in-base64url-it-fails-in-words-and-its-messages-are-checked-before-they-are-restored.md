# ADR-0077: A share link is `v1.` and the deflated envelope in base64url, it fails in words, and its messages are checked before they are restored

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0013](0013-self-contained-share-links.md) (self-contained links, the fragment, the limits and the untrusted input), "Share codec" of section 2.5 of the [M1 plan](../plans/m1.md), the envelopes and the one loader of
  [ADR-0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md) ("a share link ends in `loadCanvas`"), and the snapshot of [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md) ("it is why S10 can share a canvas with its messages"), for what S10
  ([#12](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/12)) puts behind the flag `share`. It also answers question 3 of `OPEN_QUESTIONS.md` for links.

## Context

ADR-0013 says that a link holds a compressed snapshot of one canvas in the fragment of the address, starts with a version prefix, is capped on the way in so that a small link cannot become a big canvas, goes through the same validator as a file, and may carry the messages that are queued. The plan gives the
codec: `'v1.' + base64url(deflate-raw(canonical JSON))` on the browser's own `CompressionStream`, 256,000 characters in and 2 MB out, counted while streaming, and the warning above 8,000. What is left to decide is the envelope and its text, what is checked first, the ways a link can fail and what each says, how the
messages of a link are made safe to give to the engine (its `restore` reads the version and trusts the rest), what a link that is longer than it should be does, and how links that exist are kept opening. A link cannot be recalled or changed after it is sent (ADR-0013), so every choice here is a promise.

## Decision

### The link

- **A link is `<base>#c=<payload>`.** `<base>` is the origin and the path of the page that makes it, and nothing of its query: a `?ff=` list is a developer's choice and does not travel. Until the flags are gone (S12) a person who opens a link needs `?ff=editor,share` as well; the panel does not add it.
- **The payload is `v1.` and then the base64url (RFC 4648, section 5, no padding) of the deflate-raw (RFC 1951) of the UTF-8 text of an envelope.** The prefix is the version of the link, and a link of another version is told from a link that is damaged by it. The compression and the decompression are `CompressionStream` and `DecompressionStream` with `deflate-raw`,
  which every browser that runs the app has, and Node has, so the same code runs in the unit specs.

### The envelope

```json
{ "format": "rmq-playground/share", "version": 1, "name": "Orders", "document": { … }, "simulation": { … } }
```

- It is a third kind of envelope next to the canvas file and the backup (ADR-0027), checked by the same function, `checkEnvelope`: the format and the version are asked for first, a link that is a canvas file or a backup says so ("This is the file of one canvas, and not a link…"), and a version that is newer than 1 is a `newer-version` error with `of: 'link'`.
  It is not the canvas file: that reader refuses a key it does not know, a link has a version of its own that nothing but links moves, and only a link has `simulation`.
- **`name` and `document` are what a canvas file has**, and the document goes through `loadCanvas` (migrations, the caps of ADR-0029, the schema, the references), so a link has the same limits and the same errors as a file, and an invalid `x-match` or an integer beyond 2^53 in a link is refused as it is in a file. That is the answer to question 3 for links and
  files: the loader is the importer, the app cannot write either value, and the corpus of malicious links has both, so no scenario is recorded for them.
- **`simulation` is there only when the learner asked for the messages**, and is the engine's snapshot (ADR-0052). See "The messages".
- **The text is compact and its keys come in a fixed order** (`format`, `version`, `name`, `document`, `simulation`). The document is the one `loadCanvas` gives, which has the order of the schema, so one canvas gives one text. The bytes that the compressor makes from a text are the browser's and differ between builds of zlib, so
  nothing compares them: a link is read, and what it holds is compared (see "Links that exist").

### What is checked, and in what order

1. The payload is **at most 256,000 characters**, before anything is decoded (a long text is refused from its length).
2. It starts with **`v1.`**. `v` and a whole number above 1 is a newer link; anything else is not a link of this app.
3. Everything after the prefix is in the **alphabet of base64url** (`A–Z a–z 0–9 - _`). Node and some browsers decode the characters they do not know without a word, so the codec asks for itself. A length that no base64 text has (4n + 1) is damaged.
4. It is **inflated as a stream and stops at 2,000,000 bytes**, counted as the chunks arrive; the rest is not inflated. A bomb of 50 MB of zeros is 48 KB, which is 65,000 characters and under the first cap, so only this one stops it.
5. The bytes are **UTF-8 without a fault**, then **JSON**, then the **envelope**, then the **document** through `loadCanvas`, then the **snapshot** if there is one.

### The ways it fails

A `ShareError` is a value with a `kind` that a program branches on and a message that a person reads, root cause first, ending with what was done ("Nothing was opened and nothing was changed."), as the errors of ADR-0027 are:

| kind | when | what it says |
|---|---|---|
| `not-a-link` | nothing after `#c=`, no `v1.`, characters outside the alphabet | that this is not a link of this app, and what a link starts with |
| `newer-link` | the prefix is `v2.` or more | that it was made by a newer version, which format it is and which this one reads, and to reload the page for the newest |
| `damaged` | an impossible length, an inflate error (a truncated or altered stream), a fault in the UTF-8, JSON that is cut off | that the link is cut short or changed on the way, and that chat apps and mail clients do that to a long link |
| `too-large` | more than 256,000 characters, or more than 2,000,000 bytes inflated | the size and the cap, and that a canvas that big is sent as a file |
| the errors of the loader | the envelope, the document, the snapshot | what ADR-0027 says, with the path of the first problem, and for a newer schema or a newer envelope the same words as a file's |

### Making a link

- `encodeShare({ name, document, simulation? })` answers the payload, or a `ShareError`. It **reads back what it makes**, as `writeCanvasFile` does: the envelope is read by the reader before it is compressed, so the app never makes a link that it would refuse to open, and a text of more than 2,000,000 bytes is `too-large` at the sender, with the sentence
  that a file is the way.
- The panel (ADR-0078) gives the link, its length, and, **above 8,000 characters in the whole link** (`<base>#c=` and the payload), the warning of ADR-0013 and the button that gives the canvas file instead. 8,000 is `SHARE_WARN_AT`.
- A canvas is shared **as it is on the screen**, including what is not saved yet: a link made from a canvas whose change is half a second from the disk would otherwise be older than what the sender sees.

### The messages

- **"With messages" puts the engine's snapshot in the envelope**, and the shared view restores it paused (ADR-0078). The snapshot is the whole of what decides what the engine does next (ADR-0052): the queues with their messages, the consumers' channels, the unacknowledged ones, what is scheduled, the counters and the clock.
- **`engine.restore` reads the version and trusts the rest**, which is right for the snapshot that the engine took itself and wrong for one that came in a link. `readSnapshot(data)` of the engine library is the reader of one from outside, in the style of `snapshotIssue`: it answers the snapshot or the first thing that is wrong with it. It asks for the
  shape and the type of every field, whole numbers where they are counts, times and sequence numbers that do not go backwards, names that are in the topology (a queue of a channel, an exchange of a producer), at most as many entries as the link could hold, and each message once.
- **The snapshot must agree with the document.** A fresh engine is made from the document (`reconcile`, the one path of ADR-0054), and the exchanges, the queues, the bindings and the producers of the snapshot must be the ones that its own snapshot has. A link whose messages belong to another topology is refused, with the sentence that its messages are not
  those of its canvas, because restoring them would give an engine that the document does not describe.
- The reader is also guarded where it is used: the restore in the shared view is inside a `try`, and if it throws the canvas opens without the messages and a notice says so. A link is not trusted twice.

### Links that exist

- **The reader of a link of format 1 does not change.** A new thing is a new prefix (`v2.`) and a reader for both. The schema inside the document moves with the migrations of ADR-0027, which a link goes through like a file.
- **Golden links**: `fixtures/share/v1/` holds links that were made once and are committed, each with the canvas that it must open as (`name` and `document`) and, for one with messages, the engine state it must restore to. A spec decodes each, and fails if one stops opening. The encoder is not compared with them byte for byte.
- **The round trip is a property**: for any canvas that commands can make, any name that the loader accepts and any snapshot that an engine takes, `decodeShare(encodeShare(x))` is `x`.
- **The corpus of malicious links** is a table, each with the kind it must fail as: a bomb, a link cut at several places, a prefix that is not `v1.`, a `v2.`, characters outside the alphabet, bytes that are not UTF-8, JSON that is not an envelope, a canvas file and a backup given as a link, an envelope of a newer version, a document of a newer schema, a document over the caps, an invalid `x-match`, an unsafe
  integer, names that are HTML and script, a snapshot that is over, under, wrong in type, or of another topology.

## Consequences

### Positive

- A link is checked by the same loader as a file, so a limit, a migration or a refusal is written once.
- A hostile link has a table of what it can do, and each row is a test; the codec never inflates more than 2 MB for any input of any size.
- The reader of the snapshot is the engine's, next to the snapshot that it reads, so a change to what a snapshot holds changes its reader and its version in one place.

### Negative / trade-offs

- A link is a copy, not a pointer: it cannot be recalled or changed (ADR-0013), and a person who shares a canvas shares all of it, with the names that are in it.
- The reader of the snapshot is a piece of code that has to follow the engine. A snapshot of version 2 is a link of version 2.
- A canvas of a few hundred elements makes a link of more than 8,000 characters (a hundred exchanges and queues bound in pairs is 4,400), and the person is sent to a file.
- The compressed bytes of one canvas are not the same in every browser, so a link cannot be checked against a text. What it opens as can.
- A link whose messages are wrong is refused whole, though its canvas would have been fine. A person who is sent such a link sees why and can ask for another.

## Alternatives considered

- **The canvas file as the payload.** Rejected: its reader refuses the keys it does not know, and a link would move with the version of a file.
- **A query string** (`?c=`). Rejected in ADR-0013: it is sent to the server and logged.
- **Sorted keys.** Rejected: the order of the records of a document is the order they were made in, which the lists, the thumbnails and the layout show; a canonical form that sorts them changes the canvas that opens.
- **A library for compression** (LZ-string, pako). Rejected: the platform has `CompressionStream`, and the link is a promise about a format that the platform will keep.
- **Trusting the snapshot.** Rejected: `restore` would meet a queue that is not there, or a message twice, and the app would stop with an error that is the link's, not the learner's.
- **Opening the canvas and dropping the messages when they are wrong.** Rejected for the reader, and kept for the restore that fails after the reader said yes: a link that says something it does not hold is refused, and a person is told.

## Related

- [ADR-0013](0013-self-contained-share-links.md), [ADR-0027](0027-a-canvas-is-a-record-a-file-and-a-bundle-and-one-function-loads-them.md), [ADR-0029](0029-the-commands-refuse-at-the-size-caps.md), [ADR-0052](0052-the-engine-commands-in-events-out-one-clock-and-a-view-for-the-screen.md), [ADR-0054](0054-the-runtime-verbs-go-through-the-bus-and-are-in-the-log-and-reconcile-keeps-the-engine-whole.md), [ADR-0078](0078-a-link-is-made-from-the-canvas-as-it-is-a-shared-canvas-opens-in-an-editor-that-keeps-nothing-and-its-text-is-only-text-under-a-policy.md) (the panel, the shared view and
  the security of a link).
- `OPEN_QUESTIONS.md`, question 3.

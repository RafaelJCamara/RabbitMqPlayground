# ADR-0078: A link is made from the canvas as it is, a shared canvas opens in an editor that keeps nothing, and its text is only text under a policy

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0013](0013-self-contained-share-links.md) ("Creating a link", "Opening a link", "Limits and security"), the workspace and the host of the editor's session of
  [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md), and the folders and the flags of [ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md), for the screens and the security of what
  S10 ([#12](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/12)) puts behind `share`. The codec and its errors are [ADR-0077](0077-a-share-link-is-v1-and-the-deflated-envelope-in-base64url-it-fails-in-words-and-its-messages-are-checked-before-they-are-restored.md).

## Context

ADR-0013 says that sharing is available from the toolbar, from the menu of a canvas on the home and from the `share` command, that it opens a panel with a **Copy link** button, that a link opens in a "Shared canvas" view which can be explored and played and has **Save a copy to my canvases**, that the recipient's own
canvases are never written over, that content from a link is plain text, and that nothing in a link can run code or load anything. The plan adds a content security policy with `worker-src blob:` for the worker of the canvas library. What is left to decide is what the panel offers and shows, how a page that is opened with a link
differs from one that is not, how the shared canvas can be played without touching the learner's canvases, what "Save a copy" saves and where the learner is afterwards, and how "plain text" and "nothing can run" are made true by the build and held by a test and not by care.

## Decision

### The flag, and where a link is offered

- **`share` needs `editor`** and does nothing alone, as `canvases` and `headers` do (ADR-0069, ADR-0072). It works with or without `canvases`, and the messages in a link need `simulation` as well.
- **A link is offered in three places that all open the same panel:** a **Share…** button in the top bar of the editor (next to the export of ADR-0079), a **Share…** button on the card of a canvas on the home (it shares the canvas as it is saved), and the command **`share`** (`scope: 'app'`, like `help`, so it is completed and documented, changes nothing,
  and cannot be one of several commands). In a shared canvas the button shares the canvas as it is now.

### The panel

- A modal dialog named "Share “Orders”", with the cursor on the first control. It says what a link is in two sentences: that anyone who has it can read the whole canvas, with every name in it, and that it is a copy, so what is changed later is not in it.
- **What to share** is a group of two radio buttons: **The canvas** (the default) and **The canvas and its N messages**, where N is what the queues hold now. The second is there only with `simulation`, and is switched off, with the reason under it, when nothing is queued: a control that is not available says why (ADR-0068).
- **The link** is in a read-only field that selects itself when it is focused, with **Copy link**. The copy uses the clipboard of the browser, says "Link copied." through the announcer, and, where the clipboard is not allowed, says so and leaves the link selected for the learner to copy with the keys.
- **Its length is said**, quietly ("The link is 1,266 characters long."), and above 8,000 characters (ADR-0077) it becomes a warning in words and in a colour, with the sentence that some chat apps and mail clients cut a long link, and a button **Download file** that gives the canvas file instead (ADR-0075), which a person opens with **Open a file…**. A canvas that is too big for any link (ADR-0077) has the
  file and no link.
- The link is made when the panel opens and again when the choice changes. It is asynchronous (the compression is), so the field says "Making the link…" in a status, and a failure is an alert with the message of the codec.

### Opening a link

- **A page whose address has `#c=` is a shared canvas, when `share` and `editor` are on.** The address is read once, at start, by a service of the root. It has four states: nothing (the page is as it was), **opening** (a status, "Opening the shared canvas…"), **shared** (the view) and **failed**. A link that fails is a page of its own with the message of the codec as an alert, what was
  done ("Nothing was opened and nothing was changed."), and a link, **Go to the playground**, that takes the fragment off the address and loads the page. Without the flag the fragment is ignored.
- **A change of the fragment in a page that is open reloads the page**, so that a link pasted over another one opens as the first thing does and the code that opens a link runs once.
- The shared view is a chunk of its own, like the workspace (ADR-0072), so that a visitor without the flag downloads none of it.

### The shared view

- **It is the editor, over a repository that is only in memory, with a banner.** A component of the folder `share/` provides the things the editor asks for: its own copy of the storage of the page (ADR-0072) over a repository in memory, in which the shared canvas has been put under one id, and a host for the session (the seam of ADR-0072), which says which canvas to open and
  how to make the editor write. The editor, its session, its autosave, its undo and its simulation work as they do anywhere, and write to memory, so nothing the learner does here reaches the canvases in the browser. The status strip says what the session says of a page that works in memory: that nothing is kept after the tab is closed.
- **The banner** is the one banner of the page, as the strip is in a workspace: the name of the product as the one heading, "Shared canvas “Orders”" and what that means in a sentence ("You can look around, change things and play. Nothing here is saved."), and two buttons, **Save a copy to my canvases** and **Leave**.
- **The messages of the link** are given to the editor by a token that the view provides and that the simulation reads when its document first loads: it restores the snapshot (ADR-0077) paused, with the clock where the sender left it. If the restore throws, the canvas opens without the messages and a notice says so.
- The canvas is the learner's to change, because "play" is not only the clock: a learner who wants to see what a binding does adds one.

### Save a copy

- **It saves the canvas as it is on the screen**, with what the learner changed: the editor is made to write, then the document is read from the memory repository and made a new canvas in the learner's own repository, with the name of the link, or the first "Name (shared 2)" and so on that nobody has. It is never written over a canvas of the learner's: the id is new.
- **Afterwards the page is the learner's own again, with the copy open**: the copy is made the canvas that was open last, and is put in the strip when there is one (ADR-0072), the fragment is taken off the address, and the page is loaded. A learner who saved is where they would be if they had made the canvas themselves.
- If the browser cannot keep it (it keeps nothing, or it is full), the banner says why, in the words of the storage, and the learner stays in the view with their work; a copy that could not be made is not pretended.
- **Leave** takes the fragment off and loads the page. It asks nothing: nothing was saved and nothing is lost that the learner did not decide to lose, and the banner has said so from the start.

### Plain text

- **Everything that comes from a link is shown by Angular's text binding.** The names of the canvas, the exchanges, the queues, the producers, the consumers and the messages, the headers and the payloads are `{{ … }}` or attributes that the framework escapes, and nowhere is there an `innerHTML`, a `bypassSecurityTrust…`, an `eval`, a `new Function` or a `document.write`.
- **The linter holds it.** The rules `no-restricted-properties` and `no-restricted-syntax` refuse those names in the code of the app, and the template rule that refuses `[innerHTML]` and `[outerHTML]` is on, with nothing switched off: the next person to write one is told why before it runs.
- **A journey holds it in a browser.** A link whose canvas, elements and messages are named `<img src=x onerror="window.pwned=1">` and `<script>…</script>` is opened: the text is on the screen as it was written, nothing ran (`window.pwned` is not there), and the page makes no request that it was not asked to.

### The content security policy

- **A `<meta http-equiv="Content-Security-Policy">` in the built page**, added by the post-build step (`tools/pages/postbuild.ts`, which already adds `404.html`) and not written in `src/index.html`: the development server runs inline scripts of its own, and the policy that the build makes is made from the page that it built.
  The policy is `default-src 'self'; script-src 'self'` and the hash of each inline script of the built page (the build inlines one, which turns a stylesheet on); `style-src 'self' 'unsafe-inline'` (the components of Angular put their styles in `<style>` elements, and a policy in a `meta` cannot carry the nonce of a request); `img-src 'self' data:`;
  `font-src 'self'`; `connect-src 'self'`; `worker-src 'self' blob:` (the worker of the canvas library); `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`. There is no `unsafe-eval` and no `unsafe-inline` for scripts.
- **A meta policy cannot say** `frame-ancestors`, `report-uri` or `sandbox`. GitHub Pages sends no headers of its own, so these stay unsaid, and the page cannot stop itself from being framed.
- **A journey holds it:** the built page has the policy, the app runs under it (the production build, the journeys, every one of them, with a listener for `securitypolicyviolation` that fails a test that sees one), and a script added to the page by a test is refused. A unit spec holds the generator: the hashes, the order of the directives, and that it refuses a page with an inline script it cannot hash.

## Consequences

### Positive

- A learner can look at, change and play a shared canvas without it touching their own, and takes a copy when they want one.
- The shared view is the editor with two things provided, so it has nothing of its own to keep in step with the editor, and the seam of S9 is what S10 needed.
- "Plain text" and "nothing can run" are rules of the linter, of the build and of a browser test, and not things that someone has to remember.

### Negative / trade-offs

- The editor of a shared canvas autosaves to memory, so its status can say "saved" when nothing is kept; the status strip says that nothing is kept after the tab is closed, and the banner says it first.
- A policy in a `meta` is weaker than a header: it applies from the point in the page where it is read, and cannot frame or report. The hashes of inline scripts have to be made at every build.
- `style-src 'unsafe-inline'` lets a style attribute or element in. A style cannot run code, but it can hide or restyle a page; the policy is for scripts and for loads.
- A learner who changes a shared canvas and presses Leave loses it without asking. The banner says so from the start, and a question every time would be asked of every learner who only looked.

## Alternatives considered

- **Open the shared canvas as a canvas in the learner's list.** Rejected: ADR-0013 says nothing is saved until the learner chooses, and a canvas that is in the list is saved.
- **A read-only view.** Rejected: "play" is why one shares a canvas with messages, and playing is adding a message, pausing, stepping; a read-only editor would not.
- **The policy in `src/index.html`.** Rejected: `ng serve` needs inline scripts, and the hashes of the built page cannot be known in the source.
- **A nonce.** Rejected: a static host cannot make one for each request.
- **Sanitising names.** Rejected: a name is text, and the rule that holds it is that it is only ever shown as text.
- **Asking before Leave.** Rejected, above.

## Related

- [ADR-0013](0013-self-contained-share-links.md), [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md), [ADR-0075](0075-a-canvas-file-opens-as-a-new-canvas-a-backup-is-put-back-without-writing-over-anything-and-the-reminder-asks-after-two-weeks.md) (the file that the panel gives),
  [ADR-0077](0077-a-share-link-is-v1-and-the-deflated-envelope-in-base64url-it-fails-in-words-and-its-messages-are-checked-before-they-are-restored.md), [ADR-0079](0079-the-export-is-a-definitions-file-for-one-vhost-written-with-floats-as-1-0-it-lists-what-it-leaves-out-and-the-nightly-imports-it.md) (the export).

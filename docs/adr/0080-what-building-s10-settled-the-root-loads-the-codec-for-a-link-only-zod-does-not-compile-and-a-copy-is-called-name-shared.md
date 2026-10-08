# ADR-0080: What building S10 settled: the root loads the codec for a link only, zod does not compile, the shared view is in the workspace folder, and a copy is called “Name (shared)”

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0078](0078-a-link-is-made-from-the-canvas-as-it-is-a-shared-canvas-opens-in-an-editor-that-keeps-nothing-and-its-text-is-only-text-under-a-policy.md) (where the shared view is, what a copy is called, how plain text is held, the policy),
  [ADR-0077](0077-a-share-link-is-v1-and-the-deflated-envelope-in-base64url-it-fails-in-words-and-its-messages-are-checked-before-they-are-restored.md) (how a link is opened) and
  [ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md) (what a visitor without the flag downloads), for what building S10
  ([#12](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/12)) and running it in a browser under its own policy showed that those ADRs had got wrong or had left to the code.

## Context

ADR-0077 to ADR-0079 settled the link, the panels, the shared view, the plain text and the policy before S10 was built. Building the app side, and then the end-to-end tests that run every journey of the suite in a browser under the policy, found two things that nothing in the unit specs could see
(what the root of the page pulled in, and what a library did at start-up), one place where an ADR named a folder that the layering of the app does not allow, a name for the copy that the ADR left open, and two claims about the linter that were not true as written.

## Decision

### The root does not import the persistence library, and the budget fails the build

The link in the address is read by a service of the root (ADR-0078), which first imported `decodeShare` from `@rmq/persistence`. That library is one entry point, and with it came the schemas of the document, the engine and zod into the **initial** chunk: it went from **243 kB to 897 kB**
(from 64 kB to 204 kB compressed), so a visitor with no link, and no flags, downloaded the weight of the editor, which ADR-0030 says they must not. Nothing failed: the budget for the initial chunk warned at 500 kB and failed at 1 MB, and the build printed a warning that nobody read until the end-to-end tests ran.

- **The service looks for the prefix of a link itself** (`#c=`) and loads the codec with a dynamic import, by a token (`LINK_DECODER`), when it finds one. Only types are imported from the library by the root. The prefix is written twice, in the persistence library (`shareLink`) and in the root, and a spec holds the two to each other.
  A library with one entry point cannot give the root its key without the rest, and a second entry point is a change of how the libraries are built that S10 did not need.
- **The budget for the initial chunk warns at 300 kB and fails at 350 kB**, in the production build and in the build for the end-to-end tests (it is 247 kB). A change that puts the editor in the root now stops the build of CI, which makes both of these, and not a person who reads a warning. (The development build that the push hook makes has no budgets.)

### Zod does not compile its parsers

The first run of the whole suite under the policy (ADR-0078) failed on every page that loads the editor: `script-src` refused `eval`. Zod tries `new Function('')` once, when it makes its first schema, to see whether it may compile its parsers, and handles the refusal. The browser still reports the refusal, in the console and as a
`securitypolicyviolation`, which is exactly what the check after every test is for. Zod 4 has a setting (`jitless`) that skips the probe.

- **Every schema of the domain is made from one `z` (`domain/src/lib/zod.ts`) that sets `jitless` first.** The schemas of a document and of a snapshot are strict objects, which zod does not compile in any case, so nothing is slower: a canvas of 200 nodes and 500 edges is read in 0.31 ms with the setting and 0.31 ms without.
- It is set in the library and not in the app because the app would have had to import zod in the root to set it, which is the weight of the first decision. A spec holds that it is set, and the end-to-end suite holds that nothing is reported.

### The shared view is in the folder of the workspace

ADR-0078 says that "a component of the folder `share/` provides the things the editor asks for". The layering of the app (ADR-0030, the rules of the linter) has `share/` below `editor/`, because the editor opens the panels, so a component of `share/` cannot import the editor, and the shared view is the editor with a banner.

- **The shared view is in `canvases/`**, beside the workspace that it is the counterpart of: `SharedCanvas` (the host the session asks, the memory storage, the messages of the link, Save a copy) and `SharedView` (the banner and the editor), `LinkFailed` (the page of a link that cannot be opened). `share/` keeps the panels. The view takes what the link carried as an input of its component, which the root gives it.
- **What the view provides is one list (`SHARED_CANVAS_PROVIDERS`)**: a storage of its own that keeps nothing, hiding the page's from the editor; the shared canvas as the host of the session (ADR-0072); and the messages for the simulation. A spec that renders the service without the component uses the same list, so that the two cannot differ.

### A copy is called “Name (shared)”

ADR-0078 says that the copy has "the name of the link, or the first “Name (shared 2)” and so on that nobody has", which skips “Name (shared)”. It is now always **“Name (shared)”, then “Name (shared 2)”, “Name (shared 3)”**, cut to the cap as the name of a copy is (ADR-0072), whether or not the learner has a canvas of that name: a canvas that came from a link says where it came from in
its name, and a learner who is sent the same link twice has both.

- **The copy is put at the end of the strip, and is the canvas that was open last**, so that the page that is loaded after it opens it: the strip is read first and `lastOpenCanvas` only picks among the strip (ADR-0072), so setting the second alone would have opened the first canvas of the strip.
- **It is refused in words when the page's own storage is in memory** (the browser keeps nothing, or the probe at start failed): “*the reason of the storage* A copy would be gone when this tab is closed, so none was made.” A copy that would be gone is not made and not pretended. A failure to list, to make or to read the shared canvas is said the same way, after “A copy could not be saved.”

### A link carries the sender's flags

A link is `<base>?ff=<the flags that are on>#c=…`, so that it opens for whoever is sent it as it does for the sender: every feature is behind a flag, and a visitor who has none would be shown the placeholder. The recipient's page has the sender's flags for as long as the page is open and nothing else. **S12 deletes the flags, and with them the query of a link**
(`linkBase` in `share/link-maker.ts`); a link made before that still opens, because a query that nothing reads is ignored. This was not in ADR-0078, and a learner who shares a link with the flags they tried is shown it in the field.

### What the linter can and cannot see of plain text

ADR-0078 says that "the template rule that refuses `[innerHTML]` and `[outerHTML]` is on". There is a template rule for `outerHTML` (`no-outerhtml`) and none for `innerHTML`, and the core rule `no-implied-eval` only knows `setTimeout` as a timer if the configuration declares it as a global, which the app's does not.

- **`innerHTML` in a template is refused by a selector** on the nodes of the template (`BoundAttribute` and `TextAttribute` named `innerHTML`, whatever the case, since `innerHtml` is the same property to Angular), and `outerHTML` by the rule. **Text given to a timer is refused by a selector** on the call. Both are in the same list as the other names (`innerHTML`, `outerHTML`, `insertAdjacentHTML`,
  `document.write`, `eval`, `new Function`, `javascript:` URLs, `DomSanitizer`, `bypassSecurityTrust…`, `DOMParser`, `createContextualFragment`), which is spread into every block of the configuration that covers production code of the app, so that a folder with a block of its own cannot lose it; the boundaries spec tries every one of them in every folder, and a spec of the app is free to use them for its fixtures.

### How the policy is held

- **The generator refuses a page that the policy would break** and says what and where: an inline event handler, a `javascript:` URL, an inline script of a type it cannot hash, and a script or a style sheet from another origin. It looks at the tags and not at the text of a script or a style, hashes the text as the browser has it (`\r\n` is `\n`), and makes the same page when it is run twice.
- **A test tries to break the policy from a script of the page's own origin**: what Playwright evaluates is let through by the browser, and so is everything that it calls, so `eval` is tried by a script that the test serves from the page's address, which the policy lets run and which the policy then stops from using `eval`.
- **Every page of every test is watched for what the browser refused**, by directive and address (`support/test.ts`), and a test that needs a second browser (someone who is sent a link) asks for a `visitor`: a context of its own with nothing in its storage, with the same checks, the same promise to keep canvases and the same slowed processor.

## Consequences

### Positive

- The initial chunk is what it was before S10 plus 4 kB, and a change that makes it bigger fails the build.
- The page runs under a policy with no `eval`, and every journey of the suite proves it.
- A link is not a way to run anything in the page, by three walls: the text binding, the linter, and the policy.

### Negative / trade-offs

- The prefix of a link is written in two places. The alternative is a second entry point for the persistence library.
- Zod's parsers are never compiled, in the app and in the specs of the domain. It is free for the schemas that there are, and a schema of plain objects that is added later could be slower; the number to look at is the time to read the big canvas.
- A copy of a shared canvas always has “(shared)” in its name; a learner who wants it without has to rename it.
- A link carries flags until S12, which makes it longer by a few dozen characters and shows a learner a query that they did not write.

## Alternatives considered

- **Importing `@rmq/persistence` in the root and keeping the chunk.** Rejected: 650 kB for everyone to read a fragment that most do not have.
- **Setting zod's `jitless` in `main.ts`.** Rejected: it imports zod in the root. It was tried, and the initial chunk went to 630 kB.
- **A policy with `'unsafe-eval'`.** Rejected: it is the thing the policy is for.
- **Leaving the shared view in `share/` and the editor out of it.** Rejected: the view is the editor.
- **A `Name` without a suffix for a copy.** Rejected, above.

## Related

- [ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md), [ADR-0072](0072-the-canvases-flag-puts-a-workspace-around-the-editor-a-strip-of-open-canvases-a-home-and-an-editor-that-is-made-again-for-each-canvas.md), [ADR-0077](0077-a-share-link-is-v1-and-the-deflated-envelope-in-base64url-it-fails-in-words-and-its-messages-are-checked-before-they-are-restored.md),
  [ADR-0078](0078-a-link-is-made-from-the-canvas-as-it-is-a-shared-canvas-opens-in-an-editor-that-keeps-nothing-and-its-text-is-only-text-under-a-policy.md), [ADR-0079](0079-the-export-is-a-definitions-file-for-one-vhost-written-with-floats-as-1-0-it-lists-what-it-leaves-out-and-the-nightly-imports-it.md).

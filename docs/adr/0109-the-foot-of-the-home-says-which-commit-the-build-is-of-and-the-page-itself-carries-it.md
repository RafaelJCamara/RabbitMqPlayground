# ADR-0109: The foot of the home says which commit the build is of, and the page itself carries it

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** @RafaelJCamara
- **Refines:** "The foot has the disclaimer and one link" of [ADR-0100](0100-the-foot-of-the-home-keeps-the-disclaimer-and-the-source-link-and-the-line-of-room-goes-the-warnings-stay.md): the foot also says which build it is.

## Context

- Every push to `main` is deployed to GitHub Pages (ADR-0015), and nothing on the site said which one it was. To know whether a change was live, the maintainer had to read `build-info.json` or the Actions run, and a learner who reports a problem could not say which build they saw.
- The postbuild step already writes `build-info.json` (the commit, the ref and the time), which the post-deploy smoke test polls. It is a file **beside** the page: Pages' CDN can serve a new `build-info.json` with an old `index.html` for a few minutes, and a page that reads it would then name a commit that its bundle is not.
- The request: show the commit hash at the bottom of the page, as many websites do, so that it is known which change is released.

## Decision

- **`tools/pages/postbuild.ts` puts the commit in `index.html`**, in `<meta name="rmq-build" content="…">` after the charset (`withBuildMeta`). `404.html` is a copy of `index.html`, so it has it too. The value is `GITHUB_SHA` in CI and `local` anywhere else. A value that is not made of letters, digits, `.`, `_` and `-` is refused by the build, because it would be put in an attribute of the page. Making the page again replaces the meta and does not add a second.
- **The app reads it once** (`readBuild`, behind the token `BUILD` in `core/build-info.ts`). A full hash (7 to 40 lowercase hexadecimal characters) gives `short` (its first seven characters) and `url` (`<source>/commit/<hash>`); `local` gives `local` and no link, since it is no commit of the repository. A page with no meta (`ng serve`, a spec) or with anything else in it has **no build**, and the foot says nothing: a stamp is left out and never shown wrong.
- **`<rmq-build-stamp>` says "Build 3f2a9c1"**, the short hash being a link to the commit, with the whole hash as its title. It is `data-testid="build-stamp"`.
- **It is in the foot of the home only** (a second item of the list that has "Source code"), which is the page of My canvases. Nowhere else, by request: not in the editor, whose status bar is for what the learner is doing, and not in the page of a link that cannot be opened or in the shared view, which are not the home.
- **`APP_SOURCE_URL`** in `core/app-info.ts` is the one place that has the address of the repository. The home's "Source code" link and the commit link are made from it.
- **The smoke test of the live site checks it**: after the deploy has been seen to serve the new commit, the home's foot must show the first seven characters of `EXPECTED_COMMIT`, linking to `/commit/<that commit>`. The browser journeys of the build accept `local` or a short hash, since a build of CI has a commit and a build on a machine does not.
- **`build-info.json` stays**, for the smoke test's polling, which has to work before the page does.

## Consequences

### Positive

- Anyone can tell which build they are looking at, and a report can say so. The maintainer can check that a merge is live by looking at the page.
- The commit is in the same file as the bundle that it names, so a stale cache cannot show a commit that the page is not.
- No request is made and no script is added: the page's content security policy (ADR-0078) is unchanged, since a `<meta>` is not a script and the link is plain navigation.

### Negative / trade-offs

- A build of a pull request (`GITHUB_SHA` is the merge commit of the pull request) names a commit that is not on `main`; only a deployed build is on the site, and that one is a commit of `main`.
- A learner in the editor does not see it without going to My canvases.
- The ADR-0100 test that said that the foot has exactly one link is now "has the link to the source" (the build is a second link where there is one).

## Alternatives considered

- **Read `build-info.json` in the app.** One more request, a fallback for when it fails, and the stale-cache mismatch above.
- **Replace a constant in the bundle** (`define` in `angular.json`). The values of `define` are written in the file and cannot take the commit of a run without a generated file or a change to the build command, and the bundle's hash would change with every commit, so nothing could be cached between two deploys.
- **A version number instead of a hash.** The product has one tag (v0.1.0) and deploys on every merge, so a number would say nothing of what is live.
- **Show the build in the editor's status bar too.** It is dense already, and the warnings that matter there (ADR-0100) would be harder to see.

## Related

- [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0078](0078-a-link-is-made-from-the-canvas-as-it-is-a-shared-canvas-opens-in-an-editor-that-keeps-nothing-and-its-text-is-only-text-under-a-policy.md), [ADR-0087](0087-the-disclaimer-moves-from-the-placeholder-to-the-welcome-and-the-foot-of-the-home.md), [ADR-0100](0100-the-foot-of-the-home-keeps-the-disclaimer-and-the-source-link-and-the-line-of-room-goes-the-warnings-stay.md).
- Code: `web/tools/pages/postbuild.ts`, `web/projects/app/src/app/core/build-info.ts`, `web/projects/app/src/app/core/ui/build-stamp.ts`.
- Tests: `web/tools/pages/postbuild.spec.ts`, `core/build-info.spec.ts`, `core/ui/build-stamp.spec.ts`, `canvases/home.spec.ts`, `canvases/link-failed.spec.ts`, `e2e/smoke.spec.ts`, `e2e/live.spec.ts`.

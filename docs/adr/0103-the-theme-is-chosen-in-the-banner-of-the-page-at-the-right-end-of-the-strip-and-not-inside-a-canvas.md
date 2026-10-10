# ADR-0103: The theme is chosen in the banner of the page, at the right end of the strip, and not inside a canvas

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md) (the theme choice and where it is kept), [ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md) (the theme is the page's, applied by the root), [ADR-0096](0096-the-strip-is-one-row-with-the-newest-tab-first-the-close-inside-its-box-arrows-for-the-rest-and-a-close-all.md) (the strip is one row, and what is in it that stays in place) and [ADR-0078](0078-a-link-is-made-from-the-canvas-as-it-is-a-shared-canvas-opens-in-an-editor-that-keeps-nothing-and-its-text-is-only-text-under-a-policy.md) (the banner of a shared canvas). Nothing is superseded.

## Context

- The `Theme` select (System, Light, Dark) was in the top bar of the editor. A learner on the home, with no canvas open, or on the first-run chooser, had no way to choose a theme, though the theme is the page's (ADR-0030, ADR-0032): it is applied by the root, kept in the browser (`rmq.theme`), and the same for every canvas. The request: "the dark/light/system should be chosen not inside the canvas, but from the outside."
- The page has a banner that is always there: the strip of the workspace (ADR-0072, ADR-0096) on the home and in every editor, and the banner of a shared canvas (ADR-0078).

## Decision

- **A component of its own, `rmq-theme-picker` (`core/theme/theme-picker.ts`)**: the icon that stands for the choice (a monitor, a sun, a moon; hidden from a screen reader) and the `Theme` select with its three choices in words. It reads and writes `ThemeService` and nothing else: `ThemeService`, `rmq.theme` and the stylesheet are as they were.
- **It sits at the right end of the banner of the workspace**, after the `<nav>` of open canvases and outside it, so it is on the home, on the first-run chooser that opens over the home, and in every editor, and it stays where it is when the learner goes from one to another. The banner is still the one banner of the page, and holds the one `h1`.
- **It sits in the banner of a shared canvas as well**, after the two ways out, because a learner who opens a link would otherwise have no way to choose.
- **The editor's top bar no longer has it.** The editor is a canvas, and what is chosen there is not the canvas's.
- **The strip stays one row under 72 pixels (ADR-0096).** The picker is a fixed-size part of the row that does not shrink; only the tabs scroll. The browser test of twelve open canvases measures it.

## Consequences

### Positive

- The theme can be chosen from every screen, including the home with nothing open and the page of a link, from one place that does not move.
- The top bar of the editor has one control less, which gives its save state and its buttons more room.

### Negative / trade-offs

- The strip has one more thing in it that is not a tab. On a narrow window the picker wraps with the rest of the banner (the banner already wraps, ADR-0096); at 1280 pixels it is in the same row.
- Tests and the manual pass that reached the control in the top bar are changed (the step 23 of the manual pass names the strip).

## Alternatives considered

- **A menu in the strip.** A second step to reach a control that has three choices.
- **Only the home.** The learner who is in an editor would have to leave it, and a shared canvas has no home.
- **The `<nav>`.** The theme is not a place to go to, so it does not belong in a list of destinations.

## Related

- [ADR-0032](0032-the-editors-visual-language-tokens-themes-shapes-and-forms.md), [ADR-0030](0030-the-editors-folders-and-how-it-is-loaded-behind-its-flag.md), [ADR-0096](0096-the-strip-is-one-row-with-the-newest-tab-first-the-close-inside-its-box-arrows-for-the-rest-and-a-close-all.md), [ADR-0078](0078-a-link-is-made-from-the-canvas-as-it-is-a-shared-canvas-opens-in-an-editor-that-keeps-nothing-and-its-text-is-only-text-under-a-policy.md), [docs/accessibility.md](../accessibility.md).
- Tests: `projects/app/src/app/core/theme/theme-picker.spec.ts`, `canvases/workspace.spec.ts`, `canvases/shared-view.spec.ts`, `editor/top-bar.spec.ts`, `e2e/editor-shell.spec.ts`, `e2e/canvases-strip.spec.ts`, `e2e/share-journeys.spec.ts`.

# ADR-0087: The disclaimer moves from the placeholder to the welcome and the foot of the home

- **Status:** Accepted. "The links of the placeholder go with it" is superseded by [ADR-0100](0100-the-foot-of-the-home-keeps-the-disclaimer-and-the-source-link-and-the-line-of-room-goes-the-warnings-stay.md) (only "Source code" stays), the rest stands.
- **Date:** 2026-10-09
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0084](0084-the-seven-m1-flags-are-deleted-one-by-one-the-page-ignores-what-they-leave-and-the-first-run-always-asks.md) (the "Under construction" page is deleted), and the plan's risk "Trademark (\"RabbitMQ\" is Broadcom's)": a disclaimer, no logo, the name in one constant ([`core/app-info.ts`](../../web/projects/app/src/app/core/app-info.ts)).

## Context

"RabbitMQ" is Broadcom's mark, and the plan says that the product carries a disclaimer ("Not affiliated with, endorsed by or sponsored by Broadcom Inc. or the RabbitMQ project"). Until now the disclaimer was in the footer of the placeholder, which was the page that every visitor of the deployed site saw, and in the page of a link that cannot be opened. The editor and the home never had it. Deleting the placeholder (ADR-0084) would remove it from the product, and `e2e/smoke.spec.ts` ("says it is not affiliated with Broadcom or the RabbitMQ project") would have nothing to look at.

## Decision

- **The sentence (`APP_DISCLAIMER`) is shown in two places of the product**: at the foot of the first-run welcome (ADR-0082), which is the first thing that a new visitor reads, and at the foot of the home ("My canvases"), which a learner can always reach and which every visitor sees behind the welcome. It is a paragraph of text in the flow of the page, muted, and never over the canvas (ADR-0085). The page of a link that cannot be opened keeps it.
- **The editor does not carry it.** The canvas has no room to spare (a window of 720 pixels leaves it about 400), and a line that is on the screen all day is a line that nobody reads. The README and the release notes carry it as well.
- **The links of the placeholder go with it**: "Source code", "Design decisions" and "Progress" are at the foot of the home beside the sentence. The smoke test looks for the sentence in the welcome, and on the home after it.
- **The test of reflow at 320 pixels (WCAG 1.4.10) measures the welcome and the home**, which are text and reflow. The canvas is a diagram, which the criterion allows to keep its two dimensions (the editor is 208 pixels wider than the window at 320).

## Consequences

- The disclaimer is where a person who wonders about the name looks (the first screen and the list of canvases), and the product has no footer that takes room from the editor.
- A learner who works in the editor for a day does not see it. If the owner wants it there, it is a line in the status bar and not a banner.

## Alternatives considered

- **Keep a footer on every screen.** Rejected: it takes a line from the canvas, which is already short at 720 pixels, for a sentence that does not change.
- **Put it in the cheat-sheet and the tour only.** Rejected: neither is seen by a visitor who has not asked.
- **Leave it to the README.** Rejected: the product is a web page, and the page is what a visitor reads.

## Related

- [ADR-0082](0082-the-first-run-is-a-library-with-no-canvas-and-asks-what-to-start-with-the-same-chooser-opens-from-the-home.md), [ADR-0084](0084-the-seven-m1-flags-are-deleted-one-by-one-the-page-ignores-what-they-leave-and-the-first-run-always-asks.md), [ADR-0085](0085-targets-are-24-pixels-nothing-that-stays-is-drawn-over-the-canvas-and-every-screen-is-checked-in-both-themes-from-a-list.md)

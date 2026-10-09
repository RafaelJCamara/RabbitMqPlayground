# ADR-0090: The manual screen-reader pass does not block v0.1.0 and is tracked in issue #20

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** @RafaelJCamara
- **Supersedes:** the part of [ADR-0086](0086-the-release-waits-for-a-person-a-laptop-and-the-calendar-and-says-exactly-what-is-left.md) that makes the manual pass with a screen reader a condition of the tag `v0.1.0`. The rest of ADR-0086 stands: the frame rate on a mid-range laptop and seven scheduled nights still wait for the tag, and the tag is still made only when what it claims is true.
- **Extends:** [ADR-0015](0015-testing-strategy-and-definition-of-done.md) (what "done" is: a thing that was not checked is not claimed).

## Context

- ADR-0086 left three things that a program cannot do and made all three conditions of the tag: a pass with NVDA or VoiceOver, the frame rate on a mid-range laptop and seven scheduled nights.
- The pass is 23 steps, about 40 minutes, for a person with a screen reader ([docs/accessibility.md](../accessibility.md)). It is the only one of the three that is not measured by a number or by the calendar, and the only one for which the author has no equipment at hand.
- Everything that a machine can say about accessibility is said and green: axe on every screen and state in both themes from a list that a test holds to the app, the keyboard-only journey, 24 by 24 pixel targets, nothing that stays on screen covering the item that has the cursor, and the WCAG 2.2 fixes.
- On 2026-10-09 the owner decided that the first release does not wait for the pass.

## Decision

- **The manual screen-reader pass is no longer a condition of the tag `v0.1.0`.** It is a task for later, tracked in [#20](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/20), with the same script, the same way to record it and the same definition of done as in ADR-0086 and `docs/accessibility.md`.
- **The release says so.** The release notes keep it under "Not checked by this release's author, and so not claimed", with the link to #20, so that nobody reads the tag as a claim that a screen reader was used. The README and the plan say the same.
- **A failure found later is an ordinary defect.** Each failed step is an issue, fixed in a later release (a patch, if the fix is small) with a test that holds it. The Nightly count is not reset by it unless a night fails.
- **What still waits for the tag** is the frame rate on a mid-range laptop (`npm run perf:fps`, met or an ADR that moves the line) and seven scheduled nights in a row. The tag and the closing of [#14](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/14) and [#1](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/1) follow ADR-0086 for those two.

## Consequences

### Positive

- The release is not held for a task that needs equipment and 40 minutes of one person who is not the author.
- The claim of the tag is exactly what was checked, and the gap is written down, linked and owned.

### Negative / trade-offs

- **v0.1.0 may be used by someone with a screen reader before the pass was made.** The machine checks lower the chance of a blocking defect (every control has a name, the landmarks are unique, the keyboard reaches everything), and they do not say that the words are usable. The notes say this, and #20 is labelled `accessibility` and `help wanted`.
- The acceptance of M1 in [the plan](../plans/m1.md) has a line that is not true on the day of the tag. The plan says so in its status table and does not change the line, because it is a record of what was asked.

## Alternatives considered

- **Keep it a blocker.** Rejected by the owner: it holds a release that is otherwise ready, for a task that nobody has scheduled.
- **Tag now and say nothing of it.** Rejected: a tag is read without its notes (ADR-0086), and what was not checked is not claimed (ADR-0015).
- **Delete the pass from the plan.** Rejected: it is still wanted, and #20 keeps it.

## Related

- [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0036](0036-the-test-strategy-of-the-editor.md), [ADR-0085](0085-targets-are-24-pixels-nothing-that-stays-is-drawn-over-the-canvas-and-every-screen-is-checked-in-both-themes-from-a-list.md), [ADR-0086](0086-the-release-waits-for-a-person-a-laptop-and-the-calendar-and-says-exactly-what-is-left.md).
- Issues [#20](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/20), [#14](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/14) and [#1](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/1); [the release notes](../releases/v0.1.0.md).

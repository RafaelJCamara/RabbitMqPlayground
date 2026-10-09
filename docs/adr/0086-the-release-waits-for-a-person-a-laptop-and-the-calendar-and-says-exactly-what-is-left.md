# ADR-0086: The release waits for a person, a laptop and the calendar, and says exactly what is left

- **Status:** Accepted. The manual screen-reader pass is no longer a condition of the tag (superseded by [ADR-0090](0090-the-manual-screen-reader-pass-does-not-block-v0-1-0-and-is-tracked-in-issue-20.md)), and neither is the frame rate on a mid-range laptop (superseded by [ADR-0091](0091-the-frame-rate-on-a-mid-range-laptop-does-not-block-v0-1-0-and-is-tracked-in-issue-21.md)), nor the seven scheduled nights (superseded by [ADR-0092](0092-seven-scheduled-nights-in-a-row-are-not-a-condition-of-the-tag-v0-1-0.md)). No condition is left.
- **Date:** 2026-10-09
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0003](0003-roadmap-and-milestones.md) (the acceptance of M1, section 7 of [the plan](../plans/m1.md)), [ADR-0015](0015-testing-strategy-and-definition-of-done.md) (what "done" is) and [ADR-0084](0084-the-seven-m1-flags-are-deleted-one-by-one-the-page-ignores-what-they-leave-and-the-first-run-always-asks.md) (which links here), for what S12 ([#14](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/14)) does with the tag `v0.1.0`.

## Context

The acceptance of M1 has six lines: all thirteen slice issues closed; CI green with every gate and the nightly conformance and fuzz runs green seven nights in a row; no flags and the budgets met; 200 nodes, 500 edges and 500 messages at 45 frames a second or more on a mid-range laptop, with the result recorded; a manual pass with NVDA or VoiceOver; and `v0.1.0` tagged with release notes.

S12 can do, and has done, everything that a program can do: the flags are deleted, the budgets are met (the build fails above them), CI and the Nightly are green, and the accessibility checks that a machine can make are made on every screen in both themes. Three lines cannot be done by the author of this repository in a session:

1. **A person with a screen reader.** NVDA and VoiceOver say what a person can use, and no test says that. The checks of S12 (axe, the keyboard-only journey, the targets) make a pass likely to be short, not unneeded.
2. **A mid-range laptop.** The machine that built S12 is an i9-14900HX with an RTX 4070, which is a gaming laptop. A number from it says that the product is not slow there, not that it is fast enough where the plan asked.
3. **The calendar.** Seven nights in a row is seven scheduled runs of the Nightly, one a day, and three had run (the 6th, 7th and 8th of October) when S12 was built. A run that is started by hand does not count: it runs on the commit that someone chose, when they chose.

A tag is a claim. `v0.1.0` on a commit says that the acceptance is true, and ADR-0015 says that a thing that was not checked is not claimed.

## Decision

- **S12 does what can be done and leaves the rest as tools and instructions, not as promises.** The tag is not made and [#14](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/14) and [#1](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/1) stay open, with a comment on each that says what is left, who does it and how. Only what is true is ticked.
- **The pass with a screen reader** is a script ([docs/accessibility.md](../accessibility.md), "The manual pass with a screen reader"): 23 steps, each with what to do, what is heard and what fails it. One of NVDA (Windows) and VoiceOver (macOS) is enough for the tag, the other is welcome. A failed step is an issue; the pass is done when every step passes in one of the two and each failure has a closed issue or an ADR that says why it stays. The result is written in a comment on #14, with the versions.
- **The frame rate** is measured by `npm run perf:fps` ([docs/performance.md](../performance.md)) on a laptop that has no discrete graphics and a processor of four to eight cores from the last five years, plugged in, on its normal power plan. The tool writes a record with the machine and the power state into `docs/performance/records/`, and it is committed. The line is the median of **45 frames a second or more** with 500 messages in flight on the canvas of 200 nodes and 500 edges. If it is not met, the next step is a fix or an ADR that changes the line with its reason, and not a record that is left out. The record of the author's laptop is in the repository as a data point and is not the answer.
- **The nights** are counted from `gh run list --workflow nightly.yml --event schedule`: seven scheduled runs on seven consecutive days, all green. A red night starts the count again after the fix. Runs started by hand do not count.
- **The tag is made when all three are true**, on a commit that CI and the Nightly are green on, and the commands are in the hand-over: a signed or annotated tag `v0.1.0`, a GitHub release with [the release notes](../releases/v0.1.0.md) as its body, and the two issues closed with the links to the three records.

## Consequences

### Positive

- The tag says what is true. The people who open the repository find a site that is the finished product, a list of what is not yet checked, and the exact commands that finish the release.
- Nothing is left to memory: the script, the tool and the count are in the repository.

### Negative / trade-offs

- **M1 is not "done" the day S12 is.** The deployed site is the product from the day S12 is pushed, with no tag. A defect that the screen-reader pass finds is fixed after the code is declared finished, and the Nightly count is not reset by a fix unless a night fails.
- The definition of a mid-range laptop is the owner's to change. It is written to be checkable by the record (the CPU and GPU names are in it), not to be right for every reader.

## Alternatives considered

- **Tag `v0.1.0` now and say in the notes what was not checked.** Rejected: a tag is read without its notes, and the acceptance would be false on the day of the tag.
- **Tag `v0.1.0-rc.1` now.** Rejected: nobody consumes a release candidate, and it is a tag that no one asked for.
- **Lower the line, or count the hand runs, to finish today.** Rejected: that is how an acceptance stops meaning anything.
- **Make the author's laptop the mid-range laptop by throttling its processor.** Rejected for the answer, kept as a data point: a throttled processor is not a mid-range machine (its graphics, memory and caches are not), and the tool records the rate that was used.

## Related

- [ADR-0003](0003-roadmap-and-milestones.md), [ADR-0010](0010-explanation-first-editor-ux.md), [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0017](0017-canvas-keyboard-model.md), [ADR-0084](0084-the-seven-m1-flags-are-deleted-one-by-one-the-page-ignores-what-they-leave-and-the-first-run-always-asks.md), [ADR-0085](0085-targets-are-24-pixels-nothing-that-stays-is-drawn-over-the-canvas-and-every-screen-is-checked-in-both-themes-from-a-list.md)
- Issues [#14](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/14) and [#1](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/1); [the release notes](../releases/v0.1.0.md).

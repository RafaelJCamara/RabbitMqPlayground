# ADR-0092: Seven scheduled nights in a row are not a condition of the tag v0.1.0

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** @RafaelJCamara
- **Supersedes:** the part of [ADR-0086](0086-the-release-waits-for-a-person-a-laptop-and-the-calendar-and-says-exactly-what-is-left.md) that makes seven scheduled runs of the Nightly in a row, all green, a condition of the tag `v0.1.0`, and the last decision of [ADR-0090](0090-the-manual-screen-reader-pass-does-not-block-v0-1-0-and-is-tracked-in-issue-20.md) and [ADR-0091](0091-the-frame-rate-on-a-mid-range-laptop-does-not-block-v0-1-0-and-is-tracked-in-issue-21.md) that the calendar still waits. With this, ADR-0086 has no condition left.
- **Extends:** [ADR-0015](0015-testing-strategy-and-definition-of-done.md) (what is not checked is not claimed).

## Context

- The acceptance of M1 asked that CI be green with every gate and that the nightly conformance and fuzz runs be green seven nights in a row. ADR-0086 kept the seven nights as the one thing that only time can give, and counted only scheduled runs.
- The reason for the count was to find what a single run does not: a flaky test, a seed that fails once in a few hundred runs, a change in the broker image. In this repository the Nightly did find real defects (two in the engine on 2026-10-09, both fixed), and it did so on the run of the day, with a random seed, not by waiting for the seventh night.
- The Nightly goes on running every night after the tag. A defect that a later night finds is an ordinary defect, fixed in a later release, as it was found today.
- On 2026-10-09 the owner decided that the count of nights makes no sense as a condition of the release, after the screen-reader pass (ADR-0090) and the frame rate (ADR-0091) had stopped being ones.

## Decision

- **Seven scheduled nights in a row are not a condition of the tag.** The line is removed from the docs that said that the release waits for it.
- **The tag is made on a commit that CI is green on and that a run of the Nightly is green on** (a scheduled one, or one started by hand with `mode=verify` and `fuzz_runs=5000`, on that commit). That is what the tag claims about testing, and the release notes say so in those words.
- **The notes do not claim a streak.** They say what is true on the day: how many scheduled nights were green in a row when the tag was made, and that the plan's line of seven is not a condition. The Nightly goes on, and a red night is an issue like any other.
- **Nothing is left that the tag waits for.** The screen-reader pass is [#20](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/20) and the frame rate is [#21](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/21), and both are listed in the notes as not checked.

## Consequences

### Positive

- The release is not held for the calendar, and the tag can be made as soon as CI and the Nightly are green on the commit.
- What the tag claims is written down exactly and is true.

### Negative / trade-offs

- **Flakiness that needs many nights to show has had less time to show.** Four scheduled nights (6 to 9 October) were green before the tag. A flake that a seventh night would have caught will be found by a later one, and fixed after the release.
- The acceptance of M1 in [the plan](../plans/m1.md) now has three lines that are not true on the day of the tag. The plan says so in its status table and keeps the lines, because it is a record of what was asked.

## Alternatives considered

- **Keep the count and wait three more nights.** Rejected by the owner.
- **Count the runs that were started by hand.** Rejected: they run on a commit that someone chose, when they chose, and the owner did not ask for the count at all.
- **Tag now and keep a note that says "7 nights" as a goal.** Rejected: a goal that blocks nothing is a claim waiting to be read as true. The line is removed, and the notes say what happened.

## Related

- [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0086](0086-the-release-waits-for-a-person-a-laptop-and-the-calendar-and-says-exactly-what-is-left.md), [ADR-0090](0090-the-manual-screen-reader-pass-does-not-block-v0-1-0-and-is-tracked-in-issue-20.md), [ADR-0091](0091-the-frame-rate-on-a-mid-range-laptop-does-not-block-v0-1-0-and-is-tracked-in-issue-21.md).
- Issues [#14](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/14) and [#1](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/1); [the release notes](../releases/v0.1.0.md).

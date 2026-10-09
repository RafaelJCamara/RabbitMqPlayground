# ADR-0091: The frame rate on a mid-range laptop does not block v0.1.0 and is tracked in issue #21

- **Status:** Accepted. That the calendar still waits for the tag is superseded by [ADR-0092](0092-seven-scheduled-nights-in-a-row-are-not-a-condition-of-the-tag-v0-1-0.md).
- **Date:** 2026-10-09
- **Deciders:** @RafaelJCamara
- **Supersedes:** the part of [ADR-0086](0086-the-release-waits-for-a-person-a-laptop-and-the-calendar-and-says-exactly-what-is-left.md) that makes a record of the frame rate from a mid-range laptop a condition of the tag `v0.1.0`. What ADR-0086 says about how the frame rate is measured, what a mid-range laptop is and what is done if the median is below 45 stands, for the task that is now [#21](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/21).
- **Extends:** [ADR-0090](0090-the-manual-screen-reader-pass-does-not-block-v0-1-0-and-is-tracked-in-issue-20.md) (the same decision for the screen-reader pass) and [ADR-0015](0015-testing-strategy-and-definition-of-done.md) (what is not checked is not claimed).

## Context

- The acceptance of M1 asks that 200 nodes, 500 edges and 500 messages in flight run at 45 frames a second or more on a mid-range laptop, with the result recorded. ADR-0086 made a record from such a laptop a condition of the tag, because the author's machine is a gaming laptop.
- What exists: the tool (`npm run perf:fps`), the instructions and the table ([docs/performance.md](../performance.md)), and one record, from an Intel Core i9-14900HX with the charger in: **147 fps** median unthrottled (1% low 99) and **22.7 fps** at a 4× CPU throttle (1% low 6.1). The throttled row is below 45, and it is a data point, not a verdict, because a throttled processor is not a mid-range machine. So whether the product reaches 45 on the intended hardware is **not known**.
- On 2026-10-09, after ADR-0090, the owner decided that this does not block the first release either.

## Decision

- **The frame rate on a mid-range laptop is no longer a condition of the tag `v0.1.0`.** It is a task for later, tracked in [#21](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/21), with the tool, the definition of a mid-range laptop and "If it is below 45" of `docs/performance.md` unchanged.
- **The release says what is known and what is not.** The release notes say that 45 fps on a mid-range laptop was not checked, and give the one record with its numbers, including the one below 45, so that nobody reads the tag as a claim of performance. The line is not lowered, and the record is not left out.
- **If the record of #21 is below 45**, the next step is a fix or an ADR that changes the line with its reason, as before, and it is an ordinary defect for a later release.
- **What still waits for the tag** is the calendar: seven scheduled Nightlies in a row, all green, counted as in ADR-0086. The tag and the closing of [#14](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/14) and [#1](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/1) follow ADR-0086 for that.

## Consequences

### Positive

- The release is not held for a task that needs a machine that the author does not have.
- The claim of the tag is exactly what was checked, and the gap is written down with its numbers, linked and owned.

### Negative / trade-offs

- **The product may be slow on a mid-range laptop and nobody knows.** The one throttled data point (22.7 fps) suggests that it may be, for the largest canvas of the target. A learner with a small canvas is not affected, and the target is the largest one that the plan names. The notes say this plainly.
- The acceptance of M1 in [the plan](../plans/m1.md) has a second line that is not true on the day of the tag. The plan says so in its status table and keeps the line, because it is a record of what was asked.

## Alternatives considered

- **Keep it a blocker.** Rejected by the owner.
- **Lower the line, or call the throttled laptop a mid-range one, and tick it.** Rejected: that is how an acceptance stops meaning anything (ADR-0086).
- **Leave the record of the gaming laptop out of the notes.** Rejected: a number that is below the line is the most useful thing that is known.

## Related

- [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0086](0086-the-release-waits-for-a-person-a-laptop-and-the-calendar-and-says-exactly-what-is-left.md), [ADR-0090](0090-the-manual-screen-reader-pass-does-not-block-v0-1-0-and-is-tracked-in-issue-20.md).
- Issues [#21](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/21), [#14](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/14) and [#1](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/1); [docs/performance.md](../performance.md); [the release notes](../releases/v0.1.0.md).

# ADR-0108: Every change reaches main through a pull request, and nobody pushes to it

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** @RafaelJCamara
- **Supersedes:** [ADR-0004](0004-trunk-based-development-on-main.md), and the repository admin bypass of [ADR-0107](0107-a-pull-request-into-main-needs-the-ci-checks-and-the-code-owner-and-the-maintainer-may-still-push.md). The rest of ADR-0107 stands: the ruleset, the code owner and the checks.

## Context

- ADR-0004 had the maintainer commit straight to `main`, with automation in place of review. ADR-0107 then put a ruleset on `main` for everyone else, and left the repository admin role able to push past it.
- The maintainer wants a pull request for every change, their own included: the checks run before a change lands, and a red `main` stops being something to fix afterwards.
- A change to documentation only cannot break the build, so it should not wait for the end-to-end tests.

## Decision

- **Every change to `main` is a pull request.** Maintainers work on a branch and open a pull request like everybody else. Nobody commits or pushes to `main`.
- **The ruleset "Protect main" lets the repository admin role bypass it only through a pull request** (bypass mode "pull request", not "always"). A direct push to `main` is refused for the admin too. The maintainer cannot approve their own pull request, and this bypass is how it merges once its checks pass.
- **Commits and branches stay small.** Each commit follows [Conventional Commits](https://www.conventionalcommits.org/), and the commit-message check of the pull request enforces it.
- **The gates of ADR-0004 stay.** The pre-push hook runs the fast suite on the maintainer's machine, CI runs the full suite on the pull request and again on `main` after the merge, and a nightly job runs the conformance tests against a real RabbitMQ. A test is never skipped to get to green. A feature of a later milestone still sits behind a flag until it ships.
- **A change to documentation only skips most of the checks.** Everything under `docs/` and the Markdown files at the root count as documentation. The `Changes` job of the workflows CI, CodeQL and Pull request checks looks at the files of the change and, for documentation only, skips `Verify`, the end-to-end tests, the benchmarks, CodeQL and the dependency review. The commit-message check always runs. The jobs are skipped with `if` and the workflows have no path filter, because a skipped job counts as passed for a required check and a check that never starts leaves the pull request waiting for ever. A manual run, a schedule and a base that is not in the checkout run everything.
- **Outside contributions** are unchanged: a pull request from a fork, no CLA.

## Consequences

### Positive

- `main` only moves by a change whose checks have passed, so a red `main` is rare.
- The rule holds on GitHub for the maintainer too, and not only in the guide.
- A pull request that changes documentation merges in a minute and spends no CI time on the build.

### Negative / trade-offs

- The maintainer pays a pull request for a one-line change, and about 15 minutes for the end-to-end tests when it touches code.
- With one code owner, the maintainer's pull requests still merge through the admin bypass, and a second code owner would remove the need.
- A change to documentation that a test reads (the README title, `docs/commands.md`) is not checked until the next change to code.

## Alternatives considered

- **Keep committing to `main` as ADR-0004 said.** A broken commit reaches `main` and the deploy before anything stops it.
- **No bypass at all.** The sole code owner could never merge a pull request.
- **A path filter on the workflows.** A required check that does not run blocks the merge.

## Related

- [ADR-0004](0004-trunk-based-development-on-main.md), [ADR-0107](0107-a-pull-request-into-main-needs-the-ci-checks-and-the-code-owner-and-the-maintainer-may-still-push.md), [ADR-0015](0015-testing-strategy-and-definition-of-done.md).

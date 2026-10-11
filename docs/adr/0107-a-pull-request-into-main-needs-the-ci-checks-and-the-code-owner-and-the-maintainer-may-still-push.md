# ADR-0107: A pull request into main needs the CI checks and the code owner, and the maintainer may still push

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** @RafaelJCamara
- **Refines:** "Outside contributions" of [ADR-0004](0004-trunk-based-development-on-main.md). ADR-0004 said that others cannot push to `main`, and now GitHub enforces it.

## Context

- ADR-0004 says that outside contributors open pull requests and cannot push to `main`, but nothing on GitHub stopped them: `main` had no protection.
- The commit-message check ran only in a local hook, and a fork can skip a hook.
- Nothing scanned the code or the new dependencies for known vulnerabilities.

## Decision

- **A ruleset, "Protect main", applies to the default branch.** It blocks deleting `main` and force-pushes, and it requires a pull request with 1 approval, an approval again after a new push, every conversation resolved, and a review from a code owner.
- **`.github/CODEOWNERS` makes @RafaelJCamara the owner of every path.**
- **The checks that must pass before a merge:** `Verify`, `End-to-end and accessibility` (workflow CI), `Commit messages` and `Dependency review` (workflow Pull request checks), and `Analyze (javascript-typescript)` (workflow CodeQL).
- **Benchmarks are not required.** Their numbers vary from run to run. Deploy and Smoke run only on `main`.
- **No workflow has a path filter.** A required check that does not run leaves the pull request waiting for ever.
- **The repository admin role bypasses the ruleset**, so the maintainer keeps committing to `main` as ADR-0004 says. A commit that goes straight to `main` still meets CI there, and a red `main` is fixed first.

## Consequences

### Positive

- The rule of ADR-0004 for outside contributors holds on GitHub, and not only in the guide.
- A commit message that breaks Conventional Commits, a vulnerable new dependency and a CodeQL alert fail the pull request.

### Negative / trade-offs

- The maintainer's own pull requests cannot be approved by the maintainer. The admin bypass is the way to merge them, and a second code owner would remove the need.
- A pull request waits about 15 minutes for the end-to-end tests.
- The three new checks add runs of their own, and a CodeQL or dependency alert can be a false alarm that the maintainer then has to dismiss.

## Alternatives considered

- **No bypass for the maintainer.** Every change goes through a pull request that the maintainer cannot approve, so the maintainer would bypass it anyway.
- **Require Benchmarks.** A noisy number would fail a good pull request.
- **Run CI only on the paths that matter.** A docs-only pull request would wait for ever on a check that never starts.

## Related

- [ADR-0004](0004-trunk-based-development-on-main.md), [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0020](0020-mit-licence.md).

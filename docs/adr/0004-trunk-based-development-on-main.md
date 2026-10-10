# ADR-0004: Trunk-based development directly on `main`

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

The product owner wants all work committed **directly to `main`**, with no feature branches. That keeps the flow fast
and avoids long-lived branches and merge conflicts. The trade-off is that there is no pull-request review gate, so
quality has to be enforced by automation.

Earlier simulators also show how contribution friction kills a project: pull requests stalled for years waiting on a
contributor licence agreement (CLA).

## Decision

- **Trunk-based development.** All changes are committed directly to `main`. We don't create feature branches or
  long-lived branches.
- **Small, focused commits.** Each commit leaves `main` building, with tests passing. Commit messages follow
  [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`,
  `chore:`).
- **Automated gates replace review gates.**
  - A **pre-push hook** runs the fast suite: lint, type-check, unit and component tests, and the coverage gates.
  - **CI (GitHub Actions) runs on every push to `main`.** It runs the full suite, including the Playwright end-to-end
    tests. A nightly job runs the conformance tests against a real RabbitMQ.
    See [ADR-0015](0015-testing-strategy-and-definition-of-done.md).
  - **A red `main` is fixed first.** The next commit fixes it, or the breaking commit is reverted. A test is never
    skipped or disabled to get back to green.
- **`main` is always releasable.**
  - Unfinished user-facing features ship behind **feature flags**, which default to off.
  - A green `main` deploys automatically to the static host
    ([ADR-0006](0006-client-only-app-dotnet-api-when-needed.md)).
- **Outside contributions.** External contributors open pull requests from their forks into `main`; they can't push
  directly. CONTRIBUTING.md explains the workflow. **No CLA.**

## Consequences

### Positive

- No branch overhead, no merge conflicts across branches, and fast feedback.
- Continuous deployment: what's on `main` is what users get.

### Negative / trade-offs

- Without a review step, quality relies entirely on tests, hooks and CI. This is why the testing bar is strict.
- A bad push affects everyone right away, which is why we have the fix-or-revert rule.
- Feature flags add some code paths, which have to be cleaned up once a feature ships.

## Alternatives considered

- **GitHub Flow (a short-lived branch and a PR per change).** Rejected for now by the product owner. We can revisit it
  if the number of contributors grows. That would need a new ADR.
- **GitFlow.** Rejected: too heavy for this project.

## Related

- [ADR-0015](0015-testing-strategy-and-definition-of-done.md): testing strategy and definition of done.
- [ADR-0006](0006-client-only-app-dotnet-api-when-needed.md): hosting and deployment.

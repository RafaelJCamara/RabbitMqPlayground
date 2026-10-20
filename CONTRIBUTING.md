# Contributing to RabbitMQ Playground

Thank you for helping. This page explains how changes get into the project, and what a change needs before it is done.

## Ground rules

- **There is no CLA.** By contributing you license your work under the project's [MIT licence](LICENSE), on an "inbound
  equals outbound" basis ([ADR-0020](docs/adr/0020-mit-licence.md)). You confirm that you have the right to do so.
- **Be kind and specific.** Disagree with decisions by pointing at an ADR and proposing a new one, not by re-arguing in
  a pull request.

## How changes get in

Every change reaches `main` through a pull request, maintainers' included, and nobody pushes to `main`
([ADR-0108](docs/adr/0108-every-change-reaches-main-through-a-pull-request-and-nobody-pushes-to-it.md)).

- **Maintainers** work on a branch and open a pull request into `main`, in small commits. Each commit follows
  Conventional Commits and leaves the branch building with its tests passing. A red `main` is fixed first, with a pull
  request that fixes it or one that reverts the breaking change.
- **Everyone else** forks the repository and opens a pull request into `main`. Keep pull requests small, and include
  their tests.
- **`main` is protected.** A pull request needs the CI checks, a review from the code owner, and every conversation
  resolved. CI runs on pull requests from forks and from Dependabot. A change to documentation only (`docs/` and the
  Markdown files at the root) skips most of the checks, and the commit-message check always runs.

Not sure where to start? Open an issue, or pick a slice from the tracking issue
([#1](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/1)).

## Setting up

You need **Node.js 24.15 or later** (or 22.22.3 or later), because the Angular CLI requires it. `nvm use` reads `.nvmrc`.

```sh
cd web
npm ci          # installs dependencies and the git hooks (lefthook)
npm start
```

In a Claude Code cloud session, a `SessionStart` hook ([`.claude/hooks/session-start.sh`](.claude/hooks/session-start.sh))
does this for you. It puts a suitable Node on the `PATH`, points `PW_CHROMIUM_PATH` at the Chromium that is already
installed (`playwright install` is not available there), runs `npm ci` when `package-lock.json` has changed, and
installs the git hooks.

## Before you push

The **pre-push hook** runs these in parallel, and the push is refused if any of them fails:

- `npm run lint`: ESLint, including the rules about which library may import which;
- `npm run format:check`: Prettier (`npm run format` fixes it);
- `npm run typecheck`: `tsc -b`;
- `npm run test:libs:coverage`: Vitest, with the coverage thresholds for the libraries;
- `npm run test:app:coverage`: the Angular component tests, with the app threshold;
- `npm run build:dev`: a development build, which also checks the Angular templates.

**CI repeats all of this** and adds the production build, the bundle budgets, the Playwright and axe journeys, and the
benchmarks. A nightly job runs the conformance scenarios against a real RabbitMQ.

Two rules are not negotiable ([ADR-0015](docs/adr/0015-testing-strategy-and-definition-of-done.md)):

- **A failing or flaky test is never skipped, disabled or quarantined to get green.** Find the cause and fix it.
- **Coverage thresholds are never lowered to get a commit through.** Add the missing tests.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), and the `commit-msg` hook checks the first
line:

```
<type>(<optional scope>): <what changed, in the imperative, no full stop>
```

The types are `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore` and `revert`. Keep
the first line within 100 characters. Examples:

```
feat(engine): route messages through direct exchanges
fix(app): keep the focus ring visible while panning
test(conformance): record the delivery fixture for two consumers on one queue
docs(adr): add ADR-0021, short share links
```

## What "done" means

A change is done when all of these hold ([ADR-0015](docs/adr/0015-testing-strategy-and-definition-of-done.md)):

1. Its behaviour is covered by automated tests at the right layer: engine, property-based, command layer, persistence,
   component, end-to-end or conformance.
2. The coverage gates pass.
3. If a user-facing flow changed, its end-to-end journey is added or updated.
4. The accessibility checks pass (axe in CI, and a keyboard-only path for new interactions).
5. The documentation is updated: the command reference, and an ADR if a decision changed.
6. CI is green on `main`.

## Decisions and architecture

- **Significant decisions get an ADR.** Copy [`docs/adr/template.md`](docs/adr/template.md), use the next free number,
  and add the record to the index in the same commit ([ADR-0001](docs/adr/0001-record-architecture-decisions.md)).
  Accepted ADRs are not rewritten. To change a decision, write a new ADR that supersedes it.
- **Dependency rules are enforced by tools.** The engine imports nothing and reads no clock, randomness or browser
  global. Only `canvas/flow/**` imports Foblex Flow. `@rmq/testing` is for tests only. See
  [ADR-0018](docs/adr/0018-workspace-layout-and-dependency-rules.md). If ESLint refuses an import, the fix is in the
  design, not in the lint configuration.
- **Unfinished features of a later milestone go behind a feature flag** that is off by default, and a finished
  feature's flag is deleted ([ADR-0108](docs/adr/0108-every-change-reaches-main-through-a-pull-request-and-nobody-pushes-to-it.md)). M1 shipped without any: its
  seven flags and the registry that read them were deleted in S12 ([ADR-0084](docs/adr/0084-the-seven-m1-flags-are-deleted-one-by-one-the-page-ignores-what-they-leave-and-the-first-run-always-asks.md)),
  and the page does not read `?ff=` or `localStorage['rmq.flags']` any more. A flag for M2 is added again with an ADR
  that says how it is read, and a test that fails if its default is on.
- **The conformance fixtures are never updated blindly.** The nightly job fails on any difference from the recorded
  behaviour of RabbitMQ 4.3. A person reviews a re-recorded fixture and commits it, and a rule that a fixture disproves
  gets a superseding ADR.
  - To record, run the **Nightly** workflow by hand with `mode` set to `record`, or run
    `CONFORMANCE_MODE=record npm run test:conformance` in `web/` on a machine that has Docker. Nothing is recorded on
    any other broker: the manifest has to name the pinned image, and an offline spec fails otherwise.
  - The workflow uploads the fixtures as an artifact, and also prints them in its log. If you cannot download the
    artifact, save the log and run `npx tsx tools/conformance/dump.ts restore <log> fixtures/conformance/4.3`. It
    rebuilds the files byte for byte, and refuses any file whose SHA-256 differs from the one the job printed. The
    output of `gh run view <run> --log --job <job>` works as it is. The whole set is about 250 KB of log.
- **The container builds what Pages serves.** The `Dockerfile` runs `npm run build:pages` and the bundle check of CI, and
  `web/tools/repo/docker.spec.ts` fails if the two drift apart. The CI job **Container** builds the image of every
  change, starts it, and runs the smoke test of the live site against it
  ([ADR-0112](docs/adr/0112-docker-compose-up-at-the-root-builds-the-pages-build-and-serves-it-with-nginx-as-a-user-that-is-not-root.md)).
  To try it locally, stamp the image with the commit, since the smoke test reads it at the foot of the home:
  `GITHUB_SHA=$(git rev-parse HEAD) docker compose up -d --build --wait` at the root, then
  `LIVE_URL=http://localhost:8080/ EXPECTED_COMMIT=$(git rev-parse HEAD) npm run test:e2e` in `web/`.
- **The broker's files in `web/fixtures/import` were exported by RabbitMQ itself**
  ([ADR-0111](docs/adr/0111-a-definitions-file-is-imported-into-the-open-canvas-and-replaces-what-it-has-in-one-change-that-undo-takes-back.md)).
  `web/tools/import/declare-broker-fixture.sh` says how to record them again.

## Reporting bugs and proposing features

Open a [GitHub issue](https://github.com/RafaelJCamara/RabbitMqPlayground/issues). For a bug, include the steps, what you
expected, and what happened. For routing behaviour, say which RabbitMQ version you compared against.

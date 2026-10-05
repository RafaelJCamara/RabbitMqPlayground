# ADR-0018: Workspace layout and dependency rules

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

Several accepted decisions are really rules about *who may import what*:

- the engine is a separate library with no Angular or DOM imports
  ([ADR-0005](0005-frontend-angular.md)), and it must be deterministic
  ([ADR-0007](0007-deterministic-simulation-engine.md));
- Foblex Flow sits behind one adapter ([ADR-0016](0016-node-editor-library.md));
- coverage gates differ per layer ([ADR-0015](0015-testing-strategy-and-definition-of-done.md)).

We commit straight to `main` with no review step ([ADR-0004](0004-trunk-based-development-on-main.md)), so a rule that
depends on a reviewer noticing a bad import in a diff would not last. These rules need tools that enforce them.

The M1 plan also has to say where the Angular workspace lives. The repository root already holds `docs/` and
`.github/`, and may one day hold a .NET API ([ADR-0006](0006-client-only-app-dotnet-api-when-needed.md)).

## Decision

### Layout

```
/                       docs/  .github/  .claude/  LICENSE  README.md  CONTRIBUTING.md  lefthook.yml  .nvmrc
/web                    the npm and Angular workspace
  projects/engine       @rmq/engine        routing, scheduler, dispatch, PRNG, events (pure TypeScript)
  projects/domain       @rmq/domain        document, validation, commands, history, parser, reconcile, layout
  projects/persistence  @rmq/persistence   repository, migrations, files, share codec, definitions export
  projects/testing      @rmq/testing       builders and fast-check arbitraries, for tests only
  projects/app          the Angular application
  e2e/                  Playwright specs, page objects, helpers
  tools/                conformance runner, command-reference generator, bench runner, scripts
  fixtures/             conformance, schema and share-link fixtures
/api                    reserved for an ASP.NET Core API; not created until one is needed
```

- The Angular workspace lives in `web/`. The repository root stays free of tool configuration for the app.
- **Libraries are plain TypeScript folders.**
  - A library's public API is its entry point, `projects/<name>/src/index.ts`.
  - It is reached through a `paths` alias (`@rmq/<name>`) declared once in `web/tsconfig.base.json`.
  - There is no ng-packagr, no publish step and no build order. The app compiles libraries from source.
  - `tsc -b` type-checks each library separately, over composite configs with project references. A library is
    checked under its own `lib` and `types`, which is where the engine's "no DOM" rule is enforced.

### Dependency rules

| Project | May import | Bans |
|---|---|---|
| engine | nothing | every package; `window`, `document`, timers, `performance`, `crypto`, `console`; `Math.random`, `Date.now`, `new Date`. `lib` is `ES2023` only |
| domain | engine, zod, @dagrejs/dagre | the same global bans; no DOM lib. Ids and time are injected |
| persistence | domain, engine, idb | `@angular/*`, `rxjs`, `@foblex/*` |
| app | the libraries' entry points | only `canvas/flow/**` may import `@foblex/*`. No deep imports |
| testing | engine, domain, fast-check | may only be imported from specs, `e2e/` and `tools/` |

Further rules:

- **No deep imports.** Code outside a library imports `@rmq/<name>` and nothing below it.
- **No ambient non-determinism in the engine or the domain.** Time, ids and randomness are inputs: a clock function,
  an id generator, and a seeded PRNG. They are never read from the environment.
- **Foblex Flow** is pinned to an exact version. Only `projects/app/src/app/canvas/flow/**` imports `@foblex/*`. The
  one exception is the global theme stylesheet, which is SCSS and lives in its own file.
- **Components are `OnPush`.** That is Angular 22's default. The app does not opt out with
  `ChangeDetectionStrategy.Eager`.

### Enforcement

1. **`tsc`.** The engine and the domain compile with `lib: ["ES2023"]` and `types: []`, so DOM and Node globals do not
   exist for them.
2. **ESLint** (flat config), with `no-restricted-imports`, `no-restricted-globals`, `no-restricted-properties` and
   `no-restricted-syntax`. A spec lints sample code at each project path and expects the exact rule to fire, so
   loosening a rule fails a test.
3. **This ADR.** Changing a rule in the table needs a new ADR that supersedes this one.

### Coverage gates

These extend [ADR-0015](0015-testing-strategy-and-definition-of-done.md). Statements, branches, functions and lines
must each reach the threshold.

| Project | Threshold | Enforced by |
|---|---|---|
| engine | 95% | Vitest `coverage.thresholds` |
| domain | 95% | Vitest `coverage.thresholds` |
| persistence | 85% | Vitest `coverage.thresholds` |
| app | 85% | `ng test --coverage` |

- The Foblex adapter (`canvas/flow/**`) is left out of unit coverage and is covered by the end-to-end and contract
  suites instead.
- `@rmq/testing` and `tools/` have tests but no threshold.
- Both coverage runs happen in the pre-push hook and in CI. A threshold is never lowered to get a commit through.

### Toolchain

- Node `^22.22.3 || >=24.15.0`, declared in `engines` with `engine-strict`. This is the Angular CLI 22.2 requirement.
  `.nvmrc` holds `24`, and CI reads it.
- TypeScript is kept inside the range the Angular compiler supports. `strict` and `noUncheckedIndexedAccess` are on.
- `package-lock.json` is committed, and CI installs with `npm ci`.

## Consequences

### Positive

- The boundaries that matter (portability of the engine, the Foblex adapter, the test-only library) are checked by
  machines on every push, not by memory.
- The engine can move to a Web Worker or run in Node without surprises, because it cannot reach for a browser global.
- Libraries are tested in isolation, in Node, with their own thresholds.
- No packaging overhead: there is nothing to build, version or publish between the app and its libraries.

### Negative / trade-offs

- Libraries are compiled twice: once by `tsc -b` and once inside the app. The cost is small.
- The aliases exist in `tsconfig.base.json` and must also reach Vitest. Vitest reads them from the same file, and a
  test checks that.
- Lint rules are syntactic. They stop mistakes, not a determined bypass such as reading `Date` through a computed
  property. Property tests (same seed, same events) catch behavioural non-determinism.
- Two TypeScript programs means a library error can show up in `tsc -b` and in `ng build`, with different wording.

## Alternatives considered

- **The Angular workspace at the repository root.** Rejected: it mixes app tooling with docs, workflows and a possible
  .NET API.
- **ng-packagr libraries or npm workspaces.** Rejected: they add a build order and package versions for code that is
  never published, and slow feedback.
- **Nx or a similar monorepo tool.** Rejected: four small libraries do not need a task graph, and ESLint plus `tsc`
  enforce the same rules with one tool fewer.
- **One project with folders and lint rules only.** Rejected: the engine's "no DOM" rule cannot be checked at the
  type level, and per-library coverage and test environments would not exist.

## Related

- [ADR-0004](0004-trunk-based-development-on-main.md), [ADR-0005](0005-frontend-angular.md),
  [ADR-0006](0006-client-only-app-dotnet-api-when-needed.md),
  [ADR-0007](0007-deterministic-simulation-engine.md),
  [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0016](0016-node-editor-library.md)
- [M1 plan, section 1](../plans/m1.md)

# RabbitMQ Playground

[![CI](https://github.com/RafaelJCamara/RabbitMqPlayground/actions/workflows/ci.yml/badge.svg)](https://github.com/RafaelJCamara/RabbitMqPlayground/actions/workflows/ci.yml)
[![Nightly](https://github.com/RafaelJCamara/RabbitMqPlayground/actions/workflows/nightly.yml/badge.svg)](https://github.com/RafaelJCamara/RabbitMqPlayground/actions/workflows/nightly.yml)

A browser-based, visual RabbitMQ playground for **learning**, **teaching and presenting**, and **designing
topologies**. Build a topology of producers, exchanges, queues and consumers, send messages through it, and see why each
message went where it did.

It aims to give what users of earlier RabbitMQ simulators asked for:
a canvas that fills the window, explicit and discoverable linking, undo, the **headers exchange**, routing explanations,
and behaviour that is checked against a real broker.

**Live site:** <https://www.rabbitmqplayground.com/>

> **Status: M1 ("Build & route") is released as [`v0.1.0`](https://github.com/RafaelJCamara/RabbitMqPlayground/releases/tag/v0.1.0)** and deployed. Two things were not checked and are not claimed: a manual pass with a screen reader
> ([#20](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/20)) and the frame rate on a mid-range
> laptop ([#21](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/21)). What is checked is in
> [docs/accessibility.md](docs/accessibility.md) and [docs/performance.md](docs/performance.md), and the release notes are
> [docs/releases/v0.1.0.md](docs/releases/v0.1.0.md).

## Not affiliated with Broadcom or RabbitMQ

RabbitMQ Playground is an independent, community project. It is **not affiliated with, endorsed by or sponsored by
Broadcom Inc. or the RabbitMQ project**. RabbitMQ is a trademark of Broadcom Inc. and/or its subsidiaries. The project
has no logo, and its name is kept in one place so it can be changed.

## What it does

In short:

- direct, fanout, topic and **headers** exchanges, with RabbitMQ 4.3 semantics;
- five ways to link things, a command bar, and an equivalent command shown for every gesture;
- a deterministic simulation with an explanation for every routing decision;
- multiple canvases saved in your browser, share links and `definitions.json` export, with no server and no account.

## Getting started

You need **Node.js 24.15 or later** (or 22.22.3 or later). The `.nvmrc` file selects Node 24 for `nvm` and CI.

```sh
cd web
npm ci            # installs dependencies and the git hooks
npm start         # dev server at http://localhost:4200
```

Everyday commands, all run from `web/`:

| Command | What it does |
|---|---|
| `npm run lint` | ESLint, including the dependency rules between libraries |
| `npm run format:check` | Prettier check (`npm run format` fixes) |
| `npm run typecheck` | `tsc -b` over the library, test and tool projects |
| `npm run test:libs` | Vitest for the libraries and tools (`test:libs:coverage` adds the coverage gates) |
| `npm run test:app` | Angular component tests (`test:app:coverage` adds the coverage gate) |
| `npm run build:dev` | development build, which also type-checks the app templates |
| `npm run build:pages` | production build for GitHub Pages, at the root base path (`/`), because the site is served from its own domain |
| `npm run build:e2e` + `npm run test:e2e` | production-like build with the debug handle, then Playwright and axe |
| `npm run docs:check` | fails if `docs/commands.md` is out of date |
| `npm run bench` | engine micro-benchmarks, with a check for gross regressions |
| `npm run test:conformance` | runs the conformance scenarios against a real RabbitMQ (needs Docker) |

## Repository layout

```
docs/       plans (docs/plans), accessibility and performance notes, generated command reference
web/        the npm and Angular workspace
  projects/engine, domain, persistence, testing   plain TypeScript libraries (@rmq/*)
  projects/app                                     the Angular application
  e2e/  tools/  fixtures/                          Playwright specs, scripts and the conformance runner, golden fixtures
.github/    CI, the nightly conformance run, Dependabot
```

## How we work

- **Decisions are written down.** Significant changes come with an ADR (architecture decision record) in
  [`docs/adr`](docs/adr/README.md).
- **Every change is a pull request.** Nobody, maintainers included, commits straight to `main`. A pull request needs the
  CI checks to pass, a review from the code owner and every conversation resolved. Before that, a pre-push hook runs the
  checks on your machine, and a nightly conformance run compares the simulator with a real RabbitMQ. A feature of a
  later milestone sits behind a feature flag until it ships; M1 has none left.
- **The plan** for M1 is in [`docs/plans/m1.md`](docs/plans/m1.md).

## Contributing

Contributions are welcome, and there is **no CLA**. Read [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE).

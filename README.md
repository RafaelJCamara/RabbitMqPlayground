# RabbitMQ Playground

[![CI](https://github.com/RafaelJCamara/RabbitMqPlayground/actions/workflows/ci.yml/badge.svg)](https://github.com/RafaelJCamara/RabbitMqPlayground/actions/workflows/ci.yml)
[![Nightly](https://github.com/RafaelJCamara/RabbitMqPlayground/actions/workflows/nightly.yml/badge.svg)](https://github.com/RafaelJCamara/RabbitMqPlayground/actions/workflows/nightly.yml)

A browser-based, visual RabbitMQ playground for **learning**, **teaching and presenting**, and **designing
topologies**. Build a topology of producers, exchanges, queues and consumers, send messages through it, and see why each
message went where it did.

It is inspired by [tryrabbitmq.com](https://tryrabbitmq.com), and aims to be better in the ways its users asked for:
a canvas that fills the window, explicit and discoverable linking, undo, the **headers exchange**, routing explanations,
and behaviour that is checked against a real broker.

**Live site:** <https://rafaeljcamara.github.io/RabbitMqPlayground/>

> **Status: pre-release.** The first milestone (M1, "Build & route") is being built slice by slice, and the live site
> currently shows a placeholder shell. Progress is tracked in [issue #1](https://github.com/RafaelJCamara/RabbitMqPlayground/issues/1).

## Not affiliated with Broadcom or RabbitMQ

RabbitMQ Playground is an independent, community project. It is **not affiliated with, endorsed by or sponsored by
Broadcom Inc. or the RabbitMQ project**. RabbitMQ is a trademark of Broadcom Inc. and/or its subsidiaries. The project
has no logo, and its name is kept in one place so it can be changed (see
[ADR-0020](docs/adr/0020-mit-licence.md)).

## What it will do

The scope is set in [ADR-0002](docs/adr/0002-product-vision-and-scope.md) and the roadmap in
[ADR-0003](docs/adr/0003-roadmap-and-milestones.md). In short:

- direct, fanout, topic and **headers** exchanges, with RabbitMQ 4.3 semantics
  ([ADR-0008](docs/adr/0008-rabbitmq-fidelity-baseline.md), [ADR-0009](docs/adr/0009-headers-exchange-support.md));
- five ways to link things, a command bar, and an equivalent command shown for every gesture
  ([ADR-0011](docs/adr/0011-explicit-linking-and-command-layer.md));
- a deterministic simulation with an explanation for every routing decision
  ([ADR-0007](docs/adr/0007-deterministic-simulation-engine.md), [ADR-0010](docs/adr/0010-explanation-first-editor-ux.md));
- multiple canvases saved in your browser, share links and `definitions.json` export, with no server and no account
  ([ADR-0006](docs/adr/0006-client-only-app-dotnet-api-when-needed.md)).

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
| `npm run build:pages` | production build for GitHub Pages, at the `/RabbitMqPlayground/` base path |
| `npm run build:e2e` + `npm run test:e2e` | production-like build with the debug handle, then Playwright and axe |
| `npm run docs:check` | fails if `docs/commands.md` is out of date |
| `npm run bench` | engine micro-benchmarks, with a check for gross regressions |
| `npm run test:conformance` | runs the conformance scenarios against a real RabbitMQ (needs Docker) |

## Repository layout

```
docs/       architecture decision records (docs/adr), plans (docs/plans), generated command reference
web/        the npm and Angular workspace
  projects/engine, domain, persistence, testing   plain TypeScript libraries (@rmq/*)
  projects/app                                     the Angular application
  e2e/  tools/  fixtures/                          Playwright specs, scripts and the conformance runner, golden fixtures
.github/    CI, the nightly conformance run, Dependabot
```

The libraries, and which of them may import which, are described in
[ADR-0018](docs/adr/0018-workspace-layout-and-dependency-rules.md).

## How we work

- **Decisions are written down.** Significant changes come with an ADR in [`docs/adr`](docs/adr/README.md).
- **Trunk-based development.** Maintainers commit straight to `main`, and automation replaces review: a pre-push hook,
  CI on every push, and a nightly conformance run against a real RabbitMQ
  ([ADR-0004](docs/adr/0004-trunk-based-development-on-main.md),
  [ADR-0015](docs/adr/0015-testing-strategy-and-definition-of-done.md)). Unfinished features sit behind feature flags
  that are off by default.
- **The plan** for M1 is in [`docs/plans/m1.md`](docs/plans/m1.md).

## Contributing

Contributions are welcome, and there is **no CLA**. Read [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE).

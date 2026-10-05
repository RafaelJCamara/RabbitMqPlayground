# ADR-0015: Testing strategy and definition of done

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

The product owner requires **tests at every level**, so that the source code is properly tested. We also commit
straight to `main` with no review gate ([ADR-0004](0004-trunk-based-development-on-main.md)), which makes automated
tests our main safety net. Two of the original simulator's bugs were in its core logic: a message delivered to two
consumers ([#10](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/10)) and delivery to a deleted consumer
([#18](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/18)). One was a crash on import
([#16](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/16)).

## Decision

### Definition of done

A feature is **done** only when all of the following are true:

1. Its behaviour is covered by automated tests at the right layers (see below).
2. The coverage gates pass.
3. If a user-facing flow changed, its end-to-end journey has been added or updated.
4. The accessibility checks pass.
5. The documentation is updated: the command reference, and an ADR if a decision changed.
6. CI is green on `main`.

### Test layers

| Layer | Tools | What it covers |
|---|---|---|
| **Engine unit tests** | Vitest | Truth tables for every exchange type. Every headers rule ([ADR-0009](0009-headers-exchange-support.md)). Topic edge cases (`""`, `a..b`, `#` in the middle). Dispatch with prefetch, acks and cancel vs close. Unroutable messages, alternate exchanges, `mandatory`, publisher confirms, DLX, TTL, overflow, priority, SAC, quorum queues, streams, RPC ([ADR-0008](0008-rabbitmq-fidelity-baseline.md)) |
| **Property-based tests** | fast-check | These invariants: at most one copy per queue per publish; exactly one consumer per message; conservation, meaning every published message is accounted for (queued, delivered, acked, dropped, dead-lettered or returned); determinism, meaning the same seed and commands give the same events; termination on exchange-to-exchange and dead-letter cycles |
| **Conformance tests vs a real RabbitMQ** | Vitest, Testcontainers (`rabbitmq:4.3-management`), amqplib | Generated topologies and messages run on a real broker and on the engine, and the queues each message reaches are compared. Results are committed as **golden fixtures** (`fixtures/conformance/4.3/…`) so the normal CI run needs no Docker. A **nightly** job runs against the live broker |
| **Command layer and parser** | Vitest | Every command, every error message, autocomplete, undo/redo of every command, and the equivalent command produced by each UI gesture ([ADR-0011](0011-explicit-linking-and-command-layer.md)) |
| **Persistence and sharing** | Vitest, fake-indexeddb | Schema validation. A migration test for **every** schema version. Share-link encode/decode round trips, including malicious and oversized links. `definitions.json` export/import round trips against real broker exports. Multi-canvas create/read/update/delete, clear, delete-all and undo |
| **Angular components** | Vitest, Angular Testing Library | Inspector forms, the headers binding editor, the link-target picker, the hint bar, the command bar UI, the canvas home and tabs, confirmation dialogs |
| **End-to-end journeys** | Playwright (Chromium) | Link in each of the five ways. Publish and watch delivery. The headers binding flow. Create, switch, rename, delete, clear and delete-all canvases, with undo. Open a share link in a fresh browser context and save a copy. Import and export. Templates. Run on **every push** |
| **Accessibility** | Playwright + axe-core | No serious or critical axe violations on the main screens. A complete keyboard-only journey: create → link → publish |
| **Visual regression** (M2) | Playwright screenshots | Node and edge rendering in the light and dark themes |
| **Regression suite** | Vitest / Playwright | One named test for each bug in the original simulator: `#10` double delivery, `#16` crash on import, `#18` delivery to a deleted consumer |
| **Budgets** | Angular budgets, Vitest bench | Bundle size and engine throughput, tracked in CI |

### Coverage gates

- **Engine:** at least 95% line and branch coverage.
- **App code:** at least 85% line and branch coverage. Generated code and third-party wrappers are excluded.
- Coverage gates are enforced locally and in CI. They are never lowered to get a commit through.

### Where the tests run

- **Pre-push hook:** lint, type-check, unit, property and component tests, and the coverage gates.
- **CI on every push to `main`:** everything above, plus the Playwright end-to-end and accessibility suites, then the
  deployment ([ADR-0004](0004-trunk-based-development-on-main.md)).
- **Nightly:** conformance against the live broker. Any difference from the golden fixtures fails the job and is
  investigated. Fixtures are never updated blindly.
- **No skipping.** A failing or flaky test is never skipped, disabled or quarantined to get green. The root cause is
  fixed.

### Order of work

- In M1 the **test harness and CI are built first**, before any feature code
  ([ADR-0003](0003-roadmap-and-milestones.md)).
- If a .NET API is ever added, it is tested with xUnit, `WebApplicationFactory` and Testcontainers, under the same
  gates ([ADR-0006](0006-client-only-app-dotnet-api-when-needed.md)).

## Consequences

### Positive

- We can commit straight to `main` with confidence, and regressions are caught before users see them.
- The conformance fixtures make "faithful to RabbitMQ" something we can check, not just claim.
- The deterministic engine ([ADR-0007](0007-deterministic-simulation-engine.md)) makes tests fast and reliable.

### Negative / trade-offs

- Writing tests is a significant share of the work on every feature.
- The conformance and end-to-end suites need Docker and a browser in CI, and the nightly job has to be maintained.
- High coverage gates sometimes need test seams, such as the storage repository interface and an injectable clock.

## Alternatives considered

- **Unit tests only.** Rejected: they don't cover the UI, persistence or real-broker fidelity.
- **Manual QA before releases.** Rejected: it doesn't scale, and there is no release gate when we commit to `main`.
- **Conformance against a live broker on every push.** Rejected: too slow and brittle. Golden fixtures plus a nightly
  run give the same assurance.

## Related

- [ADR-0004](0004-trunk-based-development-on-main.md): workflow and CI.
- [ADR-0007](0007-deterministic-simulation-engine.md), [ADR-0008](0008-rabbitmq-fidelity-baseline.md),
  [ADR-0011](0011-explicit-linking-and-command-layer.md)

# ADR-0014: Broker interoperability via `definitions.json` only

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

The original's import and export talked to a live broker through the management API, behind a Node server. That design
caused a run of problems:

- hard-coded `guest:guest` credentials;
- buttons hidden unless the server was configured
  ([#14](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/14));
- crashes on import ([#16](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/16));
- requests for vhost support ([#15](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/15),
  [#22](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/22)).

The product owner chose to interoperate with real brokers **only through RabbitMQ's definitions file**.

## Decision

### Export (M1)

- Produce a RabbitMQ **definitions JSON** for a **chosen vhost**, containing:
  - exchanges;
  - queues, with their arguments;
  - bindings, including headers arguments and `x-match`;
  - policies, from M3.
- The file loads through the management UI ("Import definitions") or `rabbitmqctl import_definitions`.
- Some things aren't broker objects and are **not exported**: producers, consumers, workers, layout and simulation
  settings. They live only in the native file ([ADR-0012](0012-multiple-canvases-and-local-persistence.md)).
- The export **warns about anything it can't represent**:
  - *exists* header conditions ([ADR-0009](0009-headers-exchange-support.md));
  - features that exist only in the simulator.

### Import (M2)

- Accepts files with one vhost or several. The user picks the **vhost** to import, which becomes a **new canvas**.
- The file is **schema-validated**, so unknown or malformed entries never crash the import (regression test for the
  original simulator's issue #16).
- The topology is **auto-laid-out**.
- An **import report** lists everything skipped or unsupported: users, permissions, parameters, global parameters,
  federation, shovels, topic permissions, and so on.
- Policies are imported and applied from M3.

### Vhosts and live connections

- Each canvas belongs to **one vhost**. Its name is shown and used on export. Several vhosts on one canvas come later.
- **No live connection.** The app never connects to a broker and never handles credentials. Verifying against a real
  broker is done by importing the exported file.

## Consequences

### Positive

- Works fully offline, with no credentials and no CORS or server setup.
- It's the format operators already use for configuration-as-code, so designs move straight into real environments.

### Negative / trade-offs

- There's no live check that a topology behaves the same on a real broker. Our conformance tests cover routing
  semantics instead ([ADR-0015](0015-testing-strategy-and-definition-of-done.md)).
- Some information doesn't survive the round trip: simulator-only elements, layout and *exists* conditions.

## Alternatives considered

- **Live mode through the management HTTP API (with CORS) or a backend.** Rejected by the product owner. It needs
  credentials, CORS configuration or a server ([ADR-0006](0006-client-only-app-dotnet-api-when-needed.md)).
- **A custom topology format only.** Rejected: designs could not be carried over to a real broker.

## Related

- [RabbitMQ definitions export/import](https://www.rabbitmq.com/docs/definitions)
- [ADR-0012](0012-multiple-canvases-and-local-persistence.md), [ADR-0009](0009-headers-exchange-support.md)

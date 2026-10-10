# ADR-0006: Client-only application; a .NET API only when needed

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

Every v1 feature can run in the browser:

- simulation;
- persistence ([ADR-0012](0012-multiple-canvases-and-local-persistence.md));
- self-contained share links ([ADR-0013](0013-self-contained-share-links.md));
- `definitions.json` import/export ([ADR-0014](0014-broker-interop-via-definitions-json.md)).

Earlier simulators needed a Node server for broker import/export, with the hard-coded login `guest:guest`. Their
users ran into server-setup trouble:

- the import and export buttons were hidden unless environment variables were set;
- pull requests were opened for Cloud Foundry, port, management-config and path settings.

The product owner's rule is: **if an API is needed, it will be .NET.**

## Decision

- **v1 is a static, client-only single-page app.**
  - There is no backend, no database, no accounts, and no analytics or tracking.
  - Users' data stays in their browser, or in the links and files they create.
- **Hosting.** The app is served from **GitHub Pages**, deployed automatically from a green `main`
  ([ADR-0004](0004-trunk-based-development-on-main.md)).
  - It needs no runtime configuration and no credentials.
  - After the first visit it works offline, through a service worker (M2).
- **If an API ever becomes necessary,** it will be **ASP.NET Core** on the current .NET LTS, deployed separately and
  recorded in a new ADR. Candidates are short share links, cloud-saved canvases and accounts.
  - The client keeps working without it: the API is a progressive enhancement, never a requirement.
  - The API is tested to the same bar, using xUnit, `WebApplicationFactory` and Testcontainers
    ([ADR-0015](0015-testing-strategy-and-definition-of-done.md)).

## Consequences

### Positive

- No hosting cost, no operations, no secrets to manage, and private by default.
- Once loaded, the app works anywhere, including offline and in classrooms with poor network.
- It removes a whole class of the issues of earlier simulators, such as server configuration and hard-coded credentials.

### Negative / trade-offs

- No sync between devices. Users move canvases with share links, files and backups.
- Share links can get long for big canvases ([ADR-0013](0013-self-contained-share-links.md)).
- Browser storage can be evicted. We mitigate this by asking for persistent storage and offering backups
  ([ADR-0012](0012-multiple-canvases-and-local-persistence.md)).

## Alternatives considered

- **An ASP.NET Core backend from day one.** Rejected: no v1 feature needs it, and it adds hosting, operations and
  security work.
- **A Node server, as earlier simulators had.** Rejected for the same reasons, and it would bring back their
  credential and configuration problems.

## Related

- [ADR-0013](0013-self-contained-share-links.md): share links, and short links as a future option.
- [ADR-0014](0014-broker-interop-via-definitions-json.md): broker interop without a server.

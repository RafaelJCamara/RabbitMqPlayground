# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

RabbitMQ Playground starts from an empty repository. Planning has already settled a lot: the product scope, the stack,
the git workflow, the testing bar and how faithfully we follow RabbitMQ. Those decisions need a permanent home next to
the code that records *why* each was made. That way, future contributors (and future us) can build on them instead of
re-arguing them.

The project we're replacing, the original RabbitMQ Simulator, shows the cost of not doing this. Its tracker includes
"Is this project was abandoned?" ([#12](https://github.com/RabbitMQSimulator/RabbitMQSimulator/issues/12)), and
long-standing feature requests got no recorded answer.

## Decision

- Record every significant decision as an **Architecture Decision Record** in `docs/adr/`.
- Use a lightweight [MADR](https://adr.github.io/madr/)-style format:
  - Header fields: status, date, deciders.
  - Sections: *Context*, *Decision*, *Consequences*, *Alternatives considered*, *Related*.
  - New records start from [`template.md`](template.md).
- Number files sequentially with four digits: `NNNN-kebab-case-title.md`. Numbers are never reused.
- Status lifecycle: **Proposed → Accepted / Rejected → (Superseded by ADR-NNNN)**.
  - An accepted ADR is not rewritten. A changed decision gets a new ADR that supersedes the old one.
  - Fixing a typo or a broken link is allowed.
- A decision is **significant** if it does any of the following:
  - changes the structure, dependencies, interfaces or quality attributes (performance, accessibility, security,
    testability);
  - changes product scope;
  - would be expensive to reverse.
- ADRs follow the same workflow as code ([ADR-0004](0004-trunk-based-development-on-main.md)). The index in
  [`README.md`](README.md) is updated in the same commit.
- If a change contradicts an accepted ADR, it must come with a new ADR that supersedes it.

## Consequences

### Positive

- Decisions and their reasons are versioned with the code and easy to find.
- New contributors can get up to speed from `docs/adr/` alone.
- Scope discussions point at a record instead of chat history.

### Negative / trade-offs

- Writing an ADR adds a small amount of work to significant changes.
- The index must be kept in sync by hand.

## Alternatives considered

- **A wiki or an external document.** Rejected: it drifts away from the code and isn't reviewed with it.
- **Decisions only in commit messages or code comments.** Rejected: too scattered to read as a whole.
- **No formal record.** Rejected for the reasons above.

## Related

- [ADR index](README.md)
- [ADR-0004](0004-trunk-based-development-on-main.md): the workflow that ADRs follow.

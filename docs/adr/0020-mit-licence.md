# ADR-0020: MIT licence

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** @RafaelJCamara

## Context

The repository needs a licence before anyone else can legally use or contribute to it. Two earlier decisions point the
same way:

- Contribution has to be easy: pull requests from forks, and **no CLA** ([ADR-0004](0004-trunk-based-development-on-main.md)).
  The original simulator's contributions stalled on a CLA ([ADR-0002](0002-product-vision-and-scope.md)).
- The app is meant to be used in classrooms and talks, and to be embedded in other pages (M5). A licence that
  restricts how it can be reused would work against that.

Our main dependencies (Angular, Foblex Flow, RxJS, Tailwind CSS, Playwright, Vitest) are all under permissive licences,
so a permissive licence for our own code has no conflicts.

"RabbitMQ" is a trademark of Broadcom Inc. and/or its subsidiaries. A copyright licence does not grant trademark
rights, and this project is not affiliated with Broadcom or the RabbitMQ project.

## Decision

- **The repository is licensed under the MIT licence.** The full text is in `LICENSE` at the repository root, with the
  copyright line "Copyright (c) 2026 Rafael Câmara and the RabbitMQ Playground contributors".
- `package.json` declares `"license": "MIT"`.
- **No CLA, and no sign-off requirement.** Contributions are accepted under the same licence, on an "inbound equals
  outbound" basis. This is how GitHub's Terms of Service treat contributions to a repository that carries a licence
  notice. `CONTRIBUTING.md` says so.
- **Trademarks are not licensed.**
  - The README states that the project is not affiliated with, endorsed by or sponsored by Broadcom or the RabbitMQ
    project, and that RabbitMQ is a trademark of Broadcom Inc. and/or its subsidiaries.
  - The project has no logo.
  - The product name is kept in a single constant in the app, so it can be changed in one place. The name is revisited
    before any public promotion.
- **Dependencies must carry licences compatible with MIT** (MIT, BSD, ISC, Apache-2.0 and similar). A new dependency
  with a copyleft or unusual licence needs an ADR.

## Consequences

### Positive

- Anyone can use, copy, modify, embed and redistribute the app and its libraries, including the engine, with almost no
  conditions. That suits teaching and embedding.
- Contributors need no paperwork, which removes the friction the original project suffered from.
- It is short and widely understood, so there is little to explain.

### Negative / trade-offs

- There is no patent grant, which Apache-2.0 would give.
- Anyone may build a closed fork. The licence cannot prevent that.
- The licence gives no protection for the name. If the name becomes a problem, the project is renamed
  ([ADR-0002](0002-product-vision-and-scope.md) keeps the name in one constant for this reason).

## Alternatives considered

- **Apache-2.0.** A patent grant and an explicit contribution clause are real benefits, but they are not needed for a
  project of this kind, and the text is longer and less familiar to casual contributors.
- **GPL or AGPL.** Rejected: copyleft would discourage embedding in courses, slides and other sites.
- **MPL-2.0.** Rejected: file-level copyleft adds rules for contributors without a matching benefit.
- **No licence ("all rights reserved").** Rejected: nobody could legally use or contribute to the code.
- **A CLA with a permissive licence.** Rejected in [ADR-0004](0004-trunk-based-development-on-main.md).

## Related

- [ADR-0002](0002-product-vision-and-scope.md), [ADR-0004](0004-trunk-based-development-on-main.md)
- [MIT licence text](https://opensource.org/license/mit)
- [GitHub Terms of Service, D.6 "Contributions Under Repository License"](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#6-contributions-under-repository-license)

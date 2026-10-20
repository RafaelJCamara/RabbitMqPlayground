# ADR-0112: `docker compose up` at the root builds the Pages build and serves it with nginx, as a user that is not root

- **Status:** Accepted
- **Date:** 2026-10-20
- **Deciders:** @RafaelJCamara
- **Extends:** [ADR-0006](0006-client-only-app-dotnet-api-when-needed.md) (the app is static files, and stays so in a container) and [ADR-0109](0109-the-foot-of-the-home-says-which-commit-the-build-is-of-and-the-page-itself-carries-it.md) (the container's build names its commit, or `local`).

## Context

- The playground is deployed to GitHub Pages on every merge (ADR-0015). To run it anywhere else, a person needed Node.js, the workspace, and the build, and then a static server of their own that answers as Pages does.
- The request: "a dockerizable system so we could run the playground as a docker image. Ideally, someone would just go to the root level and do `docker compose up -d`."
- The maintainer chose a static server (nginx) and a compose file with the playground only: no RabbitMQ broker, since the app never talks to one (ADR-0014).
- The app has no back end, no router and no service worker. `npm run build:pages` makes the site at the root path (`/`), with its content security policy in a `<meta>` (ADR-0078), `404.html` as a copy of `index.html`, `build-info.json`, and the commit in the page (ADR-0109). GitHub Pages sends no headers of our choosing, so the page cannot forbid being framed (a known limit of v0.1.0).

## Decision

- **`Dockerfile` at the root, in two stages.**
  - **Build:** `node:24-bookworm-slim` (the major version of `.nvmrc`), `npm ci --ignore-scripts` (the only script that a build meets installs the git hooks of lefthook, and there is no repository in the image), then `npm run build:pages` and the bundle check of CI (`tools/pages/check-bundle.ts` with the same words), so that the image serves what Pages serves.
  - **Serve:** `nginxinc/nginx-unprivileged:1.30-alpine`, which runs nginx as the user `nginx` (101) on port 8080, with the files of `web/dist/app/browser` and `docker/nginx.conf`. A health check asks for `/build-info.json`.
  - **The commit** is the build argument `GITHUB_SHA`, `local` when it is not given, which the postbuild step puts in the page (ADR-0109): the foot of the home says "Build local", or the short hash with its link.
- **`docker-compose.yml` at the root** has one service, `playground`, built from the root, published on `${PLAYGROUND_PORT:-8080}`, restarted unless stopped, with a read-only file system (only `/tmp` is written, as a tmpfs), every capability dropped, and no new privileges. `docker compose up -d` builds the image the first time and serves it at `http://localhost:8080`; `--build` builds it again after a pull.
- **`docker/nginx.conf`** answers as GitHub Pages does: a path that is not a file gets `404.html` with the status 404, so that the app loads. The hashed files (`main-…js`, `chunk-…js`, `styles-…css`) are kept for a year as immutable; everything else is `no-cache`, so a new build is seen at once. It compresses text, hides its version, and sends the headers that Pages cannot: `Content-Security-Policy: frame-ancestors 'none'` (only that: a header policy applies together with the page's own, which stays the one for scripts and styles), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- **What is not sent to the build** is in `.dockerignore`: the repository, `node_modules`, and what building and testing leave in `web/`, and `docs/`.
- **The canvases stay in the browser.** The container keeps nothing; stopping, removing or rebuilding it loses no canvas. A canvas kept at `http://localhost:8080` is not the one kept on the live site, which is another origin.
- **CI builds and checks it.** The job **Container** of `ci.yml` runs on every change that is not only documentation: it builds the image with the commit, starts it with `--wait` (which waits for the health check), and runs the smoke test of the live site (`e2e/live.spec.ts`) against it: the commit in `build-info.json`, the app without the debug handle and with no error in its console, the commit at the foot of the home, and a deep link through `404.html`. It is not a required check of the ruleset of `main` (ADR-0108); the maintainer may make it one.
- **`web/tools/repo/docker.spec.ts`** holds the files together without Docker: the Dockerfile builds with `build:pages` and never `build:e2e`, guards the same words as CI, uses the Node of `.nvmrc`, serves as a user that is not root on the port that compose publishes, stamps the commit, sends a header policy that only forbids framing, answers a missing path with `404.html`, and keeps the repository and `node_modules` out of the build.
- **Line endings:** `.gitattributes` keeps LF for the Dockerfile, the compose file, `.dockerignore`, `docker/**` and shell scripts, whatever `core.autocrlf` says.
- **Dependabot** watches the two base images; Node stays on its major version, as `.nvmrc` says.
- **Not done:** an image published to a registry (GitHub Container Registry), a tag that names a release, and HTTPS in the container. A person who serves it beyond their machine puts it behind a proxy of their own.

## Consequences

### Positive

- One command, with only Docker, gives the playground on any machine, offline after the build.
- The image serves the bytes that CI makes for Pages, checked by the same guard, and the smoke test of the live site runs on it for every change.
- Behind nginx, the page can forbid framing, which Pages could not do.

### Negative / trade-offs

- The first `docker compose up` installs the dependencies and builds the app in the container, which takes about a minute and needs the network.
- Another job in CI, a few minutes long.
- The base images have to be kept up to date; Dependabot opens the pull requests, and a person merges them.
- A canvas made in the container's playground lives in that browser for `localhost:8080`, and has to be moved as a file or a backup to reach the live site, or another port.

## Alternatives considered

- **Copy a `dist/` built on the host into the image.** Smaller to build, but the person needs Node.js and the workspace, which is what the request wanted to spare them.
- **Serve with a Node server** (the `tools/pages/serve.ts` of the tests, or `npx serve`). A bigger image with a runtime that the site does not need, and a server that is made for tests.
- **Put a RabbitMQ broker in the compose file.** The app never connects to a broker (ADR-0014); a definitions file is what moves between them.
- **Publish the image to a registry on each tag.** Possible later; it needs a decision about names, tags and who may pull, and nothing here is in its way.

## Related

- [ADR-0006](0006-client-only-app-dotnet-api-when-needed.md), [ADR-0014](0014-broker-interop-via-definitions-json.md), [ADR-0015](0015-testing-strategy-and-definition-of-done.md), [ADR-0078](0078-a-link-is-made-from-the-canvas-as-it-is-a-shared-canvas-opens-in-an-editor-that-keeps-nothing-and-its-text-is-only-text-under-a-policy.md), [ADR-0108](0108-every-change-reaches-main-through-a-pull-request-and-nobody-pushes-to-it.md), [ADR-0109](0109-the-foot-of-the-home-says-which-commit-the-build-is-of-and-the-page-itself-carries-it.md).
- Files: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `docker/nginx.conf`, `.gitattributes`, `.github/workflows/ci.yml` (job `docker`), `.github/dependabot.yml`.
- Tests: `web/tools/repo/docker.spec.ts`, `web/e2e/live.spec.ts` (run against the container by CI).

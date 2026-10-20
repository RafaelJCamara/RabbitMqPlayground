# syntax=docker/dockerfile:1
# RabbitMQ Playground in a container (ADR-0112). The app is static files: the first stage builds them as the deploy to GitHub Pages does
# (`npm run build:pages`), and the second serves them with nginx, as a user that is not root. `docker compose up -d` at the root builds and runs it.

FROM node:24-bookworm-slim AS build
WORKDIR /app/web

# The dependencies first, so that a change to the code does not install them again. The scripts are not run: the only one that a build would
# meet installs the git hooks of lefthook, and there is no repository in here.
COPY web/package.json web/package-lock.json web/.npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY web/ ./

# The commit that the foot of the home names (ADR-0109): a hash, or "local", which says that the build is of no commit of the repository.
ARG GITHUB_SHA=local
ARG GITHUB_REF_NAME=local
ENV GITHUB_SHA=${GITHUB_SHA} GITHUB_REF_NAME=${GITHUB_REF_NAME}

# The same build and the same guard as CI: the bundle that is served has no debug handle of the end-to-end build.
RUN npm run build:pages \
  && npx tsx tools/pages/check-bundle.ts dist/app/browser __rmq RMQ_E2E drawnEdges simulationState overlayFrame explainEventLog explainEmphasis

FROM nginxinc/nginx-unprivileged:1.30-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist/app/browser /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/build-info.json || exit 1

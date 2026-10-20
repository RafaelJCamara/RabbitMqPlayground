import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The container (ADR-0112) builds the app as CI builds it for GitHub Pages, so these hold the two together: a change to one that the other does not
 * follow fails here, and not in an image that someone runs. They read the files; the image itself is built and run by the job `docker` of CI.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string): string => readFileSync(`${root}${path}`, 'utf8');

const dockerfile = read('Dockerfile');
const ci = read('.github/workflows/ci.yml');
const nginx = read('docker/nginx.conf');
const compose = read('docker-compose.yml');
const ignored = read('.dockerignore').split(/\r?\n/);

/** The words that the bundle guard looks for, in the order given: `check-bundle.ts <dist> word word…`. */
function guardedWords(text: string): string[] {
  const words = /check-bundle\.ts\s+\S+\s+([^\n\\]+)/.exec(text)?.[1];
  if (words === undefined) {
    throw new Error('no call of check-bundle.ts');
  }
  return words.trim().split(/\s+/);
}

describe('the container (ADR-0112)', () => {
  it('builds the app with the script of the deploy to Pages, which is at the root path, and not with the build of the end-to-end tests', () => {
    expect(dockerfile).toContain('RUN npm run build:pages');
    expect(dockerfile).not.toContain('build:e2e');
    expect(ci).toContain('run: npm run build:pages');
    expect(dockerfile).toContain('COPY --from=build /app/web/dist/app/browser /usr/share/nginx/html');
  });

  it('guards the bundle that it serves against the same debug handles as CI does', () => {
    expect(guardedWords(dockerfile)).toEqual(guardedWords(ci));
    expect(guardedWords(dockerfile)).toContain('__rmq');
  });

  it('builds with the major version of Node that .nvmrc names', () => {
    const major = read('.nvmrc').trim();

    expect(/^FROM node:(\d+)-/m.exec(dockerfile)?.[1]).toBe(major);
  });

  it('serves as a user that is not root, on the port that compose publishes', () => {
    expect(dockerfile).toMatch(/^FROM nginxinc\/nginx-unprivileged:/m);
    expect(dockerfile).toContain('EXPOSE 8080');
    expect(nginx).toMatch(/^\s*listen 8080;/m);
    expect(compose).toContain('"${PLAYGROUND_PORT:-8080}:8080"');
  });

  it('stamps the build with the commit it is given, and with "local" when it is given none (ADR-0109)', () => {
    expect(dockerfile).toContain('ARG GITHUB_SHA=local');
    expect(dockerfile).toMatch(/^ENV GITHUB_SHA=\$\{GITHUB_SHA\}/m);
    expect(compose).toContain('GITHUB_SHA: ${GITHUB_SHA:-local}');
  });

  it('sends a header policy that only forbids framing, so that the policy of the page (ADR-0078) is the one for scripts and styles', () => {
    const policies = [...nginx.matchAll(/add_header Content-Security-Policy "([^"]*)"/g)].map((match) => match[1]);

    expect(policies).toEqual(["frame-ancestors 'none'"]);
  });

  it('answers a path that is not a file with 404.html, as GitHub Pages does', () => {
    expect(nginx).toContain('try_files $uri $uri/ =404;');
    expect(nginx).toContain('error_page 404 /404.html;');
  });

  it('does not send the repository, the dependencies or what builds and tests leave to the build', () => {
    for (const path of ['.git', '**/node_modules', 'web/dist', 'web/.angular', 'web/coverage', 'web/test-results']) {
      expect(ignored).toContain(path);
    }
  });
});

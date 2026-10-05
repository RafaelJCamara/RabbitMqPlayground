import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';

/**
 * A static file server that behaves like GitHub Pages for a project site, so that end-to-end tests meet the same
 * rules the deployed app does:
 *
 * - the site lives under a base path (`/RabbitMqPlayground/`), and nothing outside it exists;
 * - `/RabbitMqPlayground` redirects to `/RabbitMqPlayground/`;
 * - a path with no file gets `404.html`, with status 404. That is how a single-page app's deep links load on Pages.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

export interface PagesServerOptions {
  /** The directory that holds the built site: `index.html`, `404.html` and the assets. */
  root: string;
  /** The path the site is served under, for example `/RabbitMqPlayground/`. */
  basePath: string;
}

export function normaliseBasePath(basePath: string): string {
  return `/${basePath.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
}

export function createPagesServer({ root, basePath }: PagesServerOptions): Server {
  const base = normaliseBasePath(basePath);
  const rootDir = resolve(root);

  return createServer((request, response) => {
    const headOnly = request.method === 'HEAD';
    const sendFile = (status: number, file: string) => {
      response.writeHead(status, {
        'cache-control': 'no-store',
        'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      });
      if (headOnly) {
        response.end();
      } else {
        createReadStream(file).pipe(response);
      }
    };
    const sendText = (status: number, text: string, headers: Record<string, string> = {}) => {
      response.writeHead(status, {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
        ...headers,
      });
      response.end(headOnly ? undefined : text);
    };
    const notFound = () => {
      const page = join(rootDir, '404.html');
      if (existsSync(page)) {
        sendFile(404, page);
      } else {
        sendText(404, 'File not found');
      }
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(405, 'Method not allowed', { allow: 'GET, HEAD' });
      return;
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      sendText(400, 'Bad request');
      return;
    }

    if (base !== '/' && pathname === base.slice(0, -1)) {
      sendText(301, '', { location: base });
      return;
    }
    if (!pathname.startsWith(base)) {
      sendText(404, "There isn't a GitHub Pages site here.");
      return;
    }

    const candidate = join(rootDir, normalize(pathname.slice(base.length)));
    // `..` segments must not climb out of the site.
    if (candidate !== rootDir && !candidate.startsWith(rootDir + sep)) {
      notFound();
      return;
    }

    const file = existsSync(candidate) && statSync(candidate).isDirectory() ? join(candidate, 'index.html') : candidate;
    if (existsSync(file) && statSync(file).isFile()) {
      sendFile(200, file);
    } else {
      notFound();
    }
  });
}

export interface RunningPagesServer {
  /** The URL of the site's front page, base path included, with a trailing slash. */
  readonly url: string;
  close(): Promise<void>;
}

export async function startPagesServer(
  options: PagesServerOptions & { port?: number; host?: string },
): Promise<RunningPagesServer> {
  const server = createPagesServer(options);
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, resolveListening);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://${host}:${port}${normaliseBasePath(options.basePath)}`,
    close: () =>
      new Promise<void>((resolveClosed, reject) => {
        server.close((error) => (error ? reject(error) : resolveClosed()));
        server.closeAllConnections();
      }),
  };
}

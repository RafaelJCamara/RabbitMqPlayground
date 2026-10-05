import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normaliseBasePath, startPagesServer, type RunningPagesServer } from './static-server';

let workDir: string;
let server: RunningPagesServer;
let origin: string;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'pages-server-'));
  const site = join(workDir, 'site');
  mkdirSync(join(site, 'assets'), { recursive: true });
  writeFileSync(join(site, 'index.html'), '<h1>index</h1>');
  writeFileSync(join(site, '404.html'), '<h1>not found page</h1>');
  writeFileSync(join(site, 'main.js'), 'console.log(1)');
  writeFileSync(join(site, 'styles.css'), 'a{}');
  writeFileSync(join(site, 'assets', 'index.html'), '<h1>assets index</h1>');
  writeFileSync(join(workDir, 'secret.txt'), 'outside the site');
  server = await startPagesServer({ root: site, basePath: '/RabbitMqPlayground' });
  origin = new URL(server.url).origin;
});

afterAll(async () => {
  await server.close();
  rmSync(workDir, { recursive: true, force: true });
});

const get = (path: string, init?: RequestInit) => fetch(`${origin}${path}`, { redirect: 'manual', ...init });

describe('normaliseBasePath', () => {
  it.each([
    ['/RabbitMqPlayground/', '/RabbitMqPlayground/'],
    ['/RabbitMqPlayground', '/RabbitMqPlayground/'],
    ['RabbitMqPlayground', '/RabbitMqPlayground/'],
    ['//a/b//', '/a/b/'],
    ['/', '/'],
    ['', '/'],
  ])('turns %j into %j', (input, expected) => {
    expect(normaliseBasePath(input)).toBe(expected);
  });
});

describe('a server that behaves like GitHub Pages', () => {
  it('reports the front page URL with the base path and a trailing slash', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/RabbitMqPlayground\/$/);
  });

  it('serves index.html at the base path', async () => {
    const response = await get('/RabbitMqPlayground/');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe('<h1>index</h1>');
  });

  it('redirects the base path without a trailing slash, as Pages does', async () => {
    const response = await get('/RabbitMqPlayground');

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/RabbitMqPlayground/');
  });

  it.each([
    ['/RabbitMqPlayground/main.js', 'text/javascript; charset=utf-8'],
    ['/RabbitMqPlayground/styles.css', 'text/css; charset=utf-8'],
  ])('serves %s as %s', async (path, type) => {
    const response = await get(path);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(type);
  });

  it('serves the index of a folder', async () => {
    expect(await (await get('/RabbitMqPlayground/assets/')).text()).toBe('<h1>assets index</h1>');
  });

  it('serves 404.html, with status 404, for a path that has no file, so deep links load the app', async () => {
    const response = await get('/RabbitMqPlayground/some/deep/link');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe('<h1>not found page</h1>');
  });

  it('has nothing outside the base path', async () => {
    for (const path of ['/', '/main.js', '/Other/', '/RabbitMqPlaygroundX/']) {
      const response = await get(path);

      expect(response.status, path).toBe(404);
      expect(await response.text()).toContain("There isn't a GitHub Pages site here.");
    }
  });

  it('does not let `..` climb out of the site', async () => {
    const response = await get('/RabbitMqPlayground/..%2fsecret.txt');

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('<h1>not found page</h1>');
  });

  it('answers HEAD without a body, and refuses other methods', async () => {
    const head = await get('/RabbitMqPlayground/main.js', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');

    const post = await get('/RabbitMqPlayground/', { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('rejects a malformed percent escape instead of crashing', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const url = new URL(server.url);
      const req = request({ host: url.hostname, port: url.port, path: '/RabbitMqPlayground/%E0%A4%A' }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });

    expect(status).toBe(400);
  });

  it('does not let a browser cache a build that is about to change', async () => {
    expect((await get('/RabbitMqPlayground/')).headers.get('cache-control')).toBe('no-store');
  });
});

describe('a server without a 404.html', () => {
  it('answers a plain 404', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'pages-empty-'));
    const bare = await startPagesServer({ root: empty, basePath: '/x/' });
    try {
      const response = await fetch(`${bare.url}missing`);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('File not found');
    } finally {
      await bare.close();
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('can serve at the root of a host', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pages-root-'));
    writeFileSync(join(root, 'index.html'), 'root index');
    const atRoot = await startPagesServer({ root, basePath: '/' });
    try {
      expect(atRoot.url).toMatch(/\/$/);
      expect(await (await fetch(atRoot.url)).text()).toBe('root index');
    } finally {
      await atRoot.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

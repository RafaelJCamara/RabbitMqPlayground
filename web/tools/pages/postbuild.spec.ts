import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withContentSecurityPolicy } from './csp';
import { addPagesFiles, createBuildInfo } from './postbuild';

describe('createBuildInfo', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');

  it('records the commit and the ref that GitHub Actions provides', () => {
    expect(createBuildInfo({ GITHUB_SHA: 'abc123', GITHUB_REF_NAME: 'main' }, now)).toEqual({
      commit: 'abc123',
      ref: 'main',
      builtAt: '2026-10-05T12:00:00.000Z',
    });
  });

  it('says "local" outside CI', () => {
    expect(createBuildInfo({}, now)).toMatchObject({ commit: 'local', ref: 'local' });
  });
});

describe('addPagesFiles', () => {
  let dist: string;
  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'pages-dist-'));
  });
  afterEach(() => rmSync(dist, { recursive: true, force: true }));

  const BUILT =
    '<!doctype html><html><head><meta charset="utf-8"><title>x</title></head><body><rmq-root></rmq-root>' +
    '<script src="main.js" type="module"></script><script>go()</script></body></html>';

  it('puts the content security policy in index.html, with the hash of its inline script', () => {
    writeFileSync(join(dist, 'index.html'), BUILT);

    addPagesFiles(dist, createBuildInfo({}, new Date()));

    const index = readFileSync(join(dist, 'index.html'), 'utf8');
    expect(index).toContain(
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self' 'sha256-",
    );
    expect(index).toBe(withContentSecurityPolicy(BUILT));
  });

  it('copies index.html, policy and all, to 404.html, and writes build-info.json', () => {
    writeFileSync(join(dist, 'index.html'), BUILT);
    const info = { commit: 'abc123', ref: 'main', builtAt: '2026-10-05T12:00:00.000Z' };

    addPagesFiles(dist, info);

    expect(readFileSync(join(dist, '404.html'), 'utf8')).toBe(readFileSync(join(dist, 'index.html'), 'utf8'));
    expect(readFileSync(join(dist, '404.html'), 'utf8')).toContain('Content-Security-Policy');
    expect(JSON.parse(readFileSync(join(dist, 'build-info.json'), 'utf8'))).toEqual(info);
    expect(readFileSync(join(dist, 'build-info.json'), 'utf8').endsWith('\n')).toBe(true);
  });

  it('makes the same folder when it is run twice on it', () => {
    writeFileSync(join(dist, 'index.html'), BUILT);
    addPagesFiles(dist, createBuildInfo({}, new Date()));
    const once = readFileSync(join(dist, 'index.html'), 'utf8');

    addPagesFiles(dist, createBuildInfo({}, new Date()));

    expect(readFileSync(join(dist, 'index.html'), 'utf8')).toBe(once);
  });

  it('refuses a page that the policy would break, and leaves no 404.html that does', () => {
    writeFileSync(join(dist, 'index.html'), BUILT.replace('<rmq-root>', '<button onclick="go()"></button><rmq-root>'));

    expect(() => addPagesFiles(dist, createBuildInfo({}, new Date()))).toThrow(/inline event handler/);
    expect(existsSync(join(dist, '404.html'))).toBe(false);
  });

  it('refuses a folder that has not been built', () => {
    expect(() => addPagesFiles(dist, createBuildInfo({}, new Date()))).toThrow(/no index\.html/i);
    expect(existsSync(join(dist, '404.html'))).toBe(false);
  });
});

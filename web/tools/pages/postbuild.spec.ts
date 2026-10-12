import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withContentSecurityPolicy } from './csp';
import { addPagesFiles, createBuildInfo, withBuildMeta } from './postbuild';

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

describe('withBuildMeta (ADR-0109)', () => {
  const HTML = '<html><head><meta charset="utf-8"><title>x</title></head><body></body></html>';
  const HASH = '3f2a9c1d4e5b60718293a4b5c6d7e8f901234567';

  it('puts the commit in a <meta name="rmq-build"> after the charset', () => {
    expect(withBuildMeta(HTML, HASH)).toContain(`<meta charset="utf-8"><meta name="rmq-build" content="${HASH}" />`);
  });

  it('puts one only, however many times it is run, and the last commit wins', () => {
    const twice = withBuildMeta(withBuildMeta(HTML, 'aaaaaaa'), HASH);

    expect(twice.match(/rmq-build/g)).toHaveLength(1);
    expect(twice).toBe(withBuildMeta(HTML, HASH));
  });

  it('accepts "local", which is what a build outside CI says', () => {
    expect(withBuildMeta(HTML, 'local')).toContain('content="local"');
  });

  it.each(['', 'a"b', 'a b', '<script>', 'x" onload="y'])(
    'refuses %j, which would be put in an attribute of the page',
    (commit) => {
      expect(() => withBuildMeta(HTML, commit)).toThrow(/not a hash/);
    },
  );

  it('refuses a page with no charset to put it after', () => {
    expect(() => withBuildMeta('<html><head></head></html>', HASH)).toThrow(/charset/);
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
    expect(index).toBe(withContentSecurityPolicy(withBuildMeta(BUILT, 'local')));
  });

  it('says in index.html, and so in 404.html, which commit the build is of', () => {
    writeFileSync(join(dist, 'index.html'), BUILT);

    addPagesFiles(dist, { commit: 'abc123', ref: 'main', builtAt: '2026-10-05T12:00:00.000Z' });

    for (const page of ['index.html', '404.html']) {
      expect(readFileSync(join(dist, page), 'utf8')).toContain('<meta name="rmq-build" content="abc123" />');
    }
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

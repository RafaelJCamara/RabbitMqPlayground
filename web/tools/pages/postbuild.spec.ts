import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('copies index.html to 404.html and writes build-info.json', () => {
    writeFileSync(join(dist, 'index.html'), '<app-root></app-root>');
    const info = { commit: 'abc123', ref: 'main', builtAt: '2026-10-05T12:00:00.000Z' };

    addPagesFiles(dist, info);

    expect(readFileSync(join(dist, '404.html'), 'utf8')).toBe('<app-root></app-root>');
    expect(JSON.parse(readFileSync(join(dist, 'build-info.json'), 'utf8'))).toEqual(info);
    expect(readFileSync(join(dist, 'build-info.json'), 'utf8').endsWith('\n')).toBe(true);
  });

  it('refuses a folder that has not been built', () => {
    expect(() => addPagesFiles(dist, createBuildInfo({}, new Date()))).toThrow(/no index\.html/i);
    expect(existsSync(join(dist, '404.html'))).toBe(false);
  });
});

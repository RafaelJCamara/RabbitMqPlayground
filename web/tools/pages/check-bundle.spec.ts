import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findForbidden, readBundle } from './check-bundle';

describe('findForbidden', () => {
  const files = { 'main.js': 'a window.__rmq = 1', 'index.html': '<p>hi</p>', 'styles.css': 'b{}' };

  it('reports each file that contains each forbidden text', () => {
    expect(findForbidden(files, ['__rmq', 'hi', 'absent'])).toEqual([
      { file: 'main.js', text: '__rmq' },
      { file: 'index.html', text: 'hi' },
    ]);
  });

  it('reports nothing for a clean bundle', () => {
    expect(findForbidden({ 'main.js': 'ok' }, ['__rmq'])).toEqual([]);
    expect(findForbidden({}, ['__rmq'])).toEqual([]);
  });
});

describe('readBundle', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads scripts, pages and styles, including those in folders, and skips other files', () => {
    mkdirSync(join(dir, 'chunks'));
    writeFileSync(join(dir, 'main.js'), 'js');
    writeFileSync(join(dir, 'chunks', 'lazy.mjs'), 'mjs');
    writeFileSync(join(dir, 'index.html'), 'html');
    writeFileSync(join(dir, 'styles.css'), 'css');
    writeFileSync(join(dir, 'main.js.map'), '__rmq in a source map is not shipped to the page');
    writeFileSync(join(dir, 'favicon.svg'), '<svg/>');

    expect(readBundle(dir)).toEqual({
      'main.js': 'js',
      [join('chunks', 'lazy.mjs')]: 'mjs',
      'index.html': 'html',
      'styles.css': 'css',
    });
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The product name lives in one constant, `APP_NAME` (ADR-0020). Places that cannot import it, such as the static
 * `<title>`, are checked here so a rename cannot leave one of them behind.
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const appInfo = read('../../projects/app/src/app/core/app-info.ts');
const appName = /export const APP_NAME = '([^']+)'/.exec(appInfo)?.[1];

describe('the product name', () => {
  it('is defined once, in app-info.ts', () => {
    expect(appName).toBeTruthy();
    expect(appInfo.match(/export const APP_NAME/g)).toHaveLength(1);
  });

  it('is the <title> of the page', () => {
    expect(/<title>([^<]*)<\/title>/.exec(read('../../projects/app/src/index.html'))?.[1]).toBe(appName);
  });

  it('is the heading of the README', () => {
    expect(/^# (.+)$/m.exec(read('../../../README.md'))?.[1]).toBe(appName);
  });

  it('is not repeated as a string literal in the app source', () => {
    const sources = [
      'app.ts',
      'app.html',
      'core/debug/debug-handle.ts',
      'core/flags/flags.ts',
      'core/flags/feature-flags.ts',
    ];
    for (const file of sources) {
      expect(read(`../../projects/app/src/app/${file}`), file).not.toContain(appName ?? '');
    }
  });
});

describe('the Broadcom disclaimer', () => {
  it('is in the README and in the app', () => {
    const readme = read('../../../README.md').replace(/\s+/g, ' '); // the README wraps its lines
    expect(readme).toContain('not affiliated with, endorsed by or sponsored by Broadcom Inc.');
    expect(appInfo).toContain('Not affiliated with, endorsed by or sponsored by Broadcom Inc.');
  });
});

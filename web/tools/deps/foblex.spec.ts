import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * ADR-0016 pins Foblex Flow to one exact version, and ADR-0034 says what follows from it: the editor works around what the library
 * does not offer, each workaround is a test of the contract suite (e2e/foblex-contract.spec.ts), and that suite runs against the
 * version that is installed. An upgrade is a change of the line below, made on purpose, in a commit where the suite is green or
 * is changed with it. It is never something that a range, or a lock file that was refreshed on its own, does without a word.
 */

const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');
const json = <T>(path: string): T => JSON.parse(read(path)) as T;

const pinned = json<{ dependencies: Record<string, string> }>('package.json').dependencies['@foblex/flow'];

describe('the version of Foblex Flow', () => {
  it('is one exact version in package.json, and not a range', () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is the one that the lock file resolves, so that a refreshed lock file cannot move it', () => {
    const lock = json<{ packages: Record<string, { version: string }> }>('package-lock.json');

    expect(lock.packages['node_modules/@foblex/flow']?.version).toBe(pinned);
  });

  it('is the one that is installed, which is the one that the contract suite runs against', () => {
    expect(json<{ version: string }>('node_modules/@foblex/flow/package.json').version).toBe(pinned);
  });
});

describe('the contract suite of Foblex Flow', () => {
  const suite = read('e2e/foblex-contract.spec.ts');

  it('says which version it ran against, in the report of every test', () => {
    expect(suite).toContain("type: 'foblex'");
  });

  it('has no test that is skipped, expected to fail, or the only one that runs', () => {
    expect(suite).not.toMatch(/\b(?:test|it|describe)\.(?:skip|fixme|fail|only|slow)\b|\bfit\(|\bxit\(/);
  });

  it('has a test for each of the four workarounds of ADR-0016', () => {
    for (const number of [1, 2, 3, 4]) {
      expect(suite, `workaround ${number}`).toContain(`(workaround ${number} of ADR-0016)`);
    }
  });
});

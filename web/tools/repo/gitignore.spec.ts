import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The root .gitignore covers .NET and Node. The .NET patterns match any directory named `debug`, `bin`, `log` and so
 * on, which once hid `web/.../core/debug/` from git without a word. These tests ask git itself.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function isIgnored(path: string): boolean {
  const result = spawnSync('git', ['check-ignore', '--no-index', '--quiet', path], { cwd: repoRoot });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    throw new Error(`git check-ignore failed for ${path}: ${result.error?.message ?? result.stderr.toString()}`);
  }
  return result.status === 0;
}

describe('.gitignore', () => {
  it.each([
    'web/projects/app/src/app/core/debug/debug-handle.ts',
    'web/projects/app/src/app/explain/log/event-log.ts',
    'web/projects/app/src/app/explain/logs/index.ts',
    'web/tools/bin/run.ts',
    'web/tools/obj/model.ts',
    'web/projects/engine/src/lib/release/notes.ts',
    'web/projects/engine/src/lib/Release/notes.ts',
    'docs/releases/v0.1.0.md',
  ])('keeps source in %s', (path) => {
    expect(isIgnored(path)).toBe(false);
  });

  it.each([
    'web/node_modules/pkg/index.js',
    'web/node_modules/pkg/bin/cli.js',
    'web/node_modules/.bin/ng',
    'web/dist/app/browser/index.html',
    'web/.angular/cache/x',
    'web/.tsbuild/engine/index.d.ts',
    'web/coverage/lcov.info',
    'web/playwright-report/index.html',
    'web/test-results/x',
    'web/projects/engine/.tsbuildinfo',
    'web/x.tsbuildinfo',
  ])('ignores generated output in %s', (path) => {
    expect(isIgnored(path)).toBe(true);
  });

  it.each([
    'api/MyApi/bin/Debug/net10.0/MyApi.dll',
    'api/MyApi/obj/project.assets.json',
    'api/MyApi/.env',
    'api/MyApi/MyApi.1.0.0.nupkg',
  ])('still ignores .NET build output in %s', (path) => {
    expect(isIgnored(path)).toBe(true);
  });

  it('does not ignore the files the repository is made of', () => {
    for (const path of [
      '.claude/settings.json',
      '.github/workflows/ci.yml',
      'docs/adr/README.md',
      'web/package-lock.json',
      'web/fixtures/conformance/4.3/manifest.json',
    ]) {
      expect(isIgnored(path), path).toBe(false);
    }
  });

  it('ignores personal Claude Code settings', () => {
    expect(isIgnored('.claude/settings.local.json')).toBe(true);
  });
});

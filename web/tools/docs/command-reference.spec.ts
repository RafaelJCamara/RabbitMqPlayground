import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDrift, COMMAND_REFERENCE_FILE, generateCommandReference } from './command-reference';

describe('checkDrift', () => {
  const generated = '# Command reference\n\nline two\nline three\n';

  it('accepts the same text', () => {
    expect(checkDrift(generated, generated)).toEqual({ upToDate: true });
  });

  it('accepts the same text with CRLF line endings, which a Windows checkout can produce', () => {
    expect(checkDrift(generated, generated.replaceAll('\n', '\r\n'))).toEqual({ upToDate: true });
  });

  it('reports a missing file', () => {
    expect(checkDrift(generated, null)).toEqual({ upToDate: false, reason: 'docs/commands.md does not exist.' });
  });

  it('names the first line that differs', () => {
    const result = checkDrift(generated, '# Command reference\n\nline two\nEDITED\n');

    expect(result).toEqual({
      upToDate: false,
      reason: 'docs/commands.md differs from the generated text, first at line 4.',
    });
  });

  it('notices a file that was cut short, and one with extra lines', () => {
    expect(checkDrift(generated, '# Command reference\n').upToDate).toBe(false);
    expect(checkDrift(generated, `${generated}extra\n`).upToDate).toBe(false);
  });

  it('notices a change in whitespace alone', () => {
    expect(checkDrift(generated, generated.replace('line two', 'line two ')).upToDate).toBe(false);
  });
});

describe('docs/commands.md', () => {
  it('is up to date with the command registry (the same check as `npm run docs:check`)', () => {
    const committed = existsSync(COMMAND_REFERENCE_FILE) ? readFileSync(COMMAND_REFERENCE_FILE, 'utf8') : null;

    expect(checkDrift(generateCommandReference(), committed)).toEqual({ upToDate: true });
  });

  describe('the script behind `npm run docs:check`', () => {
    const webRoot = fileURLToPath(new URL('../../', import.meta.url));
    // `npx` is `npx.cmd` on Windows, which cannot be spawned without a shell. This is the entry point `tsx` points to.
    const tsx = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));
    const script = (...args: string[]) =>
      spawnSync(process.execPath, [tsx, 'tools/docs/generate-commands.ts', ...args], {
        cwd: webRoot,
        encoding: 'utf8',
      });
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'commands-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('fails on a stale file and says how to fix it', () => {
      const file = join(dir, 'commands.md');
      writeFileSync(file, 'stale\n');

      const result = script('--check', `--file=${file}`);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('npm run docs:generate');
    });

    it('fails on a missing file', () => {
      expect(script('--check', `--file=${join(dir, 'missing.md')}`).status).toBe(1);
    });

    it('writes a file that it then accepts', () => {
      const file = join(dir, 'commands.md');

      expect(script(`--file=${file}`).status).toBe(0);
      expect(readFileSync(file, 'utf8')).toBe(generateCommandReference());
      expect(script('--check', `--file=${file}`).status).toBe(0);
    });
  });
});

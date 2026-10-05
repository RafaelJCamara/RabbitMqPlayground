import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ADR-0004 replaces review with automated gates, so the pre-push gate must not lose a check unnoticed. These tests read
 * lefthook.yml the way lefthook itself resolves it.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const webRoot = `${repoRoot}web/`;

interface Job {
  name: string;
  run: string;
}
interface Config {
  'pre-push': { parallel?: boolean; jobs: Job[] };
  'commit-msg': { jobs: Job[] };
}

/** `node_modules/.bin/lefthook` is a shell script on Windows, which cannot be spawned. This is the launcher it points to. */
const LAUNCHER = `${webRoot}node_modules/lefthook/bin/index.js`;

function lefthook(...args: string[]) {
  return spawnSync(process.execPath, [LAUNCHER, ...args], { cwd: repoRoot, encoding: 'utf8' });
}

const dump = lefthook('dump', '--format', 'json');
const config = JSON.parse(dump.stdout) as Config;
const scripts = (JSON.parse(readFileSync(`${webRoot}package.json`, 'utf8')) as { scripts: Record<string, string> })
  .scripts;

describe('lefthook.yml', () => {
  it('is valid according to lefthook', () => {
    const result = lefthook('validate');

    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  describe('the pre-push hook', () => {
    const jobs = config['pre-push'].jobs;

    it('runs its checks in parallel, to stay fast', () => {
      expect(config['pre-push'].parallel).toBe(true);
    });

    it('has every gate of the M1 plan: lint, format, types, both coverage runs and a development build', () => {
      expect(jobs.map((job) => job.run)).toEqual([
        'cd web && npm run lint',
        'cd web && npm run format:check',
        'cd web && npm run typecheck',
        'cd web && npm run test:libs:coverage',
        'cd web && npm run test:app:coverage',
        'cd web && npm run build:dev',
      ]);
    });

    it.each(jobs)('runs $name whichever files were pushed, because it has nothing but a name and a command', (job) => {
      // Lefthook skips a job that has a `root`, a `glob` or another file filter when no pushed file matches it, and the
      // specs in web/ also guard files outside web/ (README.md, LICENSE, .gitignore, lefthook.yml, .claude/). A push
      // that changes only those has to run every gate.
      expect(Object.keys(job).sort()).toEqual(['name', 'run']);
    });

    it.each(jobs)('runs $name in web/, with an npm script that exists', ({ run }) => {
      const script = /^cd web && npm run (\S+)$/.exec(run)?.[1] ?? '';
      expect(scripts[script], `web/package.json has no script "${script}"`).toBeTruthy();
    });

    it('runs the coverage gates with coverage turned on, so a drop below a threshold blocks the push', () => {
      expect(scripts['test:libs:coverage']).toContain('--coverage');
      expect(scripts['test:app:coverage']).toContain('--coverage');
    });

    it('treats lint warnings as failures', () => {
      expect(scripts['lint']).toContain('--max-warnings 0');
    });
  });

  describe('the commit-msg hook', () => {
    const [job, ...others] = config['commit-msg'].jobs;

    it('has one job, which checks the message file that git passes in', () => {
      expect(others).toEqual([]);
      expect(job?.run).toMatch(/check-commit-message\.ts \{1\}$/);
    });

    it('points at a script that exists', () => {
      const script = /(web\/\S+\.ts)/.exec(job?.run ?? '')?.[1] ?? '';

      expect(existsSync(`${repoRoot}${script}`), script).toBe(true);
    });
  });
});

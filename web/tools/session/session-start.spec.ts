import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The SessionStart hook (.claude/hooks/session-start.sh) makes a cloud session ready to run this repository's checks:
 * a Node that the Angular CLI accepts on the PATH, the Chromium that is already installed, `npm ci`, and the git hooks.
 * A cloud session cannot be started from here, so these tests run the real script against a throwaway HOME, project
 * and PATH. On that PATH `node`, `npx`, `npm` and `lefthook` are small scripts that record what they were asked to do.
 *
 * The hook only ever runs in the Linux containers of cloud sessions, and it relies on GNU `sort -V` and `sha256sum`.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const hook = join(repoRoot, '.claude/hooks/session-start.sh');

/** The commands that the hook and the shims use, other than node, npx and npm. Nothing else is on the PATH. */
const SYSTEM_COMMANDS = [
  'cat',
  'chmod',
  'cp',
  'cut',
  'dirname',
  'grep',
  'head',
  'ls',
  'mkdir',
  'sha256sum',
  'sort',
  'tail',
];

const quote = (path: string) => `'${path}'`;

function findOnPath(command: string): string {
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    const candidate = join(dir, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not in this directory
    }
  }
  throw new Error(`${command} is not installed`);
}

function executable(path: string, script: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
}

interface Result {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** A home, a project, a browsers folder, an environment file and a PATH that hold only what a test puts there. */
class Sandbox {
  readonly root = mkdtempSync(join(tmpdir(), 'session-start-'));
  readonly home = join(this.root, 'home');
  readonly web = join(this.root, 'project/web');
  readonly browsers = join(this.root, 'browsers');
  readonly envFile = join(this.root, 'claude-env');
  readonly fetchedNodeBin = join(this.home, '.npm/_npx/9d8e7f6a5b4c/node_modules/node/bin');
  private readonly log = join(this.root, 'calls.log');
  private readonly shims = join(this.root, 'shims');
  private readonly system = join(this.root, 'system');

  constructor() {
    for (const dir of [this.home, this.web, this.browsers, this.shims, this.system]) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.envFile, '');
    for (const command of SYSTEM_COMMANDS) {
      symlinkSync(findOnPath(command), join(this.system, command));
    }
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }

  /** A `node` on the PATH that reports this version (anything it prints, for a version that makes no sense). */
  withNode(version: string): this {
    executable(join(this.shims, 'node'), `echo '${version}'`);
    return this;
  }

  /** A Node that an earlier `npx -y node@24` left in the npm cache. The folder's name has a hash in it. Returns its bin. */
  withCachedNode(version: string, hash = '4f1c9a7e2b3d'): string {
    const bin = join(this.home, '.npm/_npx', hash, 'node_modules/node/bin');
    executable(join(bin, 'node'), `echo '${version}'`);
    return bin;
  }

  /**
   * An `npx` that leaves a Node in the cache (in `fetchedNodeBin`), as the real one does, or one that fails, as
   * without a network.
   */
  withNpx(outcome: { readonly fetches: string } | 'offline'): this {
    const npx = join(this.shims, 'npx');
    const record = `echo "npx $*" >>${quote(this.log)}`;
    if (outcome === 'offline') {
      executable(npx, `${record}\nexit 1`);
      return this;
    }
    const node = quote(join(this.fetchedNodeBin, 'node'));
    executable(
      npx,
      [
        record,
        `mkdir -p ${quote(this.fetchedNodeBin)}`,
        `printf '#!/bin/sh\\necho ${outcome.fetches}\\n' >${node}`,
        `chmod +x ${node}`,
      ].join('\n'),
    );
    return this;
  }

  /**
   * An `npm` that makes node_modules with a `lefthook` in it, as `npm ci` does. It refuses to run outside the sandbox,
   * so that a mistake in a test can never touch the real checkout.
   */
  withNpm(options: { readonly fails?: boolean } = {}): this {
    const lefthook = join(this.root, 'lefthook-shim');
    executable(lefthook, `echo "lefthook $*" >>${quote(this.log)}`);
    executable(
      join(this.shims, 'npm'),
      [
        `case "$(pwd)" in ${this.root}/*) ;; *) echo "the npm shim runs only in the sandbox" >&2; exit 99 ;; esac`,
        `echo "npm $* in $(pwd)" >>${quote(this.log)}`,
        ...(options.fails ? ['exit 1'] : []),
        'mkdir -p node_modules/.bin',
        `cp ${quote(lefthook)} node_modules/.bin/lefthook`,
      ].join('\n'),
    );
    return this;
  }

  withLockfile(content = '{"lockfileVersion":3}'): this {
    writeFileSync(join(this.web, 'package-lock.json'), content);
    return this;
  }

  /** `chromium-<revision>/chrome-linux/chrome`, which is where Playwright's browsers are in the cloud image. */
  withChromium(...revisions: number[]): this {
    for (const revision of revisions) {
      executable(join(this.browsers, `chromium-${revision}/chrome-linux/chrome`), 'exit 0');
    }
    return this;
  }

  run(env: Record<string, string | undefined> = {}): Result {
    const result = spawnSync(hook, [], {
      encoding: 'utf8',
      env: {
        PATH: [this.shims, this.system].join(delimiter),
        HOME: this.home,
        CLAUDE_PROJECT_DIR: join(this.root, 'project'),
        CLAUDE_ENV_FILE: this.envFile,
        PLAYWRIGHT_BROWSERS_PATH: this.browsers,
        CLAUDE_CODE_REMOTE: 'true',
        ...env,
      },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr + (result.error?.message ?? '') };
  }

  /** What the shims were asked to do, in order. */
  calls(): string[] {
    return existsSync(this.log) ? readFileSync(this.log, 'utf8').split('\n').filter(Boolean) : [];
  }

  /** The lines that the hook added to the session's environment file. */
  persisted(): string[] {
    return readFileSync(this.envFile, 'utf8').split('\n').filter(Boolean);
  }
}

describe.skipIf(process.platform !== 'linux')('the SessionStart hook', () => {
  let box: Sandbox;
  beforeEach(() => {
    box = new Sandbox();
  });
  afterEach(() => box.dispose());

  const pathLines = () => box.persisted().filter((line) => line.startsWith('export PATH='));
  const chromiumLines = () => box.persisted().filter((line) => line.startsWith('export PW_CHROMIUM_PATH='));

  describe('registration', () => {
    it('is the SessionStart hook in .claude/settings.json', () => {
      const settings = JSON.parse(readFileSync(join(repoRoot, '.claude/settings.json'), 'utf8')) as {
        hooks: { SessionStart: { hooks: { type: string; command: string }[] }[] };
      };

      expect(settings.hooks.SessionStart.flatMap((entry) => entry.hooks)).toEqual([
        { type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh' },
      ]);
    });

    it('is executable, because the settings run it as a command', () => {
      expect(statSync(hook).mode & 0o111).not.toBe(0);
    });

    it('accepts the Node versions that web/package.json asks for, and the hook says so in its own words', () => {
      const { engines } = JSON.parse(readFileSync(join(repoRoot, 'web/package.json'), 'utf8')) as {
        engines: { node: string };
      };

      // If this fails, `node_ok` in the hook and its message need to change with the engines, and so do the tests below.
      expect(engines.node).toBe('^22.22.3 || >=24.15.0');
    });
  });

  describe('outside a cloud session', () => {
    it.each([undefined, '', 'false'])('does nothing when CLAUDE_CODE_REMOTE is %s', (remote) => {
      box.withNode('v22.22.0').withNpx({ fetches: 'v24.21.0' }).withNpm().withLockfile().withChromium(1194);

      expect(box.run({ CLAUDE_CODE_REMOTE: remote })).toEqual({ status: 0, stdout: '', stderr: '' });
      expect(box.persisted()).toEqual([]);
      expect(box.calls()).toEqual([]);
    });
  });

  describe('Node', () => {
    it.each(['v22.22.3', 'v22.22.10', 'v22.23.0', 'v24.15.0', 'v24.21.0', 'v25.0.0'])(
      'keeps %s, which the Angular CLI accepts',
      (version) => {
        box.withNode(version).withNpx({ fetches: 'v24.21.0' });

        const result = box.run();

        expect(result.status).toBe(0);
        expect(result.stderr).not.toContain('no Node that satisfies');
        expect(result.stdout).toContain(`node ${version},`);
        expect(pathLines()).toEqual([]);
        expect(box.calls()).toEqual([]);
      },
    );

    it.each(['v22.22.2', 'v22.22.0', 'v22.0.0', 'v23.11.0', 'v24.14.9', 'v24.9.0', 'v20.19.0', 'garbage', ''])(
      'does not accept "%s", and warns when it has nothing better',
      (version) => {
        box.withNode(version).withNpx('offline');

        const result = box.run();

        expect(result.status).toBe(0);
        expect(result.stderr).toContain('no Node that satisfies 22.22.3+ or 24.15+ was found');
        expect(pathLines()).toEqual([]);
      },
    );

    it('uses a Node 24 that an earlier session left in the npm cache, without fetching it again', () => {
      const cached = box.withCachedNode('v24.21.0');
      box.withNode('v22.22.0').withNpx({ fetches: 'v24.99.0' });

      const result = box.run();

      expect(pathLines()).toEqual([`export PATH="${cached}:$PATH"`]);
      expect(box.calls()).toEqual([]);
      expect(result.stdout).toContain('node v24.21.0,');
    });

    it('skips a cached Node that is too old, and fetches one when none of them will do', () => {
      box.withCachedNode('v22.22.0', '0000aaaa1111');
      box.withNode('v22.22.0');
      box.withNpx({ fetches: 'v24.21.0' });

      const result = box.run();

      expect(box.calls()).toEqual(['npx -y node@24 --version']);
      expect(pathLines()).toEqual([`export PATH="${box.fetchedNodeBin}:$PATH"`]);
      expect(result.stdout).toContain('node v24.21.0,');
    });

    it('fetches Node 24 with npx when the container has an old Node and no cache', () => {
      box.withNode('v22.22.0');
      box.withNpx({ fetches: 'v24.21.0' });

      const result = box.run();

      expect(result.status).toBe(0);
      expect(box.calls()).toEqual(['npx -y node@24 --version']);
      expect(pathLines()).toEqual([`export PATH="${box.fetchedNodeBin}:$PATH"`]);
      expect(result.stdout).toContain('node v24.21.0,');
    });

    it('still finishes, with a warning, when there is no Node and no way to get one', () => {
      const result = box.run();

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('no Node that satisfies 22.22.3+ or 24.15+ was found');
      expect(result.stdout).toContain('node not found,');
    });

    it('persists the PATH once, however many times it runs', () => {
      box.withCachedNode('v24.21.0');
      box.withNode('v22.22.0').withChromium(1194);

      box.run();
      const afterFirst = box.persisted();
      box.run();
      box.run();

      expect(afterFirst).toHaveLength(2);
      expect(box.persisted()).toEqual(afterFirst);
    });
  });

  describe('Chromium', () => {
    beforeEach(() => {
      box.withNode('v24.21.0');
    });

    it('picks the newest revision, comparing revisions as numbers and not as text', () => {
      box.withChromium(999, 1194, 1200);

      const result = box.run();

      expect(chromiumLines()).toEqual([`export PW_CHROMIUM_PATH="${box.browsers}/chromium-1200/chrome-linux/chrome"`]);
      expect(result.stdout).toContain(`Chromium ${box.browsers}/chromium-1200/chrome-linux/chrome,`);
    });

    it('ignores folders that have no browser in them, and the headless shell', () => {
      box.withChromium(1194);
      mkdirSync(join(box.browsers, 'chromium-1300'));
      executable(join(box.browsers, 'chromium_headless_shell-1400/chrome-linux/chrome'), 'exit 0');

      box.run();

      expect(chromiumLines()).toEqual([`export PW_CHROMIUM_PATH="${box.browsers}/chromium-1194/chrome-linux/chrome"`]);
    });

    it('warns, and carries on, when no Chromium is installed', () => {
      const result = box.run();

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(`no Chromium found under ${box.browsers}`);
      expect(result.stdout).toContain('Chromium not found,');
      expect(chromiumLines()).toEqual([]);
    });
  });

  describe('npm dependencies and git hooks', () => {
    const stamp = () => join(box.web, 'node_modules/.lockfile-sha256');

    beforeEach(() => {
      box.withNode('v24.21.0').withNpm().withLockfile('{"lockfileVersion":3,"packages":{}}').withChromium(1194);
    });

    it('runs `npm ci` in web/ on the first start, remembers which lockfile it installed, and installs the git hooks', () => {
      const result = box.run();

      expect(result.status).toBe(0);
      expect(box.calls()).toEqual([`npm ci --no-audit --no-fund in ${box.web}`, 'lefthook install']);
      expect(readFileSync(stamp(), 'utf8').trim()).toBe(
        createHash('sha256').update('{"lockfileVersion":3,"packages":{}}').digest('hex'),
      );
      expect(result.stdout).toContain('web/ dependencies installed.');
    });

    it('does not install again while the lockfile is the same, but still makes sure the git hooks are installed', () => {
      box.run();

      const result = box.run();

      expect(box.calls()).toEqual([
        `npm ci --no-audit --no-fund in ${box.web}`,
        'lefthook install',
        'lefthook install',
      ]);
      expect(result.stdout).toContain('web/ dependencies up to date.');
    });

    it('installs again when package-lock.json changes', () => {
      box.run();
      box.withLockfile('{"lockfileVersion":3,"packages":{"node_modules/new":{}}}');

      const result = box.run();

      expect(box.calls().filter((call) => call.startsWith('npm ci'))).toHaveLength(2);
      expect(result.stdout).toContain('web/ dependencies installed.');
    });

    it('installs again when node_modules has been deleted, because the stamp lives in it', () => {
      box.run();
      rmSync(join(box.web, 'node_modules'), { recursive: true });

      box.run();

      expect(box.calls().filter((call) => call.startsWith('npm ci'))).toHaveLength(2);
    });

    it('fails, and leaves no stamp, when `npm ci` fails, so the next start tries again', () => {
      box.withNpm({ fails: true });

      const result = box.run();

      expect(result.status).not.toBe(0);
      expect(existsSync(stamp())).toBe(false);
      expect(result.stdout).not.toContain('Session ready');
    });

    it('leaves dependencies alone when RMQ_SESSION_START_SKIP_INSTALL is set', () => {
      const result = box.run({ RMQ_SESSION_START_SKIP_INSTALL: '1' });

      expect(result.status).toBe(0);
      expect(box.calls()).toEqual([]);
      expect(result.stdout).toContain('web/ dependencies not installed.');
    });

    it('does not fail in a checkout that has no lockfile yet', () => {
      rmSync(join(box.web, 'package-lock.json'));

      const result = box.run();

      expect(result.status).toBe(0);
      expect(box.calls()).toEqual([]);
      expect(result.stdout).toContain('web/ dependencies not installed.');
    });
  });
});

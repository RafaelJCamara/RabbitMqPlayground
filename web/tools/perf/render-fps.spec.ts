import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FpsRecord } from './fps';
import { RECORDS_END, RECORDS_START } from './render';

const sample: FpsRecord = {
  schema: 1,
  date: '2026-10-09T14:03:22.123Z',
  commit: '8dfe728',
  dirty: false,
  scenario: { nodes: 200, edges: 500, messagesTarget: 500, seconds: 20 },
  machine: {
    cpu: 'Intel(R) Core(TM) i9-14900HX',
    cores: 24,
    memoryGb: 32,
    platform: 'win32',
    release: '10.0.26300',
    arch: 'x64',
    gpu: 'NVIDIA GeForce RTX 4070 Laptop GPU',
    browser: 'Chromium 141.0',
    displayHz: 144,
    devicePixelRatio: 1.25,
    screen: '2560x1600',
  },
  power: { charging: true, level: 1, plan: 'Balanced' },
  rates: [
    {
      cpuThrottle: 1,
      stats: {
        frames: 1200,
        seconds: 20,
        averageFps: 60,
        medianFps: 61.2,
        lowFps: 51.2,
        worstFrameMs: 41,
        longFrames: 3,
      },
      travelling: { min: 588, mean: 603 },
      meets: true,
    },
  ],
};

describe('the script behind `npm run perf:check`', () => {
  const webRoot = fileURLToPath(new URL('../../', import.meta.url));
  // `npx` is `npx.cmd` on Windows, which cannot be spawned without a shell. This is the entry point `tsx` points to.
  const tsx = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));
  const script = (...args: string[]) =>
    spawnSync(process.execPath, [tsx, 'tools/perf/render-fps.ts', ...args], { cwd: webRoot, encoding: 'utf8' });
  const page = (inside: string) =>
    `# Performance\n\nWords.\n\n${RECORDS_START}\n\n${inside}\n\n${RECORDS_END}\n\nMore words.\n`;
  let dir: string;
  let file: string;
  let records: string;
  const options = () => [`--file=${file}`, `--records=${records}`];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'performance-'));
    file = join(dir, 'performance.md');
    records = join(dir, 'records');
    mkdirSync(records);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('fails on a stale table and says how to fix it', () => {
    writeFileSync(file, page('stale'));

    const result = script('--check', ...options());

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm run perf:render');
    expect(result.stderr).toMatch(/first at line \d+/);
  });

  it('fails on a page without the markers, and on a page that is not there', () => {
    writeFileSync(file, '# Performance\n');
    const unmarked = script('--check', ...options());
    const missing = script('--check', `--file=${join(dir, 'missing.md')}`, `--records=${records}`);

    expect(unmarked.status).toBe(1);
    expect(unmarked.stderr).toContain(RECORDS_START);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('does not exist');
  });

  it('writes the table of the records into the page, and then accepts it', () => {
    writeFileSync(file, page('stale'));
    writeFileSync(join(records, 'one.json'), JSON.stringify(sample));
    writeFileSync(join(records, 'notes.txt'), 'not a record, and not read');

    expect(script(...options()).status).toBe(0);
    const written = readFileSync(file, 'utf8');
    expect(written).toContain(
      '| 2026-10-09 | Intel(R) Core(TM) i9-14900HX, NVIDIA GeForce RTX 4070 Laptop GPU, 24 cores, 32 GB, 144 Hz |',
    );
    expect(written).toContain('| AC, Balanced | none | 61.2 | 51.2 | 588 | yes |');
    expect(written.startsWith(`# Performance\n\nWords.\n\n${RECORDS_START}\n\n| Date | Machine |`)).toBe(true);
    expect(written.endsWith(`\n\n${RECORDS_END}\n\nMore words.\n`)).toBe(true);
    expect(script('--check', ...options()).status).toBe(0);
  });

  it('takes no record at all, and a folder that is not there yet, for a page that says so', () => {
    writeFileSync(file, page('stale'));

    expect(script(`--file=${file}`, `--records=${join(dir, 'not-yet')}`).status).toBe(0);
    expect(readFileSync(file, 'utf8')).toContain('| No record yet. | | | | | | | |');
    expect(script('--check', ...options()).status).toBe(0);
  });

  it('names a record that cannot be used, and leaves the page alone', () => {
    writeFileSync(file, page('stale'));
    writeFileSync(join(records, 'good.json'), JSON.stringify(sample));
    writeFileSync(join(records, 'broken.json'), JSON.stringify({ ...sample, schema: 2 }));

    const result = script(...options());

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('broken.json: schema: must be 1');
    expect(result.stderr).not.toContain('good.json');
    expect(readFileSync(file, 'utf8')).toBe(page('stale'));
  });

  it('is up to date in the repository (the same check as `npm run perf:check`)', () => {
    const result = script('--check');

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  });
});

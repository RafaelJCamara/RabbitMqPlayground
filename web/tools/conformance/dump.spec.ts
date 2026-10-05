import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDump, readFixtureFolder, renderDump, sha256, writeDumpedFiles, type DumpedFile } from './dump';

const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const files: DumpedFile[] = [
  { path: 'routing/a.json', text: pretty({ id: 'routing/a', observed: { routes: [{ body: 'm1', queues: ['q'] }] } }) },
  { path: 'delivery/b.json', text: pretty({ id: 'delivery/b', title: 'Naïve "quotes" and \\ slashes, ünïcode ✓' }) },
  { path: 'manifest.json', text: pretty({ baseline: '4.3', counts: { routing: 1, delivery: 1 } }) },
];

describe('renderDump', () => {
  it('gives each file a header with the hash of the file as written, then its content on one line', () => {
    const lines = renderDump(files).split('\n');

    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe(`FIXTURE routing/a.json sha256=${sha256(files[0]?.text ?? '')}`);
    expect(JSON.parse(lines[1] ?? '')).toEqual(JSON.parse(files[0]?.text ?? ''));
    expect(lines[1]).not.toContain('\n');
  });
});

describe('parseDump', () => {
  it('rebuilds the files exactly as they were written', () => {
    expect(parseDump(renderDump(files))).toEqual(files);
  });

  it('copes with the timestamp that a job log puts in front of every line, and with colour codes', () => {
    const log = renderDump(files)
      .split('\n')
      .map(
        (line, index) =>
          `2026-10-05T16:34:26.1234567Z ${index % 2 ? '\x1b[36m' : ''}${line}${index % 2 ? '\x1b[0m' : ''}`,
      )
      .join('\n');

    expect(
      parseDump(`2026-10-05T16:34:00.0000000Z noise before\n${log}\n2026-10-05T16:35:00.0000000Z noise after`),
    ).toEqual(files);
  });

  it('copes with the job and step columns that `gh run view --log` puts in front of the timestamp', () => {
    const log = renderDump(files)
      .split('\n')
      .map(
        (line) =>
          `Conformance against RabbitMQ 4.3\tPrint the recorded fixtures, for a tool\t2026-10-05T18:50:52.0479369Z ${line}`,
      )
      .join('\n');

    expect(
      parseDump(`Conformance against RabbitMQ 4.3\tSet up job\t2026-10-05T18:49:00.0000000Z noise\n${log}`),
    ).toEqual(files);
  });

  it('copes with Windows line endings', () => {
    expect(parseDump(renderDump(files).replaceAll('\n', '\r\n'))).toEqual(files);
  });

  it('refuses content that does not match its hash, which is what a copying mistake looks like', () => {
    const [header = '', json = ''] = renderDump(files).split('\n');
    const damaged = `${header}\n${json.replace('"m1"', '"m2"')}`;

    expect(() => parseDump(damaged)).toThrow('routing/a.json: the content does not match its SHA-256');
  });

  it('refuses a line that is not JSON, and a dump that stops early', () => {
    const [header = ''] = renderDump(files).split('\n');

    expect(() => parseDump(`${header}\n{ not json`)).toThrow(/not JSON/);
    expect(() => parseDump(header)).toThrow('the dump ends before its content');
  });

  it.each(['/etc/passwd', '../outside.json', 'routing/../../outside.json'])('refuses the path %s', (path) => {
    const text = pretty({ x: 1 });

    expect(() => parseDump(`FIXTURE ${path} sha256=${sha256(text)}\n${JSON.stringify({ x: 1 })}`)).toThrow(
      /Refusing the path/,
    );
  });

  it('refuses text that has no fixtures in it', () => {
    expect(() => parseDump('just a log\nwith nothing useful')).toThrow('There are no FIXTURE entries');
  });
});

describe('a fixtures folder', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dump-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is read in a fixed order and written back, byte for byte, through a dump', () => {
    writeDumpedFiles(dir, [...files].reverse());
    writeFileSync(join(dir, 'routing', 'notes.txt'), 'not a fixture');

    const read = readFixtureFolder(dir);
    expect(read.map((file) => file.path)).toEqual(['routing/a.json', 'delivery/b.json', 'manifest.json']);

    const copy = mkdtempSync(join(tmpdir(), 'dump-copy-'));
    try {
      writeDumpedFiles(copy, parseDump(renderDump(read)));
      for (const file of files) {
        expect(readFileSync(join(copy, file.path), 'utf8')).toBe(file.text);
      }
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  it('creates the folders it needs', () => {
    mkdirSync(join(dir, 'x'));
    writeDumpedFiles(join(dir, 'x'), [{ path: 'deep/er/file.json', text: '{}\n' }]);

    expect(readFileSync(join(dir, 'x', 'deep', 'er', 'file.json'), 'utf8')).toBe('{}\n');
  });
});

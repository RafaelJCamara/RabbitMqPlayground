import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Prints recorded fixtures into a job log, and rebuilds them from one. Record mode uploads the fixtures as an
 * artifact for a person to download. This is for a tool that can read the log but cannot download the artifact:
 * each file is one compact JSON line, preceded by the SHA-256 of the exact file that the runner wrote. `restore`
 * pretty-prints the line the way the runner does and refuses the file if the hash differs, so a copy that went
 * wrong in transit cannot be committed by accident.
 */

export interface DumpedFile {
  /** Relative to the fixtures folder, with forward slashes: `routing/direct-….json`, `manifest.json`. */
  readonly path: string;
  readonly text: string;
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The text that `JSON.stringify(value, null, 2)` plus a newline gives, which is how the runner writes a file. */
const pretty = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export function renderDump(files: readonly DumpedFile[]): string {
  return files
    .flatMap((file) => [`FIXTURE ${file.path} sha256=${sha256(file.text)}`, JSON.stringify(JSON.parse(file.text))])
    .join('\n');
}

/** Job logs put a timestamp, and sometimes colour codes, in front of every line. */
const ESCAPE = String.fromCharCode(27);
const COLOUR_CODE = `${ESCAPE}\\[[0-9;]*m`;
const COLOUR_CODES = new RegExp(COLOUR_CODE, 'g');
const LOG_PREFIX = new RegExp(`^(?:${COLOUR_CODE})*\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z\\s?`);
const stripLogDecoration = (line: string): string => line.replace(LOG_PREFIX, '').replace(COLOUR_CODES, '').trimEnd();

export function parseDump(text: string): DumpedFile[] {
  const lines = text.split(/\r?\n/).map(stripLogDecoration);
  const files: DumpedFile[] = [];

  for (let index = 0; index < lines.length; index++) {
    const header = /^FIXTURE (\S+) sha256=([0-9a-f]{64})$/.exec(lines[index] ?? '');
    if (!header) {
      continue;
    }
    const [, path = '', expected = ''] = header;
    if (path.startsWith('/') || path.split('/').includes('..')) {
      throw new Error(`Refusing the path "${path}": a fixture lives below the fixtures folder`);
    }
    const json = lines[index + 1];
    if (json === undefined) {
      throw new Error(`${path}: the dump ends before its content`);
    }
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch (error) {
      throw new Error(`${path}: the line after its header is not JSON (${(error as Error).message})`, {
        cause: error,
      });
    }
    const file = pretty(value);
    if (sha256(file) !== expected) {
      throw new Error(`${path}: the content does not match its SHA-256, so it was damaged or altered`);
    }
    files.push({ path, text: file });
    index += 1;
  }

  if (files.length === 0) {
    throw new Error('There are no FIXTURE entries in that text');
  }
  return files;
}

/** The files of a fixtures folder in a fixed order: routing, delivery, then the manifest. */
export function readFixtureFolder(folder: string): DumpedFile[] {
  const read = (path: string): DumpedFile => ({ path, text: readFileSync(join(folder, path), 'utf8') });
  const jsonIn = (dir: string) =>
    readdirSync(join(folder, dir))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => read(`${dir}/${name}`));
  return [...jsonIn('routing'), ...jsonIn('delivery'), read('manifest.json')];
}

export function writeDumpedFiles(folder: string, files: readonly DumpedFile[]): void {
  for (const file of files) {
    const target = join(folder, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.text);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, first, second] = process.argv.slice(2);
  if (command === 'dump' && first) {
    console.log(renderDump(readFixtureFolder(first)));
  } else if (command === 'restore' && first && second) {
    const files = parseDump(readFileSync(first, 'utf8'));
    writeDumpedFiles(second, files);
    console.log(`Restored ${files.length} files to ${second}`);
  } else {
    console.error(
      'Usage:\n  tsx tools/conformance/dump.ts dump <fixtures folder>\n  tsx tools/conformance/dump.ts restore <log file> <fixtures folder>',
    );
    process.exit(2);
  }
}

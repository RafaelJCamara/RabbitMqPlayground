import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFixtureSet, type Fixture } from '../conformance/fixtures';
import { OUTSIDE_THE_MODEL } from './replay';
import { BASELINE, renderGolden } from './render';

/** Where the golden files and the fixtures that they come from are, below `web/`. */
export const GOLDEN_ROOT = fileURLToPath(new URL('../../fixtures/explain/', import.meta.url));
export const FIXTURES_ROOT = fileURLToPath(new URL('../../fixtures/conformance/', import.meta.url));

/** The routing fixtures that the model can say, which are the ones that have a golden file. */
export const routingFixtures = (fixtures: readonly Fixture[]): Fixture[] =>
  fixtures.filter(({ kind, id }) => kind === 'routing' && !(id in OUTSIDE_THE_MODEL));

/** What each golden file should say, by its path below the root: `4.3/routing/<name>.txt`. */
export function renderAll(fixtures: readonly Fixture[]): Map<string, string> {
  return new Map(routingFixtures(fixtures).map((fixture) => [`${BASELINE}/${fixture.id}.txt`, renderGolden(fixture)]));
}

/** The golden files that are there, by their path below the root. A missing folder has none. */
export function readGolden(root: string): Map<string, string> {
  const found = new Map<string, string>();
  const list = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        list(join(dir, entry.name));
      } else if (entry.name.endsWith('.txt')) {
        // A checkout with CRLF line endings holds the same text.
        found.set(
          relative(root, join(dir, entry.name)).replaceAll('\\', '/'),
          readFileSync(join(dir, entry.name), 'utf8').replaceAll('\r\n', '\n'),
        );
      }
    }
  };
  try {
    list(root);
  } catch {
    // No folder, no files.
  }
  return found;
}

/** What is wrong with the golden files that are there, one sentence for each, and none when they are what the fixtures render. */
export function checkGolden(generated: ReadonlyMap<string, string>, committed: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const [file, text] of generated) {
    const actual = committed.get(file);
    if (actual === undefined) {
      problems.push(`fixtures/explain/${file} is not there.`);
    } else if (actual !== text) {
      const expected = text.split('\n');
      const lines = actual.split('\n');
      const first = expected.findIndex((line, index) => line !== lines[index]);
      problems.push(
        `fixtures/explain/${file} differs from what its fixture renders, first at line ${(first === -1 ? Math.min(expected.length, lines.length) : first) + 1}.`,
      );
    }
  }
  for (const file of committed.keys()) {
    if (!generated.has(file)) {
      problems.push(`fixtures/explain/${file} has no fixture that renders it.`);
    }
  }
  return problems;
}

/** Writes the golden files and takes away the ones that no fixture renders, so that the folder is exactly what the fixtures say. */
export function writeGolden(root: string, generated: ReadonlyMap<string, string>): void {
  rmSync(join(root, BASELINE), { recursive: true, force: true });
  for (const [file, text] of generated) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
}

/** The routing fixtures that the broker recorded, read from `fixtures/conformance/`. */
export const recordedFixtures = (root: string = FIXTURES_ROOT): Fixture[] =>
  readFixtureSet(root, BASELINE).fixtures as Fixture[];

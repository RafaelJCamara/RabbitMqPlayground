import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FpsRecord } from './fps';
import { checkDrift, parseRecord, renderTable, replaceTable } from './render';

/**
 *   npm run perf:render   rewrites the table of docs/performance.md from docs/performance/records/*.json
 *   npm run perf:check    fails if the table is out of date (`npm run docs:check` runs it too, so CI and the definition of done hold it)
 *
 * `--file=<path>` and `--records=<directory>` point at other files. The specs use them, so they never touch the real ones.
 */
const PERFORMANCE_FILE = new URL('../../../docs/performance.md', import.meta.url);
const RECORDS_DIRECTORY = new URL('../../../docs/performance/records/', import.meta.url);

const optionOf = (name: string): string | undefined =>
  process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const fileArgument = optionOf('--file');
const file = fileArgument ?? fileURLToPath(PERFORMANCE_FILE);
const directory = optionOf('--records') ?? fileURLToPath(RECORDS_DIRECTORY);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// A directory that is not there yet is no records: the first record creates it.
const names = existsSync(directory)
  ? readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort()
  : [];
const records: FpsRecord[] = [];
const problems: string[] = [];
for (const name of names) {
  try {
    records.push(parseRecord(readFileSync(join(directory, name), 'utf8')));
  } catch (error) {
    problems.push(`  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (problems.length > 0) {
  fail(
    `${problems.length} of ${names.length} records in docs/performance/records/ cannot be used:\n${problems.join('\n')}`,
  );
}
if (!existsSync(file)) {
  fail('docs/performance.md does not exist.');
}

const committed = readFileSync(file, 'utf8');
let generated: string;
try {
  generated = replaceTable(committed, renderTable(records));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const noun = records.length === 1 ? 'record' : 'records';
if (process.argv.includes('--check')) {
  const result = checkDrift(generated, committed);
  if (!result.upToDate) {
    fail(`${result.reason}\nRun \`npm run perf:render\` in web/ and commit the result.`);
  }
  console.log(`docs/performance.md is up to date with ${records.length} ${noun}.`);
} else {
  writeFileSync(file, generated);
  console.log(`Wrote ${fileArgument ? file : 'docs/performance.md'} from ${records.length} ${noun}.`);
}

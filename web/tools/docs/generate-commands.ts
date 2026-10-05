import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkDrift, COMMAND_REFERENCE_FILE, generateCommandReference } from './command-reference';

/**
 *   npm run docs:generate   writes docs/commands.md
 *   npm run docs:check      fails if docs/commands.md is out of date (CI and the definition of done, ADR-0015)
 *
 * `--file=<path>` points both at another file. The specs use it, so they never touch the real one.
 */
const fileArgument = process.argv.find((argument) => argument.startsWith('--file='))?.slice('--file='.length);
const file = fileArgument ?? fileURLToPath(COMMAND_REFERENCE_FILE);
const generated = generateCommandReference();

if (process.argv.includes('--check')) {
  const result = checkDrift(generated, existsSync(file) ? readFileSync(file, 'utf8') : null);
  if (!result.upToDate) {
    console.error(`${result.reason}\nRun \`npm run docs:generate\` in web/ and commit the result.`);
    process.exit(1);
  }
  console.log('docs/commands.md is up to date.');
} else {
  writeFileSync(file, generated);
  console.log(`Wrote ${fileArgument ? file : 'docs/commands.md'}`);
}

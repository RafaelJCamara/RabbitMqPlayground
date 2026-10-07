import {
  checkGolden,
  FIXTURES_ROOT,
  GOLDEN_ROOT,
  readGolden,
  recordedFixtures,
  renderAll,
  writeGolden,
} from './golden';

/**
 *   npm run explain:generate   writes web/fixtures/explain/4.3/routing/*.txt
 *   npm run explain:check      fails if a golden file is missing, extra or different (CI and the definition of done, ADR-0015, ADR-0060)
 *
 * `--golden=<dir>` and `--fixtures=<dir>` point at other folders. The specs use them, so they never touch the real ones.
 *
 * A golden file is never regenerated to make a failure go away. Read the difference: a change of wording that is meant is regenerated in the commit that makes it, and shows in its diff,
 * and anything else is a bug in the explanation or in the engine.
 */
const argument = (name: string): string | undefined =>
  process.argv.find((candidate) => candidate.startsWith(`--${name}=`))?.slice(`--${name}=`.length);

const golden = argument('golden') ?? GOLDEN_ROOT;
const generated = renderAll(recordedFixtures(argument('fixtures') ?? FIXTURES_ROOT));

if (process.argv.includes('--check')) {
  const problems = checkGolden(generated, readGolden(golden));
  if (problems.length > 0) {
    console.error(
      `${problems.join('\n')}\nRead the difference before changing anything: a golden file is never regenerated to make a failure go away.`,
    );
    process.exit(1);
  }
  console.log(`${generated.size} golden explanations are up to date.`);
} else {
  writeGolden(golden, generated);
  console.log(`Wrote ${generated.size} golden explanations.`);
}

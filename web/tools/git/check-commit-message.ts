import { readFileSync } from 'node:fs';
import { checkCommitMessage } from './commit-message';

/** The `commit-msg` hook runs this with the path of the file that holds the message (`tsx … <file>`). */
const file = process.argv[2];
if (!file) {
  console.error('Usage: tsx tools/git/check-commit-message.ts <commit message file>');
  process.exit(2);
}

const problems = checkCommitMessage(readFileSync(file, 'utf8'));
if (problems.length > 0) {
  console.error('\nThis commit message does not follow Conventional Commits (see CONTRIBUTING.md):\n');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    '\nFix the message and commit again. Examples:\n  feat(engine): route messages through direct exchanges\n  fix(app): keep the focus ring visible\n',
  );
  process.exit(1);
}

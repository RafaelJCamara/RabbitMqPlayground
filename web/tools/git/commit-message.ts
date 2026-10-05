/**
 * Conventional Commits (ADR-0004): `type(scope): subject`. This checks the first line, plus the blank line before a
 * body. It is the logic behind the `commit-msg` hook in lefthook.yml, kept apart from the hook so it can be tested.
 */

export const COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;

export const MAX_HEADER_LENGTH = 100;

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()\s]*)\))?(?<breaking>!)?: (?<subject>.*)$/;
const SCOPE = /^[a-z0-9][a-z0-9._/,-]*$/;
/** Messages that git itself writes, which have their own shape. */
const GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! )/;

/** Returns what is wrong with a commit message, or an empty list when it is fine. */
export function checkCommitMessage(message: string): string[] {
  // Git leaves its own `#` comment lines in the file when an editor is used.
  const lines = message.split(/\r?\n/).filter((line) => !line.startsWith('#'));
  const headerIndex = lines.findIndex((line) => line.trim() !== '');
  const header = lines[headerIndex];
  if (header === undefined) {
    return ['The commit message is empty.'];
  }

  const problems: string[] = [];
  const nextLine = lines[headerIndex + 1];
  if (nextLine !== undefined && nextLine.trim() !== '') {
    problems.push('Leave a blank line between the first line and the body.');
  }
  if (GENERATED.test(header)) {
    return problems;
  }

  const match = HEADER.exec(header);
  if (!match?.groups) {
    problems.push(
      'The first line must look like "type(scope): subject", for example "feat(engine): route direct exchanges".',
    );
    return problems;
  }

  const { type, scope, subject } = match.groups;
  if (!(COMMIT_TYPES as readonly string[]).includes(type ?? '')) {
    problems.push(`"${type}" is not a commit type. Use one of: ${COMMIT_TYPES.join(', ')}.`);
  }
  if (scope !== undefined && !SCOPE.test(scope)) {
    problems.push(`The scope "${scope}" must be lower case letters, digits, and - . / , (for example "app" or "e2e").`);
  }
  if ((subject ?? '').trim() === '') {
    problems.push('Say what changed after the colon.');
  } else if ((subject ?? '').trimEnd().endsWith('.')) {
    problems.push('Do not end the first line with a full stop.');
  }
  if (header.length > MAX_HEADER_LENGTH) {
    problems.push(
      `The first line is ${header.length} characters. Keep it to ${MAX_HEADER_LENGTH}, and put the rest in the body.`,
    );
  }

  return problems;
}

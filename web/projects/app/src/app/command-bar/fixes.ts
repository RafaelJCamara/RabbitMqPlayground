import { wordText, type Issue } from '@rmq/domain';

/** A kind written before a name, which the replacement keeps: `queue:` in `queue:billng`. */
const QUALIFIER = /^(?:exchange|queue|producer|consumer):/;

/**
 * The line with a suggestion of an issue put where the words at fault were ("did you mean", ADR-0045), or `undefined` when the issue does not say where they were.
 * What is written depends on what was wrong: the name of a command, or a name that the issue wrote already, goes as it is; the name of an option keeps the value that
 * followed it; a value keeps the option in front of it; and any other name goes the way that the grammar reads it, quoted if it has to be, after the kind that was there.
 */
export function applySuggestion(line: string, issue: Issue, suggestion: string): string | undefined {
  if (issue.at === undefined) {
    return undefined;
  }
  const { start, end } = issue.at;
  const words = line.slice(start, end);
  const equals = words.indexOf('=');
  let replacement: string;
  switch (issue.kind) {
    case 'unknown-command':
    case 'ambiguous-name':
      replacement = suggestion;
      break;
    case 'unknown-option':
      replacement = equals === -1 ? suggestion : suggestion + words.slice(equals);
      break;
    case 'invalid-value':
      replacement = words.slice(0, equals + 1) + wordText(suggestion);
      break;
    default:
      replacement = (QUALIFIER.exec(words)?.[0] ?? '') + wordText(suggestion);
  }
  return line.slice(0, start) + replacement + line.slice(end);
}

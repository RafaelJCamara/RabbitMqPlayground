import { didYouMean, joinList } from '../commands/helpers';
import type { Issue } from '../document/issue';
import { suggest } from '../suggest';
import type { Atom } from './tokenizer';

/** Where some tokens are in the text, from the start of the first to the end of the last. There is always one. */
export const rangeOf = (tokens: readonly Atom[]) => ({
  start: (tokens[0] as Atom).start,
  end: (tokens.at(-1) as Atom).end,
});

/**
 * Why the first words are not the name of a command (ADR-0025). `names` are the names of every command, each of one word or
 * two. It is what a line says when it starts with something that is not a command, and what `help` says for a topic that is not one.
 */
export function unknownCommand(tokens: readonly Atom[], words: readonly string[], names: readonly string[]): Issue {
  const [first, second] = words;
  if (first === undefined) {
    return {
      kind: 'syntax',
      message: 'A command starts with its name, for example bind orders -> billing.',
      at: rangeOf(tokens.slice(0, 1)),
    };
  }
  // A word that starts several commands (`declare`, `add`) needs a second word.
  const followers = names
    .map((name) => name.split(' '))
    .filter((name) => name[0] === first && name.length === 2)
    .map((name) => name[1] as string);
  if (followers.length > 0) {
    const close = second === undefined ? [] : suggest(second, followers);
    const options = (close.length > 0 ? close : followers).map((word) => `${first} ${word}`);
    return {
      kind: 'unknown-command',
      message: `${second === undefined ? `'${first}' needs a second word` : `'${first} ${second}' is not a command`}: ${joinList(options, 'or')}.`,
      suggestions: options,
      at: rangeOf(tokens.slice(0, second === undefined ? 1 : 2)),
    };
  }
  const verbs = [...new Set(names.map((name) => name.split(' ')[0] as string))];
  const suggestions = suggest(first, verbs);
  return {
    kind: 'unknown-command',
    message: `There is no command '${first}'.${didYouMean(suggestions)}`,
    ...(suggestions.length === 0 ? {} : { suggestions }),
    at: rangeOf(tokens.slice(0, 1)),
  };
}

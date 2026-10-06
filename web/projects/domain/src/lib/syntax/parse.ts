import { applyCommand } from '../commands/apply';
import { didYouMean, joinList } from '../commands/helpers';
import type { Command, DocumentCommand } from '../commands/types';
import { fail, ok, type Issue, type Result } from '../document/issue';
import type { CanvasDocument } from '../document/schema';
import { suggest } from '../suggest';
import { Cursor, Stop } from './cursor';
import { matchSpec, nameWords, SPECS } from './registry';
import { scratchIds } from './scratch';
import { isAtom, tokenize, type Atom, type Token } from './tokenizer';

/**
 * Reading a typed command (ADR-0011, ADR-0025). The text becomes tokens, the first words name the command, and that
 * command's `parse` reads the rest against the document, so that `billing` is the queue that it is on this canvas. A
 * command that cannot be read says why, where in the text it was, and what was probably meant.
 *
 * `;` makes a batch: each command is read against the canvas that the ones before it made, so a command can name what an
 * earlier one declared, and the batch is one change.
 */

/** Where some tokens are in the text, from the start of the first to the end of the last. There is always one. */
const rangeOf = (tokens: readonly Atom[]) => ({
  start: (tokens[0] as Atom).start,
  end: (tokens.at(-1) as Atom).end,
});

/** The leading words of the command that are bare, which is how a command is named: `"bind"` is not the command `bind`. */
function bareWords(tokens: readonly Atom[]): string[] {
  const words: string[] = [];
  for (const token of tokens) {
    if (token.kind !== 'word' || token.segments.some((segment) => segment.quoted)) {
      break;
    }
    words.push(token.text);
  }
  return words;
}

/** Why the first words are not the name of a command. */
function unknownCommand(tokens: readonly Atom[], words: readonly string[]): Issue {
  const [first, second] = words;
  if (first === undefined) {
    return {
      kind: 'syntax',
      message: 'A command starts with its name, for example bind orders -> billing.',
      at: rangeOf(tokens.slice(0, 1)),
    };
  }
  // A word that starts several commands (`declare`, `add`) needs a second word.
  const followers = SPECS.map(nameWords)
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
  const verbs = [...new Set(SPECS.map((spec) => nameWords(spec)[0] as string))];
  const suggestions = suggest(first, verbs);
  return {
    kind: 'unknown-command',
    message: `There is no command '${first}'.${didYouMean(suggestions)}`,
    ...(suggestions.length === 0 ? {} : { suggestions }),
    at: rangeOf(tokens.slice(0, 1)),
  };
}

/** Reads one command, with no `;` in it. */
function parseOne(tokens: readonly Atom[], document: CanvasDocument): Result<Command> {
  const matched = matchSpec(bareWords(tokens));
  if (matched === undefined) {
    return fail(unknownCommand(tokens, bareWords(tokens)));
  }
  const cursor = new Cursor(tokens.slice(matched.count), document, false, rangeOf(tokens).end);
  try {
    return ok(matched.spec.parse(cursor));
  } catch (error) {
    if (error instanceof Stop) {
      return fail(error.issue);
    }
    throw error;
  }
}

/** The commands between the separators. A command may not be empty, but the last may be left out, as in `a;`. */
function split(tokens: readonly Token[]): Atom[][] | Issue {
  const parts: Atom[][] = [[]];
  for (const token of tokens) {
    if (isAtom(token)) {
      (parts.at(-1) as Atom[]).push(token);
      continue;
    }
    // A separator, which needs a command before it.
    if ((parts.at(-1) as Atom[]).length === 0) {
      return { kind: 'syntax', message: "Expected a command before ';'.", at: { start: token.start, end: token.end } };
    }
    parts.push([]);
  }
  return (parts.at(-1) as Atom[]).length === 0 && parts.length > 1 ? parts.slice(0, -1) : parts;
}

/**
 * Reads a typed command. Several, with `;` between them, are read as a batch: each against the canvas that the ones before
 * it made, which means that each is applied to it on the way, so that an error of the broker's is found at once and says
 * which command it was.
 */
export function parseCommand(text: string, document: CanvasDocument): Result<Command> {
  const tokenized = tokenize(text);
  if (!tokenized.ok) {
    return fail(tokenized.error);
  }
  if (tokenized.tokens.length === 0) {
    return fail({
      kind: 'syntax',
      message: 'Type a command, for example bind orders -> billing.',
      at: { start: 0, end: 0 },
    });
  }
  const parts = split(tokenized.tokens);
  if (!Array.isArray(parts)) {
    return fail(parts);
  }
  if (parts.length === 1) {
    return parseOne(parts[0] as Atom[], document);
  }

  let working = document;
  const commands: DocumentCommand[] = [];
  for (const [index, part] of parts.entries()) {
    const parsed = parseOne(part, working);
    if (!parsed.ok) {
      return fail({ ...parsed.error, batchIndex: index });
    }
    const command = parsed.value;
    if (command.type === 'undo' || command.type === 'redo') {
      return fail({
        kind: 'batch',
        message: `${command.type} is about the history and not the canvas, so it cannot be one of several commands. Type it by itself.`,
        at: rangeOf(part),
        batchIndex: index,
      });
    }
    const applied = applyCommand(
      working,
      command,
      scratchIds(() => working),
    );
    if (!applied.ok) {
      return fail({ ...applied.error, at: applied.error.at ?? rangeOf(part), batchIndex: index });
    }
    working = applied.value;
    commands.push(command);
  }
  return ok({ type: 'batch', commands });
}

import { elements } from '../document/elements';
import { KIND_LABEL } from '../document/issue';
import type { CanvasDocument } from '../document/schema';
import { Cursor, Expectation, type Expected } from './cursor';
import { matchSpec, nameWords, SPECS } from './registry';
import { refText } from './spec';
import { isAtom, tokenize, type Atom } from './tokenizer';
import { QUALIFIERS, wordText } from './words';

/**
 * Autocomplete for the command bar (ADR-0011, ADR-0025). Given the text and where the cursor is, it says what could be
 * typed at the cursor, as replacements for the word that the cursor is in: the name of a command, the names of the
 * elements that fit where the cursor is, `->`, an option and its values.
 *
 * It does not have a grammar of its own. The words that are already typed are run through the command's own `parse` with
 * the cursor in probe mode, which reports what `parse` would have taken next. So it offers what the parser would accept.
 */

export interface CompletionItem {
  /** What goes where the word was. It is written so that it reads back: quoted if it has to be. */
  readonly insert: string;
  /** What to show in the list. */
  readonly label: string;
  readonly kind: 'command' | 'name' | 'keyword' | 'option' | 'value';
  readonly detail?: string;
}

export interface Completion {
  /** The text from `from` to `to` is what the items replace: the word that the cursor is in, or nothing. */
  readonly from: number;
  readonly to: number;
  readonly items: readonly CompletionItem[];
}

const startsLike = (candidate: string, typed: string): boolean =>
  candidate.toLowerCase().startsWith(typed.toLowerCase());

/** The names of commands that go with the words typed so far, as the next word of each. */
function commandItems(words: readonly string[], typed: string): CompletionItem[] {
  const seen = new Set<string>();
  const items: CompletionItem[] = [];
  for (const spec of SPECS) {
    const name = nameWords(spec);
    const next = name[words.length];
    if (
      next !== undefined &&
      words.every((word, index) => name[index] === word) &&
      startsLike(next, typed) &&
      !seen.has(next)
    ) {
      seen.add(next);
      items.push({
        insert: next,
        label: next,
        kind: 'command',
        detail: spec.summary.split('. ')[0],
      });
    }
  }
  return items;
}

/** The elements of the kinds that fit, with the names that start like what was typed. */
function nameItems(
  document: CanvasDocument,
  expected: Extract<Expected, { kind: 'ref' }>,
  typed: string,
): CompletionItem[] {
  const qualifier = QUALIFIERS.find((kind) => typed.startsWith(`${kind}:`));
  const prefix = qualifier === undefined ? typed : typed.slice(qualifier.length + 1);
  const kinds = qualifier === undefined ? expected.elements : expected.elements.filter((kind) => kind === qualifier);

  const items: CompletionItem[] = elements(document)
    .filter(({ kind, name }) => kinds.includes(kind) && startsLike(name, prefix))
    .map(({ kind, name }) => ({
      insert:
        qualifier === undefined ? refText(document, { kind, name }, expected.elements) : `${kind}:${wordText(name)}`,
      label: name,
      kind: 'name' as const,
      detail: KIND_LABEL[kind],
    }));
  if (expected.canvas === true && qualifier === undefined && startsLike('canvas', typed)) {
    items.unshift({ insert: 'canvas', label: 'canvas', kind: 'keyword', detail: 'the canvas itself' });
  }
  return items;
}

/** The options that are left, or the values of the option that is being written. */
function tailItems(expected: Extract<Expected, { kind: 'tail' }>, typed: string): CompletionItem[] {
  const equals = typed.indexOf('=');
  if (equals !== -1) {
    const option = expected.spec.options.find(({ name }) => name === typed.slice(0, equals));
    if (option === undefined || expected.used.includes(option.name)) {
      return [];
    }
    const written = typed.slice(equals + 1);
    const values =
      option.value.kind === 'enum' ? option.value.values : option.value.kind === 'bool' ? ['true', 'false'] : [];
    return values
      .filter((value) => startsLike(value, written))
      .map((value) => ({
        insert: `${option.name}=${value}`,
        label: value,
        kind: 'value' as const,
        detail: option.summary,
      }));
  }

  const items: CompletionItem[] = expected.spec.options
    .filter(({ name }) => !expected.used.includes(name) && startsLike(name, typed))
    .map(({ name, summary }) => ({ insert: `${name}=`, label: `${name}=`, kind: 'option' as const, detail: summary }));
  if (expected.spec.conditions === true && startsLike('exists(', typed)) {
    items.push({ insert: 'exists(', label: 'exists(', kind: 'keyword', detail: 'a header that has to be there' });
  }
  if ((expected.spec.messageHeaders === true || expected.spec.headerNames === true) && startsLike('header:', typed)) {
    items.push({ insert: 'header:', label: 'header:', kind: 'keyword', detail: 'a header of the message' });
  }
  return items;
}

/** What could be typed at `cursor` in `text`. */
export function completeCommand(text: string, cursor: number, document: CanvasDocument): Completion {
  const nothing = (at: number): Completion => ({ from: at, to: at, items: [] });
  const tokenized = tokenize(text.slice(0, cursor));
  if (!tokenized.ok) {
    // The cursor is inside a quoted text that is not closed, which no command can be completed in.
    return nothing(cursor);
  }

  // Only the command that the cursor is in, which is what follows the last `;`.
  const all = tokenized.tokens;
  const current: Atom[] = all.slice(all.findLastIndex((token) => token.kind === 'separator') + 1).filter(isAtom);
  const last = current.at(-1);
  const partial = last?.kind === 'word' && last.end === cursor ? last : undefined;
  const done = partial === undefined ? current : current.slice(0, -1);
  const typed = partial?.text ?? '';
  const from = partial?.start ?? cursor;
  const reply = (items: CompletionItem[]): Completion => ({ from, to: cursor, items });

  // What a command is called is bare words, and anything else before the name of a command is not part of one.
  const words: string[] = [];
  for (const token of done) {
    if (token.kind !== 'word' || token.segments.some((segment) => segment.quoted)) {
      break;
    }
    words.push(token.text);
  }
  const matched = matchSpec(words);
  if (matched === undefined) {
    return words.length === done.length ? reply(commandItems(words, typed)) : nothing(cursor);
  }

  // The words after the name are run through the command's parse, which says what it wants next.
  const probe = new Cursor(done.slice(matched.count), document, true);
  let expected: Expected | undefined;
  try {
    matched.spec.parse(probe);
  } catch (error) {
    if (error instanceof Expectation) {
      expected = error.expected;
    }
  }
  const items: CompletionItem[] = [];
  if (expected?.kind === 'ref') {
    items.push(...nameItems(document, expected, typed));
  } else if (expected?.kind === 'arrow') {
    if ('->'.startsWith(typed)) {
      items.push({ insert: '->', label: '->', kind: 'keyword', detail: 'from … to …' });
    }
  } else if (expected?.kind === 'tail') {
    items.push(...tailItems(expected, typed));
  }
  // `move` and `move label` share a first word: after `move`, the second word of the longer name is also a way to go on.
  if (done.length === matched.count && matched.count === 1) {
    items.push(...commandItems(words, typed));
  }
  return reply(items);
}

import type { Issue } from '../document/issue';

/**
 * The first step of reading a typed command (ADR-0025): the text becomes words, arrows and separators, each with where it
 * is. A word is whitespace-free text that may hold quoted parts, written in JSON's way (`"my queue"`, with `\"` and `\\`
 * and `\n` and `é` inside), the way a shell joins `a"b c"` into one word. So any text can be written as a word, and
 * a word remembers which of its parts were quoted, because a quoted `queue:x` is a name and a bare one is a qualifier, and
 * a quoted `key` before an `=` is a header and a bare one is the option.
 *
 * `->` is an arrow wherever it appears outside quotes, so `bind a->b` is as good as `bind a -> b`, and `;` ends a command.
 * Nothing else is special here: `=` and `(` and `)` are for the parser to read.
 */

/** A part of a word, as typed: bare text, or the contents of a quoted text. */
export interface Segment {
  readonly text: string;
  readonly quoted: boolean;
}

export interface Word {
  readonly kind: 'word';
  readonly segments: readonly Segment[];
  /** The parts joined, whether or not they were quoted. */
  readonly text: string;
  /** Where it is in the typed text: from the first character to just after the last. */
  readonly start: number;
  readonly end: number;
}

export interface Arrow {
  readonly kind: 'arrow';
  readonly start: number;
  readonly end: number;
}

/** `;`, which ends a command and starts the next in a batch. */
export interface Separator {
  readonly kind: 'separator';
  readonly start: number;
  readonly end: number;
}

export type Token = Word | Arrow | Separator;

/** A token that a command is made of: a word or an arrow. A separator ends a command and is not part of one. */
export type Atom = Word | Arrow;

/** Whether a token is a part of a command, and not the `;` between two. */
export const isAtom = (token: Token): token is Atom => token.kind !== 'separator';

export type Tokenized =
  { readonly ok: true; readonly tokens: readonly Token[] } | { readonly ok: false; readonly error: Issue };

const isSpace = (character: string): boolean => /\s/.test(character);

/** Reads a quoted text that starts at `start`, which is a `"`, and returns what it says and where it ends. */
function readQuoted(text: string, start: number): { value: string; end: number } | Issue {
  let end = start + 1;
  while (end < text.length && text[end] !== '"') {
    end += text[end] === '\\' ? 2 : 1;
  }
  if (end >= text.length) {
    return {
      kind: 'syntax',
      message: 'A quoted text is not closed: add the closing ".',
      at: { start, end: text.length },
    };
  }
  try {
    return { value: JSON.parse(text.slice(start, end + 1)) as string, end: end + 1 };
  } catch {
    return {
      kind: 'syntax',
      message:
        'A quoted text may only have the escapes \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX, and a tab or a line break has to be written as \\t or \\n.',
      at: { start, end: end + 1 },
    };
  }
}

/** Splits typed text into tokens. Quoted text that is not closed, or has an escape that JSON does not have, is an error. */
export function tokenize(text: string): Tokenized {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const character = text[at] as string;
    if (isSpace(character)) {
      at += 1;
    } else if (character === ';') {
      tokens.push({ kind: 'separator', start: at, end: at + 1 });
      at += 1;
    } else if (text.startsWith('->', at)) {
      tokens.push({ kind: 'arrow', start: at, end: at + 2 });
      at += 2;
    } else {
      const start = at;
      const segments: Segment[] = [];
      while (at < text.length && !isSpace(text[at] as string) && text[at] !== ';' && !text.startsWith('->', at)) {
        if (text[at] === '"') {
          const quoted = readQuoted(text, at);
          if ('kind' in quoted) {
            return { ok: false, error: quoted };
          }
          segments.push({ text: quoted.value, quoted: true });
          at = quoted.end;
        } else {
          let end = at;
          while (
            end < text.length &&
            !isSpace(text[end] as string) &&
            text[end] !== ';' &&
            text[end] !== '"' &&
            !text.startsWith('->', end)
          ) {
            end += 1;
          }
          segments.push({ text: text.slice(at, end), quoted: false });
          at = end;
        }
      }
      tokens.push({ kind: 'word', segments, text: segments.map((segment) => segment.text).join(''), start, end: at });
    }
  }
  return { ok: true, tokens };
}

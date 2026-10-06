import type { ElementKind } from '../document/issue';
import type { Segment, Word } from './tokenizer';

/**
 * Writing words and reading them back (ADR-0025). A name, a key or a value is written bare when it can be read back as
 * what it is, and in quotes when it cannot. What the tokenizer and the parser treat as special is the whole list: space,
 * `;`, `"`, `->`, `=`, `(` and `)`, and a name that starts like a qualifier.
 */

export const QUALIFIERS: readonly ElementKind[] = ['exchange', 'queue', 'producer', 'consumer'];

/** Whether the text starts with `exchange:`, `queue:`, `producer:` or `consumer:`, which would read as a qualifier. */
export const startsWithQualifier = (text: string): boolean => QUALIFIERS.some((kind) => text.startsWith(`${kind}:`));

/** Whether the text can be written without quotes and read back as itself. */
export function isBareSafe(text: string): boolean {
  return text !== '' && !/[\s;"=()]/.test(text) && !text.includes('->') && !startsWithQualifier(text);
}

/** The text as a quoted text, which is JSON's string syntax: any text at all can be written like that. */
export const quote = (text: string): string => JSON.stringify(text);

/** A name, a key or a word, bare if it can be and quoted if it cannot. */
export const wordText = (text: string): string => (isBareSafe(text) ? text : quote(text));

/** The kind and the rest of the name, when a word starts with a bare qualifier. */
export function splitQualifier(word: Word): { readonly kind: ElementKind | null; readonly name: string } {
  const [first, ...rest] = word.segments;
  if (first !== undefined && !first.quoted) {
    for (const kind of QUALIFIERS) {
      const prefix = `${kind}:`;
      if (first.text.startsWith(prefix)) {
        return { kind, name: [first.text.slice(prefix.length), ...rest.map((segment) => segment.text)].join('') };
      }
    }
  }
  return { kind: null, name: word.text };
}

/**
 * Splits a word at its first `=` that is not quoted: what is before it, and what is after. `null` for a word with no
 * `=` outside quotes. A part that is quoted is never read as structure, so `"a=b"` is a name and `a=b` is an assignment.
 */
export function splitAssignment(
  word: Word,
): { readonly key: readonly Segment[]; readonly value: readonly Segment[] } | null {
  for (const [index, segment] of word.segments.entries()) {
    const at = segment.quoted ? -1 : segment.text.indexOf('=');
    if (at !== -1) {
      const before: Segment[] = [
        ...word.segments.slice(0, index),
        ...(at > 0 ? [{ text: segment.text.slice(0, at), quoted: false }] : []),
      ];
      const after: Segment[] = [
        ...(at + 1 < segment.text.length ? [{ text: segment.text.slice(at + 1), quoted: false }] : []),
        ...word.segments.slice(index + 1),
      ];
      return { key: before, value: after };
    }
  }
  return null;
}

/** The text of some segments joined. */
export const textOf = (segments: readonly Segment[]): string => segments.map((segment) => segment.text).join('');

/** Whether any of the segments was quoted. */
export const anyQuoted = (segments: readonly Segment[]): boolean => segments.some((segment) => segment.quoted);

const EXISTS_OPEN = 'exists(';

/**
 * The name inside `exists(name)`, as segments, when a word is written like that: the first part is bare and starts with
 * `exists(`, and the last is bare and ends with `)`. The name may be quoted, so `exists("a b")` is the header `a b`.
 * An empty name comes back as no segments.
 */
export function parseExists(word: Word): readonly Segment[] | null {
  const first = word.segments[0];
  const last = word.segments.at(-1);
  if (first === undefined || last === undefined || first.quoted || last.quoted) {
    return null;
  }
  if (!first.text.startsWith(EXISTS_OPEN) || !last.text.endsWith(')')) {
    return null;
  }
  const inner: Segment[] =
    word.segments.length === 1
      ? [{ text: first.text.slice(EXISTS_OPEN.length, -1), quoted: false }]
      : [
          { text: first.text.slice(EXISTS_OPEN.length), quoted: false },
          ...word.segments.slice(1, -1),
          { text: last.text.slice(0, -1), quoted: false },
        ];
  return inner.filter((segment) => segment.quoted || segment.text !== '');
}

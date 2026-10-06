import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { tokenize, type Token } from './tokenizer';

/** The tokens as short text, for a spec to read: words as their text, quoted parts in quotes, and `->` and `;`. */
function shape(text: string): string[] {
  const result = tokenize(text);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.tokens.map((token: Token) =>
    token.kind === 'arrow'
      ? '->'
      : token.kind === 'separator'
        ? ';'
        : token.segments.map((segment) => (segment.quoted ? `"${segment.text}"` : segment.text)).join('|'),
  );
}

describe('tokenize', () => {
  describe('words', () => {
    it('splits on whitespace of any kind, and gives where each word starts and ends', () => {
      const result = tokenize('  bind   orders\tbilling \n');

      expect(result.ok && result.tokens).toEqual([
        { kind: 'word', segments: [{ text: 'bind', quoted: false }], text: 'bind', start: 2, end: 6 },
        { kind: 'word', segments: [{ text: 'orders', quoted: false }], text: 'orders', start: 9, end: 15 },
        { kind: 'word', segments: [{ text: 'billing', quoted: false }], text: 'billing', start: 16, end: 23 },
      ]);
    });

    it('is nothing for text with nothing in it', () => {
      expect(shape('')).toEqual([]);
      expect(shape('   \t\n ')).toEqual([]);
    });

    it('takes every character that is not special as part of a word, including = ( ) # * . : - and non-ASCII letters', () => {
      expect(shape('a=b exists(x) # * a.b:c-d é日本 queue:q key=a.#')).toEqual([
        'a=b',
        'exists(x)',
        '#',
        '*',
        'a.b:c-d',
        'é日本',
        'queue:q',
        'key=a.#',
      ]);
    });

    it('takes a single quote and a backslash outside quotes as ordinary characters', () => {
      expect(shape("it's a\\b")).toEqual(["it's", 'a\\b']);
    });

    it('splits on the whitespace that JavaScript knows, which includes a non-breaking space', () => {
      expect(shape('a\u00a0b\u2003c')).toEqual(['a', 'b', 'c']);
    });
  });

  describe('arrows and separators', () => {
    it('reads -> as an arrow, with or without spaces around it', () => {
      expect(shape('a -> b')).toEqual(['a', '->', 'b']);
      expect(shape('a->b')).toEqual(['a', '->', 'b']);
      expect(shape('a ->b')).toEqual(['a', '->', 'b']);
      expect(shape('->')).toEqual(['->']);
    });

    it('does not read a - or a > alone as an arrow, and keeps a name with dashes whole', () => {
      expect(shape('order-events a>b a- >b')).toEqual(['order-events', 'a>b', 'a-', '>b']);
    });

    it('reads ; as a separator wherever it is, and gives where it is', () => {
      expect(shape('a;b ; c;')).toEqual(['a', ';', 'b', ';', 'c', ';']);
      const result = tokenize('a;b');

      expect(result.ok && result.tokens[1]).toEqual({ kind: 'separator', start: 1, end: 2 });
    });

    it('gives where an arrow is', () => {
      const result = tokenize('a -> b');

      expect(result.ok && result.tokens[1]).toEqual({ kind: 'arrow', start: 2, end: 4 });
    });

    it('does not read an arrow or a separator inside quotes', () => {
      expect(shape('"a -> b" "c;d"')).toEqual(['"a -> b"', '"c;d"']);
    });
  });

  describe('quoted text', () => {
    it('is a word on its own, with the quotes left off, and says that it was quoted', () => {
      const result = tokenize('"my queue"');

      expect(result.ok && result.tokens).toEqual([
        { kind: 'word', segments: [{ text: 'my queue', quoted: true }], text: 'my queue', start: 0, end: 10 },
      ]);
    });

    it('is a part of a word when it touches other text, which is how key="a b" and queue:"my queue" are one word', () => {
      expect(shape('key="a b"')).toEqual(['key=|"a b"']);
      expect(shape('queue:"my queue"')).toEqual(['queue:|"my queue"']);
      expect(shape('a"b c"d')).toEqual(['a|"b c"|d']);
      expect(shape('"a""b"')).toEqual(['"a"|"b"']);
      const joined = tokenize('a"b c"d');

      expect(joined.ok && joined.tokens[0]?.kind === 'word' && joined.tokens[0].text).toBe('ab cd');
    });

    it('reads the escapes of JSON: \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX', () => {
      expect(shape('"a\\"b"')).toEqual(['"a"b"']);
      expect(shape('"a\\\\b"')).toEqual(['"a\\b"']);
      expect(shape('"\\u00e9\\n\\t"')).toEqual(['"é\n\t"']);
      expect(shape('"\\/"')).toEqual(['"/"']);
    });

    it('can hold a quoted text that is empty, which is how the default exchange is written', () => {
      expect(shape('""')).toEqual(['""']);
      const result = tokenize('a ""');

      expect(result.ok && result.tokens[1]).toMatchObject({ text: '', start: 2, end: 4 });
    });

    it('can hold a lone surrogate that JSON writes as an escape, and text beyond the basic plane', () => {
      expect(shape('"\\ud800"')).toEqual([`"${'\ud800'}"`]);
      expect(shape('"😀"')).toEqual(['"😀"']);
    });

    it('is refused when it is not closed, and says where it starts', () => {
      const result = tokenize('bind "my queue');

      expect(result).toMatchObject({ ok: false, error: { kind: 'syntax', at: { start: 5, end: 14 } } });
      expect(!result.ok && result.error.message).toBe('A quoted text is not closed: add the closing ".');
    });

    it('is refused when the last quote is escaped, and when a backslash is the last character', () => {
      expect(tokenize('"a\\"').ok).toBe(false);
      expect(tokenize('"a\\').ok).toBe(false);
      expect(tokenize('"').ok).toBe(false);
    });

    it('is refused when it has an escape that JSON does not have, or a raw line break or tab, and says what is allowed', () => {
      for (const bad of ['"a\\xb"', '"a\\qb"', '"a\nb"', '"a\tb"', '"\\u12"']) {
        const result = tokenize(bad);

        expect(result.ok, JSON.stringify(bad)).toBe(false);
        expect(!result.ok && result.error.message).toContain('A quoted text may only have the escapes');
        expect(!result.ok && result.error.at).toEqual({ start: 0, end: bad.length });
      }
    });
  });

  it('keeps each token at the offsets of the text it came from, so that an error can point at it', () => {
    const text = 'bind  "a b" -> c ;  x';
    const result = tokenize(text);

    expect(result.ok && result.tokens.map((token) => text.slice(token.start, token.end))).toEqual([
      'bind',
      '"a b"',
      '->',
      'c',
      ';',
      'x',
    ]);
  });

  it('gives tokens that are in order and do not overlap, for any text that it takes', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (text) => {
        const result = tokenize(text);
        if (result.ok) {
          let end = 0;
          for (const token of result.tokens) {
            expect(token.start).toBeGreaterThanOrEqual(end);
            expect(token.end).toBeGreaterThan(token.start);
            end = token.end;
          }
          expect(end).toBeLessThanOrEqual(text.length);
        }
      }),
    );
  });

  it('never throws, whatever the text is, and gives either tokens or an error', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (text) => {
        expect(typeof tokenize(text).ok).toBe('boolean');
      }),
    );
  });
});

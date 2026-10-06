import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { tokenize, type Word } from './tokenizer';
import {
  anyQuoted,
  isBareSafe,
  parseExists,
  quote,
  QUALIFIERS,
  splitAssignment,
  splitQualifier,
  startsWithQualifier,
  textOf,
  wordText,
} from './words';

/** The only word in some text. */
function word(text: string): Word {
  const result = tokenize(text);
  const [token] = result.ok ? result.tokens : [];
  if (token?.kind !== 'word') {
    throw new Error(`"${text}" is not one word`);
  }
  return token;
}

describe('isBareSafe and wordText', () => {
  it.each([
    'orders',
    'order.created',
    'a-b_c',
    'order.*',
    '#',
    '*',
    'a#b',
    '日本',
    'é',
    'x:y',
    'a\\b',
    "it's",
    'a,b',
    'a/b',
    '0',
    'true',
  ])('writes %j as it is', (text) => {
    expect(isBareSafe(text)).toBe(true);
    expect(wordText(text)).toBe(text);
  });

  it.each([
    ['nothing', ''],
    ['a space', 'a b'],
    ['a tab', 'a\tb'],
    ['a line break', 'a\nb'],
    ['a non-breaking space', 'a b'],
    ['a semicolon', 'a;b'],
    ['a double quote', 'a"b'],
    ['an equals sign', 'a=b'],
    ['an opening parenthesis', 'a(b'],
    ['a closing parenthesis', 'a)b'],
    ['an arrow', 'a->b'],
    ['an arrow alone', '->'],
    ['the start of a qualifier: exchange:', 'exchange:x'],
    ['the start of a qualifier: queue:', 'queue:x'],
    ['the start of a qualifier: producer:', 'producer:'],
    ['the start of a qualifier: consumer:', 'consumer:x'],
  ])('writes %s in quotes', (_what, text) => {
    expect(isBareSafe(text)).toBe(false);
    expect(wordText(text)).toBe(JSON.stringify(text));
  });

  it('writes a word that merely contains a qualifier, or is one without its colon, as it is', () => {
    expect(wordText('myqueue:x')).toBe('myqueue:x');
    expect(wordText('queue')).toBe('queue');
    expect(wordText('Queue:x')).toBe('Queue:x');
  });

  it('writes text that reads back as itself, whatever the text is', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 30 }), (text) => {
        const result = tokenize(wordText(text));

        expect(result.ok).toBe(true);
        const tokens = result.ok ? result.tokens : [];

        expect(tokens).toHaveLength(1);
        expect(tokens[0]?.kind === 'word' && tokens[0].text).toBe(text);
        // A bare word is read as a bare word, which is what a qualifier or an assignment would be read from.
        expect(tokens[0]?.kind === 'word' && anyQuoted(tokens[0].segments)).toBe(!isBareSafe(text));
      }),
    );
  });

  it('writes text that has lone surrogates and control characters, which only quotes can say', () => {
    for (const text of ['\ud800', '\u0000', 'a\u001fb', '\u007f', ' ']) {
      const result = tokenize(wordText(text));

      expect(
        result.ok && result.tokens[0]?.kind === 'word' && (result.tokens[0] as Word).text,
        JSON.stringify(text),
      ).toBe(text);
    }
  });
});

describe('quote', () => {
  it('is JSON’s string syntax', () => {
    expect(quote('a"b\\c\n')).toBe('"a\\"b\\\\c\\n"');
    expect(quote('')).toBe('""');
  });
});

describe('startsWithQualifier and QUALIFIERS', () => {
  it('lists the four kinds that a qualifier can name', () => {
    expect(QUALIFIERS).toEqual(['exchange', 'queue', 'producer', 'consumer']);
  });

  it('is true for a text that starts with a kind and a colon', () => {
    expect(startsWithQualifier('queue:x')).toBe(true);
    expect(startsWithQualifier('queue:')).toBe(true);
    expect(startsWithQualifier('queue')).toBe(false);
    expect(startsWithQualifier(' queue:x')).toBe(false);
    expect(startsWithQualifier('canvas:x')).toBe(false);
  });
});

describe('splitQualifier', () => {
  it('reads a bare qualifier, and what follows it as the name', () => {
    expect(splitQualifier(word('queue:billing'))).toEqual({ kind: 'queue', name: 'billing' });
    expect(splitQualifier(word('exchange:orders'))).toEqual({ kind: 'exchange', name: 'orders' });
    expect(splitQualifier(word('producer:p'))).toEqual({ kind: 'producer', name: 'p' });
    expect(splitQualifier(word('consumer:c'))).toEqual({ kind: 'consumer', name: 'c' });
  });

  it('reads a name that has colons of its own after the qualifier', () => {
    expect(splitQualifier(word('queue:a:b'))).toEqual({ kind: 'queue', name: 'a:b' });
    expect(splitQualifier(word('queue:queue:x'))).toEqual({ kind: 'queue', name: 'queue:x' });
  });

  it('reads a quoted name after a bare qualifier, which is how a name that needs quotes is qualified', () => {
    expect(splitQualifier(word('queue:"my queue"'))).toEqual({ kind: 'queue', name: 'my queue' });
    expect(splitQualifier(word('queue:'))).toEqual({ kind: 'queue', name: '' });
    expect(splitQualifier(word('queue:""'))).toEqual({ kind: 'queue', name: '' });
  });

  it('reads no qualifier in a word that is quoted from its first character, so that a name can start like one', () => {
    expect(splitQualifier(word('"queue:x"'))).toEqual({ kind: null, name: 'queue:x' });
    expect(splitQualifier(word('"queue":x'))).toEqual({ kind: null, name: 'queue:x' });
  });

  it('reads no qualifier in a word that does not start with one', () => {
    expect(splitQualifier(word('orders'))).toEqual({ kind: null, name: 'orders' });
    expect(splitQualifier(word('xqueue:x'))).toEqual({ kind: null, name: 'xqueue:x' });
    expect(splitQualifier(word('canvas:x'))).toEqual({ kind: null, name: 'canvas:x' });
  });
});

describe('splitAssignment', () => {
  it('splits at the first bare =, and gives what is before and after', () => {
    const split = splitAssignment(word('key=order.*'));

    expect(split && [textOf(split.key), textOf(split.value)]).toEqual(['key', 'order.*']);
    const second = splitAssignment(word('a=b=c'));

    expect(second && [textOf(second.key), textOf(second.value)]).toEqual(['a', 'b=c']);
  });

  it('is nothing for a word with no bare =, including one with an = in quotes', () => {
    expect(splitAssignment(word('orders'))).toBeNull();
    expect(splitAssignment(word('"a=b"'))).toBeNull();
    expect(splitAssignment(word('x"=y"'))).toBeNull();
  });

  it('has an empty side when there is nothing on it', () => {
    const noKey = splitAssignment(word('=x'));
    const noValue = splitAssignment(word('x='));

    expect(noKey && [textOf(noKey.key), textOf(noKey.value)]).toEqual(['', 'x']);
    expect(noValue && [textOf(noValue.key), textOf(noValue.value)]).toEqual(['x', '']);
    // Nothing on a side is no segments, and not a segment of no text.
    expect(noKey?.key).toEqual([]);
    expect(noValue?.value).toEqual([]);
    expect(splitAssignment(word('='))).toEqual({ key: [], value: [] });
  });

  it('keeps quoted parts on the side that they were on, and remembers that they were quoted', () => {
    const quotedKey = splitAssignment(word('"my key"=1'));
    const quotedValue = splitAssignment(word('k="a b"'));
    const both = splitAssignment(word('pre"fix"=post"fix"'));

    expect(
      quotedKey && [
        textOf(quotedKey.key),
        anyQuoted(quotedKey.key),
        textOf(quotedKey.value),
        anyQuoted(quotedKey.value),
      ],
    ).toEqual(['my key', true, '1', false]);
    expect(
      quotedValue && [
        textOf(quotedValue.key),
        anyQuoted(quotedValue.key),
        textOf(quotedValue.value),
        anyQuoted(quotedValue.value),
      ],
    ).toEqual(['k', false, 'a b', true]);
    expect(both && [textOf(both.key), textOf(both.value)]).toEqual(['prefix', 'postfix']);
  });

  it('puts a bare = that comes after a quoted part on the value side of the key, as in header:"a b"=1', () => {
    const split = splitAssignment(word('header:"a b"=1'));

    expect(split && textOf(split.key)).toBe('header:a b');
    expect(split && split.key[0]).toEqual({ text: 'header:', quoted: false });
    expect(split && textOf(split.value)).toBe('1');
  });
});

describe('parseExists', () => {
  it('reads the name inside exists( ), bare or quoted', () => {
    expect(
      parseExists(word('exists(format)'))
        ?.map((segment) => segment.text)
        .join(''),
    ).toBe('format');
    expect(
      parseExists(word('exists("a b")'))
        ?.map((segment) => segment.text)
        .join(''),
    ).toBe('a b');
    expect(
      parseExists(word('exists(a"b c"d)'))
        ?.map((segment) => segment.text)
        .join(''),
    ).toBe('ab cd');
    expect(parseExists(word('exists(x-retry)'))).toEqual([{ text: 'x-retry', quoted: false }]);
  });

  it('reads an empty name as no segments, for the caller to refuse', () => {
    expect(parseExists(word('exists()'))).toEqual([]);
    expect(parseExists(word('exists("")'))).toEqual([{ text: '', quoted: true }]);
  });

  it('reads nothing in a word that is not written like that', () => {
    for (const text of [
      'exists',
      'exists(',
      'exists)',
      'exists(a',
      'xexists(a)',
      'a=exists(b)',
      '"exists(a)"',
      'exists(a)"x"',
      '"exists("a)',
      'exists(a")"',
      '"exists("a")"',
      'Exists(a)',
      'exists a',
    ]) {
      expect(parseExists(word(text.replace(' ', '')) as Word), text).toBeNull();
    }
  });

  it('reads the parentheses that are in a name too, as the name goes to the last one', () => {
    expect(
      parseExists(word('exists(a(b))'))
        ?.map((segment) => segment.text)
        .join(''),
    ).toBe('a(b)');
  });
});

describe('textOf and anyQuoted', () => {
  it('join segments and say whether any was quoted', () => {
    const segments = [
      { text: 'a', quoted: false },
      { text: 'b c', quoted: true },
    ];

    expect(textOf(segments)).toBe('ab c');
    expect(anyQuoted(segments)).toBe(true);
    expect(anyQuoted([{ text: 'a', quoted: false }])).toBe(false);
    expect(anyQuoted([])).toBe(false);
    expect(textOf([])).toBe('');
  });
});

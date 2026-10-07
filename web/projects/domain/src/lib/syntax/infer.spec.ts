import { type HeaderValue } from '@rmq/engine';
import { bool, float, int, str } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseMessageText } from './message';
import { tokenize } from './tokenizer';
import {
  formatValue,
  inferValue,
  needsValueOf,
  parseValue,
  readType,
  readValue,
  retypeValue,
  VALUE_TYPES,
  type ValueType,
} from './values';

/** What the table of ADR-0067 says of a text: the value it is, or a piece of the sentence that refuses it. */
type Case = readonly [typed: string, is: HeaderValue | string];

/**
 * The table of cases of the type of a value (ADR-0067, ADR-0025): what a field's text is, case by case. A text is a value as a command writes it after the `=`, so every case that is one word is also a
 * case of the grammar, which the second table checks against `publish`.
 */
const CASES: readonly Case[] = [
  // Strings: any other word, and anything in quotes.
  ['pdf', str('pdf')],
  ['a.b', str('a.b')],
  ['True', str('True')],
  ['TRUE', str('TRUE')],
  ['1x', str('1x')],
  ['null', str('null')],
  ['NaN', str('NaN')],
  ['Infinity', str('Infinity')],
  ['-Infinity', str('-Infinity')],
  ['"pdf"', str('pdf')],
  ['"1"', str('1')],
  ['"1.0"', str('1.0')],
  ['"true"', str('true')],
  ['"false"', str('false')],
  ['""', str('')],
  ['" "', str(' ')],
  ['"a b"', str('a b')],
  ['"a\\"b"', str('a"b')],
  ['"line\\nbreak"', str('line\nbreak')],
  ['"tab\\there"', str('tab\there')],
  ['"\\u00e9"', str('é')],
  ['"a\\\\b"', str('a\\b')],
  ['1"0"', str('10')],
  ['a"b"', str('ab')],
  // Not a number as it is written: a learner who means one writes it another way.
  ['+1', str('+1')],
  ['.5', str('.5')],
  ['5.', str('5.')],
  ['1,5', str('1,5')],
  ['1_000', str('1_000')],
  ['0x10', str('0x10')],
  ['--1', str('--1')],
  ['-', str('-')],
  ['1e', str('1e')],
  ['1e+', str('1e+')],
  ['1.2.3', str('1.2.3')],
  // Text with spaces or the marks of the grammar in it is a string as it was typed.
  ['my report', str('my report')],
  ['a=b', str('a=b')],
  ['a->b', str('a->b')],
  ['x;y', str('x;y')],
  ['exists(x)', str('exists(x)')],
  ['"a" "b"', str('"a" "b"')],
  [';', str(';')],
  // Integers.
  ['1', int(1)],
  ['0', int(0)],
  ['-1', int(-1)],
  ['007', int(7)],
  ['-0', int(0)],
  ['9007199254740991', int(Number.MAX_SAFE_INTEGER)],
  ['-9007199254740991', int(Number.MIN_SAFE_INTEGER)],
  // Floats.
  ['1.0', float(1)],
  ['1.50', float(1.5)],
  ['-0.25', float(-0.25)],
  ['0.0', float(0)],
  ['-0.0', float(-0)],
  ['1e3', float(1000)],
  ['1E3', float(1000)],
  ['1E+3', float(1000)],
  ['1.5e-3', float(0.0015)],
  // Booleans, in lower case only.
  ['true', bool(true)],
  ['false', bool(false)],
  // The spaces round a text are the field's.
  ['  7  ', int(7)],
  ['\t1.5\n', float(1.5)],
  ['  pdf ', str('pdf')],
  ['  "a b"  ', str('a b')],
  [' true ', bool(true)],
  // Refused.
  ['', 'A header needs a value'],
  ['   ', 'A header needs a value'],
  ['"abc', 'A quoted text is not closed'],
  ['"a\\qb"', 'A quoted text may only have the escapes'],
  ['9007199254740993', 'An integer header must be a whole number from -9007199254740991 to 9007199254740991'],
  ['-9007199254740993', 'An integer header must be a whole number'],
  ['99999999999999999999', 'An integer header must be a whole number'],
  ['1e999', 'A float header must be a finite number'],
  ['-1e999', 'A float header must be a finite number'],
];

describe('the type of what is typed (ADR-0067)', () => {
  it.each(CASES)('reads %j', (typed, is) => {
    const read = inferValue(typed);

    if (typeof is === 'string') {
      expect(read.ok).toBe(false);
      expect(read.ok ? '' : read.error.message).toContain(is);
    } else {
      expect(read).toStrictEqual({ ok: true, value: is });
    }
  });

  it('keeps `"1"`, `1`, `1.0` and `true` apart, which is the lesson of a headers exchange', () => {
    const values = ['"1"', '1', '1.0', 'true'].map((typed) => inferValue(typed));

    expect(values).toStrictEqual([
      { ok: true, value: str('1') },
      { ok: true, value: int(1) },
      { ok: true, value: float(1) },
      { ok: true, value: bool(true) },
    ]);
  });

  it('refuses an empty field and not the empty string: `""` is the empty string', () => {
    expect(inferValue('').ok).toBe(false);
    expect(inferValue('""')).toStrictEqual({ ok: true, value: str('') });
  });

  it('says the root cause first, in the words of the command for a number that is out of range, with the name when it has one', () => {
    const unsafe = inferValue('9007199254740993', 'n');
    const unnamed = inferValue('9007199254740993');

    expect(unsafe.ok ? '' : unsafe.error.message).toMatch(/^The header 'n': An integer header must be a whole number/u);
    expect(unnamed.ok ? '' : unnamed.error.message).toMatch(/^An integer header must be a whole number/u);
    expect(unnamed.ok ? '' : unnamed.error.kind).toBe('header');
  });

  it('refuses a text that is longer than a header value may be, with the sentence a command gives', () => {
    const long = inferValue(`"${'x'.repeat(10_001)}"`, 'k');

    expect(long.ok ? '' : long.error.message).toBe(
      "The header 'k': a value that is text is at most 10,000 characters, and this one has 10,001.",
    );
    expect(inferValue(`"${'x'.repeat(10_000)}"`).ok).toBe(true);
  });

  it('says where a quote that is not closed starts, so that the grammar and the field have one sentence', () => {
    const read = inferValue('  "abc');

    expect(read.ok ? null : read.error).toMatchObject({ kind: 'syntax', at: { start: 0, end: 4 } });
  });

  it('says the type that a text reads as, before anything is asked of the engine', () => {
    expect(['1', '"1"', '1.0', 'true', 'pdf', '9007199254740993', '1e999'].map(readType)).toEqual([
      'integer',
      'string',
      'float',
      'boolean',
      'string',
      'integer',
      'float',
    ]);
    expect(['', '  ', '"abc'].map(readType)).toEqual([null, null, null]);
  });
});

describe('the field and the grammar read a value alike (ADR-0067)', () => {
  /** The same word as the value of a header of a message, in a command line. */
  const inLine = (word: string) => {
    const message = parseMessageText(`header:k=${word}`);
    return message.ok ? message.value.headers[0]?.value : undefined;
  };

  it.each(CASES.filter(([typed, is]) => typeof is !== 'string' && !/[\s;]|->/u.test(typed.replace(/"[^"]*"/gu, ''))))(
    'reads %j as the command line reads it',
    (typed, is) => {
      expect(inLine(typed)).toStrictEqual(is);
    },
  );

  it('refuses in the line what it refuses in the field', () => {
    for (const typed of ['9007199254740993', '1e999', '"abc', '"a\\qb"']) {
      expect(parseMessageText(`header:k=${typed}`).ok).toBe(false);
      expect(inferValue(typed).ok).toBe(false);
    }
  });

  it('reads the pieces of a word with the same function that the field uses once it has made a word of its text', () => {
    const word = tokenize('9007199254740993');
    const [token] = word.ok ? word.tokens : [];
    if (token?.kind !== 'word') {
      throw new Error('one word');
    }

    expect(readValue(token.segments, 'n')).toStrictEqual(inferValue('9007199254740993', 'n'));
    expect(readValue(token.segments, null)).toStrictEqual(inferValue('9007199254740993'));
    expect(readValue(token.segments, 'n')).not.toStrictEqual(parseValue(token.segments));
  });

  it('reads nothing after an `=` in the line as the empty string, because the `=` was typed', () => {
    expect(inLine('')).toStrictEqual(str(''));
    expect(inferValue('').ok).toBe(false);
  });
});

describe('a type is changed by rewriting the text (ADR-0067)', () => {
  type Change = readonly [from: string, to: ValueType, becomes: string | RegExp];

  const CHANGES: readonly Change[] = [
    // To a string: the digits as they were typed, in quotes.
    ['1', 'string', '"1"'],
    ['007', 'string', '"007"'],
    ['1.50', 'string', '"1.50"'],
    ['-0.0', 'string', '"-0.0"'],
    ['1e3', 'string', '"1e3"'],
    ['true', 'string', '"true"'],
    ['9007199254740993', 'string', '"9007199254740993"'],
    ['  7 ', 'string', '"7"'],
    // To an integer: digits, exactly.
    ['"1"', 'integer', '1'],
    ['"007"', 'integer', '7'],
    ['"-0"', 'integer', '0'],
    ['"-12"', 'integer', '-12'],
    ['1.0', 'integer', '1'],
    ['1e3', 'integer', '1000'],
    ['-0.0', 'integer', '0'],
    ['"1.0"', 'integer', '1'],
    ['"9007199254740993"', 'integer', '9007199254740993'],
    ['"99999999999999999999"', 'integer', '99999999999999999999'],
    // To a float.
    ['1', 'float', '1.0'],
    ['-0', 'float', '0.0'],
    ['-7', 'float', '-7.0'],
    ['"1"', 'float', '1.0'],
    ['"1.5"', 'float', '1.5'],
    ['"1.50"', 'float', '1.50'],
    ['"1e3"', 'float', '1e3'],
    // To a boolean.
    ['"true"', 'boolean', 'true'],
    ['"false"', 'boolean', 'false'],
    // The same type: the text as it was typed, trimmed.
    ['1', 'integer', '1'],
    ['  007  ', 'integer', '007'],
    ['"1"', 'string', '"1"'],
    ['pdf', 'string', 'pdf'],
    ['1.50', 'float', '1.50'],
    ['true', 'boolean', 'true'],
    // Nothing says nothing.
    ['', 'integer', ''],
    ['  ', 'string', '  '],
    // Refused, with the cause first.
    ['"pdf"', 'integer', /^"pdf" is not a whole number, so it cannot be an integer/u],
    ['pdf', 'integer', /^"pdf" is not a whole number/u],
    ['1.5', 'integer', /^1\.5 is not a whole number, so it cannot be an integer/u],
    ['true', 'integer', /^true is not a whole number/u],
    ['1e999', 'integer', /^1e999 is not a whole number/u],
    [
      '1e30',
      'integer',
      /^1e30 is a whole number, but an integer header must be from -9007199254740991 to 9007199254740991\. Use a string/u,
    ],
    ['"pdf"', 'float', /^"pdf" is not a number, so it cannot be a float/u],
    ['true', 'float', /^true is not a number/u],
    ['1', 'boolean', /^1 is not true or false, so it cannot be a boolean/u],
    ['"yes"', 'boolean', /^"yes" is not true or false/u],
    ['"True"', 'boolean', /^"True" is not true or false/u],
    ['"abc', 'string', /^A quoted text is not closed/u],
  ];

  it.each(CHANGES)('writes %j as a %s: %j', (from, to, becomes) => {
    const changed = retypeValue(from, to);

    if (typeof becomes === 'string') {
      expect(changed).toStrictEqual({ ok: true, value: becomes });
    } else {
      expect(changed.ok).toBe(false);
      expect(changed.ok ? '' : changed.error.message).toMatch(becomes);
      expect(changed.ok ? '' : changed.error.kind).toBe(from.startsWith('"abc') ? 'syntax' : 'invalid-value');
    }
  });

  it('rounds nothing: digits become digits, and a number beyond the safe range is then refused by the field, with its reason', () => {
    const changed = retypeValue('"9007199254740993"', 'integer');

    expect(changed).toStrictEqual({ ok: true, value: '9007199254740993' });
    expect(inferValue(changed.ok ? changed.value : '').ok).toBe(false);
  });

  it('has a sentence for an empty field that says what to write, and what was chosen if something was', () => {
    expect([undefined, ...VALUE_TYPES].map((type) => needsValueOf(type).message)).toEqual([
      'A header needs a value: write one, such as pdf, 7, 1.5 or true, or "" for an empty text.',
      'A header needs a value: a string, such as pdf, or "" for an empty text.',
      'A header needs a value: an integer, such as 7.',
      'A header needs a value: a float, such as 1.5.',
      'A header needs a value: true or false.',
    ]);
    expect(needsValueOf().kind).toBe('header');
  });
});

describe('properties of the type of a value', () => {
  const arbSafe = fc.oneof(
    fc.string({ unit: 'binary', maxLength: 30 }).map((v): HeaderValue => str(v)),
    fc.string({ maxLength: 12 }).map((v): HeaderValue => str(v)),
    fc.constantFrom('1', '1.0', 'true', ' 7 ', '"', 'a b', '->', 'x;y', '', 'a=b', '\n', 'é').map((v) => str(v)),
    fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }).map((v): HeaderValue => int(v + 0)),
    fc.double({ noNaN: true, noDefaultInfinity: true }).map((v): HeaderValue => float(v)),
    fc.boolean().map((v): HeaderValue => bool(v)),
  );

  it('writes a value so that the field reads it back, for every type', () => {
    fc.assert(
      fc.property(arbSafe, (value) => {
        expect(inferValue(formatValue(value))).toStrictEqual({ ok: true, value });
      }),
    );
  });

  it('writes a text in its one plain form, which reads back the same, whatever was typed', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (text) => {
        const read = inferValue(text);
        if (read.ok) {
          expect(inferValue(formatValue(read.value))).toStrictEqual(read);
        }
      }),
    );
  });

  it('never throws for any text, and says its refusal as an issue', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 60 }), fc.constantFrom(...VALUE_TYPES), (text, type) => {
        const read = inferValue(text, 'k');
        const changed = retypeValue(text, type);

        expect(read.ok || typeof read.error.message === 'string').toBe(true);
        expect(changed.ok || typeof changed.error.message === 'string').toBe(true);
      }),
    );
  });

  it('keeps a text that is already that type as it was typed', () => {
    fc.assert(
      fc.property(arbSafe, (value) => {
        const text = formatValue(value);

        expect(retypeValue(text, value.t)).toStrictEqual({ ok: true, value: text });
      }),
    );
  });

  it('says the type that it was asked to, whenever it changes a type', () => {
    fc.assert(
      fc.property(arbSafe, fc.constantFrom(...VALUE_TYPES), (value, type) => {
        const changed = retypeValue(formatValue(value), type);
        if (changed.ok) {
          expect(readType(changed.value)).toBe(type);
        }
      }),
    );
  });

  it('gives a number or a boolean back after a trip through a string', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc
            .integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER })
            .map((v): HeaderValue => int(v + 0)),
          fc.double({ noNaN: true, noDefaultInfinity: true }).map((v): HeaderValue => float(v)),
          fc.boolean().map((v): HeaderValue => bool(v)),
        ),
        (value) => {
          const asString = retypeValue(formatValue(value), 'string');
          const back = asString.ok ? retypeValue(asString.value, value.t) : asString;

          expect(back.ok && inferValue(back.value)).toStrictEqual({ ok: true, value });
        },
      ),
    );
  });
});

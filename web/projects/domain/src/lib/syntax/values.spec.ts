import { headerValueIssue } from '@rmq/engine';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { tokenize } from './tokenizer';
import { formatCondition, formatFloat, formatValue, looksLikeNumber, parseValue } from './values';

/** The value that some text says, as a word on the right of an `=`. */
function read(text: string) {
  const result = tokenize(text);
  const [token] = result.ok ? result.tokens : [];
  if (token?.kind !== 'word') {
    throw new Error(`"${text}" is not one word`);
  }
  return parseValue(token.segments);
}

describe('parseValue (ADR-0009)', () => {
  describe('types a value by how it is written', () => {
    it('reads "1" as a string, 1 as an integer, 1.0 as a float, and true as a boolean', () => {
      expect(read('"1"')).toEqual({ t: 'string', v: '1' });
      expect(read('1')).toEqual({ t: 'integer', v: 1 });
      expect(read('1.0')).toEqual({ t: 'float', v: 1 });
      expect(read('true')).toEqual({ t: 'boolean', v: true });
    });

    it('reads false as a boolean, and "true" as a string', () => {
      expect(read('false')).toEqual({ t: 'boolean', v: false });
      expect(read('"true"')).toEqual({ t: 'string', v: 'true' });
      expect(read('"false"')).toEqual({ t: 'string', v: 'false' });
    });

    it('reads any other bare word as a string', () => {
      expect(read('pdf')).toEqual({ t: 'string', v: 'pdf' });
      expect(read('a.b')).toEqual({ t: 'string', v: 'a.b' });
      expect(read('True')).toEqual({ t: 'string', v: 'True' });
      expect(read('1x')).toEqual({ t: 'string', v: '1x' });
      expect(read('--1')).toEqual({ t: 'string', v: '--1' });
      expect(read('+1')).toEqual({ t: 'string', v: '+1' });
      expect(read('.5')).toEqual({ t: 'string', v: '.5' });
      expect(read('5.')).toEqual({ t: 'string', v: '5.' });
      expect(read('NaN')).toEqual({ t: 'string', v: 'NaN' });
      expect(read('Infinity')).toEqual({ t: 'string', v: 'Infinity' });
      expect(read('1,5')).toEqual({ t: 'string', v: '1,5' });
    });

    it('reads anything in quotes as a string, whatever it looks like, and a word with a quoted part as a string', () => {
      expect(read('""')).toEqual({ t: 'string', v: '' });
      expect(read('"1.0"')).toEqual({ t: 'string', v: '1.0' });
      expect(read('1"0"')).toEqual({ t: 'string', v: '10' });
      expect(read('"a b"')).toEqual({ t: 'string', v: 'a b' });
    });
  });

  describe('integers', () => {
    it('are whole numbers with an optional minus, as long as they are, and keep their value', () => {
      expect(read('0')).toEqual({ t: 'integer', v: 0 });
      expect(read('-7')).toEqual({ t: 'integer', v: -7 });
      expect(read('007')).toEqual({ t: 'integer', v: 7 });
      expect(read('9007199254740991')).toEqual({ t: 'integer', v: Number.MAX_SAFE_INTEGER });
      expect(read('-9007199254740991')).toEqual({ t: 'integer', v: Number.MIN_SAFE_INTEGER });
    });

    it('have no sign of zero: -0 is the integer 0', () => {
      expect(Object.is((read('-0') as { v: number }).v, 0)).toBe(true);
      expect(Object.is((read('0') as { v: number }).v, 0)).toBe(true);
    });

    it('beyond the safe range are read as a number that the engine refuses, because the value is rounded', () => {
      const unsafe = read('9007199254740993');

      expect(unsafe).toMatchObject({ t: 'integer' });
      expect(headerValueIssue(unsafe)).not.toBeNull();
      expect(headerValueIssue(read('99999999999999999999'))).not.toBeNull();
    });
  });

  describe('floats', () => {
    it('have a fraction or an exponent', () => {
      expect(read('1.5')).toEqual({ t: 'float', v: 1.5 });
      expect(read('-0.25')).toEqual({ t: 'float', v: -0.25 });
      expect(read('1e3')).toEqual({ t: 'float', v: 1000 });
      expect(read('1.5E-3')).toEqual({ t: 'float', v: 0.0015 });
      expect(read('2e+2')).toEqual({ t: 'float', v: 200 });
    });

    it('keep the sign of a zero, which is a float’s own', () => {
      expect(Object.is((read('-0.0') as { v: number }).v, -0)).toBe(true);
      expect(Object.is((read('0.0') as { v: number }).v, 0)).toBe(true);
    });

    it('that are too large for a double are read as a number that the engine refuses, because it is not finite', () => {
      const huge = read('1e999');

      expect(huge).toMatchObject({ t: 'float', v: Number.POSITIVE_INFINITY });
      expect(headerValueIssue(huge)).toBe('A float header must be a finite number');
    });
  });

  it('reads a value from the pieces of a word, however they are quoted', () => {
    expect(parseValue([{ text: '12', quoted: false }])).toEqual({ t: 'integer', v: 12 });
    expect(parseValue([{ text: '12', quoted: true }])).toEqual({ t: 'string', v: '12' });
    expect(parseValue([])).toEqual({ t: 'string', v: '' });
  });
});

describe('looksLikeNumber', () => {
  it.each<[string, boolean]>([
    ['1', true],
    ['-1', true],
    ['1.5', true],
    ['1e3', true],
    ['1.5e-3', true],
    ['007', true],
    ['', false],
    ['-', false],
    ['1.', false],
    ['.5', false],
    ['1e', false],
    ['abc', false],
    ['1 ', false],
    ['0x10', false],
  ])('says that %j is %s', (text, yes) => {
    expect(looksLikeNumber(text)).toBe(yes);
  });
});

describe('formatFloat', () => {
  it.each<[number, string]>([
    [1, '1.0'],
    [0, '0.0'],
    [-3, '-3.0'],
    [1.5, '1.5'],
    [0.1, '0.1'],
    [1e21, '1e+21'],
    [1.5e-7, '1.5e-7'],
    [123456789012345680000, '123456789012345680000.0'],
    [Number.MAX_VALUE, '1.7976931348623157e+308'],
    [Number.MIN_VALUE, '5e-324'],
  ])('writes %d as %s', (value, text) => {
    expect(formatFloat(value)).toBe(text);
  });

  it('keeps the sign of a zero', () => {
    expect(formatFloat(-0)).toBe('-0.0');
  });
});

describe('formatValue', () => {
  it('writes each type so that it reads back as the same type', () => {
    expect(formatValue({ t: 'string', v: 'pdf' })).toBe('pdf');
    expect(formatValue({ t: 'integer', v: 7 })).toBe('7');
    expect(formatValue({ t: 'integer', v: -7 })).toBe('-7');
    expect(formatValue({ t: 'float', v: 1 })).toBe('1.0');
    expect(formatValue({ t: 'boolean', v: true })).toBe('true');
    expect(formatValue({ t: 'boolean', v: false })).toBe('false');
  });

  it('quotes a string that would read as another type: "1", "1.0", "true", "false"', () => {
    expect(formatValue({ t: 'string', v: '1' })).toBe('"1"');
    expect(formatValue({ t: 'string', v: '-1.5' })).toBe('"-1.5"');
    expect(formatValue({ t: 'string', v: '1e3' })).toBe('"1e3"');
    expect(formatValue({ t: 'string', v: 'true' })).toBe('"true"');
    expect(formatValue({ t: 'string', v: 'false' })).toBe('"false"');
  });

  it('quotes a string that is empty or has a character that is read as structure', () => {
    expect(formatValue({ t: 'string', v: '' })).toBe('""');
    expect(formatValue({ t: 'string', v: 'a b' })).toBe('"a b"');
    expect(formatValue({ t: 'string', v: 'a=b' })).toBe('"a=b"');
    expect(formatValue({ t: 'string', v: 'exists(x)' })).toBe('"exists(x)"');
    expect(formatValue({ t: 'string', v: 'a;b' })).toBe('"a;b"');
  });

  it('leaves a string bare that only looks a little like a number or a boolean', () => {
    expect(formatValue({ t: 'string', v: '1x' })).toBe('1x');
    expect(formatValue({ t: 'string', v: 'True' })).toBe('True');
    expect(formatValue({ t: 'string', v: 'NaN' })).toBe('NaN');
  });

  it('writes a value that reads back as the value, for a value of any type', () => {
    const arbValue = fc.oneof(
      fc.string({ unit: 'binary', maxLength: 20 }).map((v) => ({ t: 'string' as const, v })),
      fc
        .integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER })
        .map((v) => ({ t: 'integer' as const, v: v + 0 })),
      fc.double({ noNaN: true, noDefaultInfinity: true }).map((v) => ({ t: 'float' as const, v })),
      fc.boolean().map((v) => ({ t: 'boolean' as const, v })),
    );

    fc.assert(
      fc.property(arbValue, (value) => {
        expect(read(formatValue(value))).toEqual(value);
      }),
    );
  });

  it('keeps 1, 1.0, "1" and true apart when it writes them', () => {
    const written = [
      { t: 'integer', v: 1 },
      { t: 'float', v: 1 },
      { t: 'string', v: '1' },
      { t: 'boolean', v: true },
    ].map((value) => formatValue(value as never));

    expect(written).toEqual(['1', '1.0', '"1"', 'true']);
  });
});

describe('formatCondition', () => {
  it('writes name=value for a value, and exists(name) for a header that only has to be there', () => {
    expect(formatCondition('format', { t: 'string', v: 'pdf' }, [])).toBe('format=pdf');
    expect(formatCondition('size', { t: 'integer', v: 10 }, [])).toBe('size=10');
    expect(formatCondition('format', { t: 'exists' }, [])).toBe('exists(format)');
  });

  it('quotes the name when it has to be, and when it is one of the options, which is how a header is told from an option', () => {
    expect(formatCondition('my key', { t: 'boolean', v: true }, [])).toBe('"my key"=true');
    expect(formatCondition('key', { t: 'integer', v: 1 }, ['key', 'x-match'])).toBe('"key"=1');
    expect(formatCondition('x-match', { t: 'string', v: 'a' }, ['key', 'x-match'])).toBe('"x-match"=a');
    expect(formatCondition('keys', { t: 'integer', v: 1 }, ['key', 'x-match'])).toBe('keys=1');
  });

  it('does not quote the name inside exists( ) when it is an option name, which is not ambiguous there', () => {
    expect(formatCondition('key', { t: 'exists' }, ['key'])).toBe('exists(key)');
    expect(formatCondition('a b', { t: 'exists' }, [])).toBe('exists("a b")');
  });
});

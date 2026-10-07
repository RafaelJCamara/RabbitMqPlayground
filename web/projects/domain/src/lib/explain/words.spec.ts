import { describe, expect, it } from 'vitest';
import {
  exchangeText,
  keyText,
  listOf,
  plural,
  quoted,
  SHORT_MOST,
  shorten,
  typeText,
  valueText,
  wordText,
} from './words';

describe('the pieces of an explanation (ADR-0060)', () => {
  it('quotes a text exactly, as JSON does, so that what was compared is what is read', () => {
    expect(quoted('order.created')).toBe('"order.created"');
    expect(quoted('a "b"')).toBe('"a \\"b\\""');
    expect(quoted('')).toBe('""');
  });

  it('says the empty key and the empty word in words, because two quotes are easy to miss', () => {
    expect(keyText('')).toBe('the empty key');
    expect(keyText('a.b')).toBe('"a.b"');
    expect(wordText('')).toBe('an empty word');
    expect(wordText('a')).toBe('"a"');
  });

  it.each<[string[], string]>([
    [[], ''],
    [['a'], 'a'],
    [['a', 'b'], 'a and b'],
    [['a', 'b', 'c'], 'a, b and c'],
  ])('lists %j as %j', (items, text) => {
    expect(listOf(items)).toBe(text);
  });

  it('counts, with the plural that the number asks for', () => {
    expect(plural(0, 'binding')).toBe('0 bindings');
    expect(plural(1, 'binding')).toBe('1 binding');
    expect(plural(2, 'binding')).toBe('2 bindings');
    expect(plural(1, 'copy', 'copies')).toBe('1 copy');
    expect(plural(3, 'copy', 'copies')).toBe('3 copies');
  });

  it('names the exchange with no name for what it is', () => {
    expect(exchangeText('')).toBe('the default exchange');
    expect(exchangeText('orders')).toBe('orders');
  });

  it('cuts a text at the number of characters that it is given and writes an ellipsis, and leaves a short text alone', () => {
    expect(SHORT_MOST).toBe(48);
    expect(shorten('abcdef', 6)).toBe('abcdef');
    expect(shorten('abcdefg', 6)).toBe('abcde…');
    expect(shorten('x'.repeat(48))).toBe('x'.repeat(48));
    expect(shorten('x'.repeat(49))).toBe(`${'x'.repeat(47)}…`);
  });

  it('counts a character outside the basic plane as one, and never cuts it in half', () => {
    const smile = String.fromCodePoint(0x1f600);

    expect(shorten(smile.repeat(4), 4)).toBe(smile.repeat(4));
    expect(shorten(smile.repeat(5), 4)).toBe(`${smile.repeat(3)}…`);
  });

  it('writes a header value so that a string, an integer, a float and a boolean are told apart', () => {
    expect(valueText({ t: 'string', v: '1' })).toBe('"1"');
    expect(valueText({ t: 'integer', v: 1 })).toBe('1');
    expect(valueText({ t: 'float', v: 1 })).toBe('1.0');
    expect(valueText({ t: 'float', v: 1.5 })).toBe('1.5');
    expect(valueText({ t: 'boolean', v: true })).toBe('true');
    expect(valueText({ t: 'boolean', v: false })).toBe('false');
  });

  it('names a type with its article', () => {
    expect(typeText('string')).toBe('a string');
    expect(typeText('integer')).toBe('an integer');
    expect(typeText('float')).toBe('a float');
    expect(typeText('boolean')).toBe('a boolean');
  });
});

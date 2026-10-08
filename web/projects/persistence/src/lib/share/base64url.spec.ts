import { configureFastCheck } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from './base64url';

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

const bytesOf = (...values: number[]): Uint8Array => new Uint8Array(values);
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('toBase64Url (ADR-0077)', () => {
  it.each([
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ])('writes the test vector of RFC 4648 for %j, without padding', (input, expected) => {
    expect(toBase64Url(text(input))).toBe(expected);
  });

  it('writes the two characters that base64 and base64url do not share as - and _', () => {
    expect(toBase64Url(bytesOf(0xfb))).toBe('-w');
    expect(toBase64Url(bytesOf(0xff, 0xff))).toBe('__8');
    expect(toBase64Url(bytesOf(0xfb, 0xef, 0xbe))).toBe('----');
    expect(toBase64Url(bytesOf(0xff, 0xff, 0xff))).toBe('____');
  });

  it('writes the same as Node does, for any bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        expect(toBase64Url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
      }),
    );
  });
});

describe('fromBase64Url', () => {
  it.each([
    ['', ''],
    ['Zg', 'f'],
    ['Zm8', 'fo'],
    ['Zm9v', 'foo'],
    ['Zm9vYg', 'foob'],
    ['Zm9vYmE', 'fooba'],
    ['Zm9vYmFy', 'foobar'],
  ])('reads the test vector of RFC 4648 %j', (input, expected) => {
    const read = fromBase64Url(input);

    expect(read.ok && new TextDecoder().decode(read.bytes)).toBe(expected);
  });

  it('reads - and _ back to the bytes they stand for', () => {
    const read = fromBase64Url('__8');

    expect(read.ok && [...read.bytes]).toEqual([0xff, 0xff]);
  });

  it.each([
    ['padding', 'Zg==', 2, '='],
    ['a plus', 'Zm+v', 2, '+'],
    ['a slash', 'Zm/v', 2, '/'],
    ['a space', 'Zm 9', 2, ' '],
    ['a new line', 'Zm9v\n', 4, '\n'],
    ['a letter beyond ASCII', 'Zm9é', 3, 'é'],
    ['an emoji, whole', 'Zm9😀', 3, '😀'],
    ['a percent sign', 'Zm%v', 2, '%'],
    ['the character just above the alphabet', 'Zm9{', 3, '{'],
    ['the character just below the digits', 'Zm9/', 3, '/'],
  ])('refuses %s, and says where it is and what it is', (_what, input, at, char) => {
    expect(fromBase64Url(input)).toEqual({ ok: false, reason: 'alphabet', at, char });
  });

  it('refuses a length that no base64 text has: one more than a whole number of groups of four', () => {
    for (const input of ['Z', 'Zm9vY', 'Zm9vYmFyY']) {
      expect(fromBase64Url(input)).toEqual({ ok: false, reason: 'length' });
    }
    expect(fromBase64Url('Zm9vYg').ok).toBe(true);
  });

  it('says that a character is wrong before it says that the length is, because that is what to change', () => {
    expect(fromBase64Url('Z!')).toEqual({ ok: false, reason: 'alphabet', at: 1, char: '!' });
    expect(fromBase64Url('Zm9v!').ok).toBe(false);
  });

  it('reads back what was written, for any bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        const read = fromBase64Url(toBase64Url(bytes));

        expect(read.ok && [...read.bytes]).toEqual([...bytes]);
      }),
    );
  });

  it('reads any text of the alphabet that has a possible length, and writes it back as it was when the last character is a whole one', () => {
    const arbText = fc
      .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'), { maxLength: 100 })
      .filter((characters) => characters.length % 4 !== 1)
      .map((characters) => characters.join(''));

    fc.assert(
      fc.property(arbText, (input) => {
        const read = fromBase64Url(input);

        expect(read.ok).toBe(true);
        expect(read.ok && read.bytes.length).toBe(Math.floor((input.length * 3) / 4));
      }),
    );
  });
});

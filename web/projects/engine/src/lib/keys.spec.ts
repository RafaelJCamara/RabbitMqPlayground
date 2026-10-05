import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ROUTING_KEY_MAX_BYTES, routingKeyIssue, utf8Length } from './keys';

describe('utf8Length', () => {
  it.each<[string, string, number]>([
    ['nothing', '', 0],
    ['ASCII', 'orders.created', 14],
    ['a two-byte character', 'é', 2],
    ['a three-byte character', '€', 3],
    ['a four-byte character, which is a surrogate pair in a JavaScript string', '\u{1F600}', 4],
    ['the longest one-byte character', '\u007f', 1],
    ['the shortest two-byte character', '\u0080', 2],
    ['the longest two-byte character', '߿', 2],
    ['the shortest three-byte character', 'ࠀ', 3],
    ['the last character before the surrogates', '퟿', 3],
    ['a decomposed e acute, which is two characters', 'é', 3],
  ])('counts %s', (_name, text, bytes) => {
    expect(utf8Length(text)).toBe(bytes);
  });

  it('counts a surrogate that has no partner as the three-byte replacement character, as an encoder writes it', () => {
    expect(utf8Length('\ud800')).toBe(3);
    expect(utf8Length('\udc00')).toBe(3);
    expect(utf8Length('\ud800a')).toBe(4);
    expect(utf8Length('a\ud800')).toBe(4);
    expect(utf8Length('\udc00\ud800')).toBe(6);
    expect(utf8Length('\udc00\udc00')).toBe(6);
    expect(utf8Length('\udbff\udbff')).toBe(6);
    expect(utf8Length('\ud800𐀀')).toBe(7);
  });

  it('agrees with Node on any text, including text with unpaired surrogates', () => {
    const anyCode = fc.integer({ min: 0, max: 0xffff }).map((code) => String.fromCharCode(code));
    fc.assert(
      fc.property(fc.array(anyCode, { maxLength: 40 }), (characters) => {
        const text = characters.join('');
        expect(utf8Length(text)).toBe(Buffer.byteLength(text, 'utf8'));
      }),
    );
  });

  it('agrees with Node on text made of whole characters', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 60 }), (text) => {
        expect(utf8Length(text)).toBe(Buffer.byteLength(text, 'utf8'));
      }),
    );
  });
});

describe('routingKeyIssue', () => {
  it('is 255 bytes, which is what AMQP can write in a short string', () => {
    expect(ROUTING_KEY_MAX_BYTES).toBe(255);
  });

  it('accepts a key of up to 255 bytes, and the empty key', () => {
    expect(routingKeyIssue('')).toBeNull();
    expect(routingKeyIssue('a'.repeat(255))).toBeNull();
    // 127 two-byte characters and an a: 255 bytes in 128 characters.
    expect(routingKeyIssue(`${'é'.repeat(127)}a`)).toBeNull();
  });

  it('counts bytes and not characters', () => {
    expect(routingKeyIssue('é'.repeat(128))).toBe('A routing key is at most 255 bytes of UTF-8, and this one is 256');
    expect(routingKeyIssue('a'.repeat(256))).toBe('A routing key is at most 255 bytes of UTF-8, and this one is 256');
    expect(routingKeyIssue('\u{1F600}'.repeat(64))).toBe(
      'A routing key is at most 255 bytes of UTF-8, and this one is 256',
    );
  });

  it('says how long the key is', () => {
    expect(routingKeyIssue('x'.repeat(1000))).toBe('A routing key is at most 255 bytes of UTF-8, and this one is 1000');
  });
});

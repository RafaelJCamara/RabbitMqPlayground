import { describe, expect, it } from 'vitest';
import { colorOf, MESSAGE_COLORS, MIXED, PAINT_TOKENS, tokenFor } from './colors';

describe('the colour of a message (ADR-0055)', () => {
  it('is one of the eight that the stylesheet has a token for, which tools/theme/tokens.spec.ts holds to the contrast that a person needs', () => {
    expect(MESSAGE_COLORS).toEqual(['blue', 'orange', 'green', 'pink', 'gold', 'gray', 'violet', 'cyan']);
    expect(MIXED).toBe('mixed');
  });

  it('is one of the eight, and the same for the same key every time', () => {
    for (const key of ['', 'a', 'order.created', 'order.*', 'ключ', 'x'.repeat(300)]) {
      expect(MESSAGE_COLORS).toContain(colorOf(key));
      expect(colorOf(key)).toBe(colorOf(key));
    }
  });

  it('is what the hash of the key says, so that it is the same in every browser and in every run', () => {
    // The 32-bit FNV-1a hashes of these, which are the published test vectors of the function, taken modulo eight.
    expect(colorOf('')).toBe(MESSAGE_COLORS[0x811c9dc5 % 8]);
    expect(colorOf('a')).toBe(MESSAGE_COLORS[0xe40c292c % 8]);
    expect(colorOf('foobar')).toBe(MESSAGE_COLORS[0xbf9cf968 % 8]);
    expect([colorOf(''), colorOf('a'), colorOf('foobar')]).toEqual(['gray', 'gold', 'blue']);
  });

  it('uses all eight, over keys that a learner would use, so that colour tells kinds of message apart', () => {
    const used = new Set(Array.from({ length: 200 }, (_, index) => colorOf(`key.${index}`)));

    expect(used.size).toBe(MESSAGE_COLORS.length);
  });

  it('has a colour of its own for a crowd that shares no key, which is no key’s', () => {
    expect(tokenFor(null)).toBe(`--rmq-message-${MIXED}`);
    expect(MESSAGE_COLORS as readonly string[]).not.toContain(MIXED);
  });

  it('names the token of the colour of a key, in the stylesheet', () => {
    expect(tokenFor('a')).toBe('--rmq-message-gold');
    for (const key of ['a', 'b', 'c', 'd']) {
      expect(PAINT_TOKENS).toContain(tokenFor(key));
    }
  });

  it('lists every token that the painter reads, once', () => {
    expect(new Set(PAINT_TOKENS).size).toBe(PAINT_TOKENS.length);
    expect(PAINT_TOKENS).toEqual(
      expect.arrayContaining([
        ...MESSAGE_COLORS.map((name) => `--rmq-message-${name}`),
        '--rmq-message-mixed',
        '--rmq-message-outline',
        '--rmq-warning',
        '--rmq-fg',
        '--rmq-canvas',
      ]),
    );
  });
});

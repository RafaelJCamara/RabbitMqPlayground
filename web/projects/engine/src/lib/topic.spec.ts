import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { alignTopic, splitTopic, topicMatches, topicSamples } from './topic';

describe('splitTopic', () => {
  it.each<[string, string[]]>([
    ['', []],
    ['a', ['a']],
    ['a.b', ['a', 'b']],
    ['a.b.c', ['a', 'b', 'c']],
    ['.', ['', '']],
    ['a.', ['a', '']],
    ['.a', ['', 'a']],
    ['a..b', ['a', '', 'b']],
    ['..', ['', '', '']],
    ['*.#', ['*', '#']],
  ])('splits %j into %j: the empty string has no words, and any dot makes empty ones', (text, words) => {
    expect(splitTopic(text)).toEqual(words);
  });
});

describe('topicMatches (ADR-0008, rule 4)', () => {
  // [pattern, key, matches]
  it.each<[string, string, boolean]>([
    // The empty key has no words: # matches it and * does not.
    ['#', '', true],
    ['*', '', false],
    ['', '', true],
    ['#.#', '', true],
    ['*.#', '', false],
    ['*.*', '', false],
    ['a', '', false],
    ['a.#', '', false],
    // The empty pattern has no words, so it matches only the empty key.
    ['', 'a', false],
    ['', '.', false],
    // A dot makes empty words, and * may match one.
    ['*', '.', false],
    ['*.*', '.', true],
    ['.', '.', true],
    ['.', '', false],
    ['*.a', '.a', true],
    ['a.*', 'a.', true],
    ['a.*.b', 'a..b', true],
    ['a.*.b', 'a.b', false],
    // * is exactly one word.
    ['*', 'a', true],
    ['*', 'a.b', false],
    ['a.*', 'a.b', true],
    ['a.*', 'a', false],
    ['a.*', 'a.b.c', false],
    ['*.*.*', 'a.b.c', true],
    // # is zero or more words, wherever it is.
    ['#', 'a', true],
    ['#', 'a.b.c', true],
    ['a.#', 'a', true],
    ['a.#', 'a.b.c', true],
    ['a.#', 'b.a', false],
    ['#.b', 'b', true],
    ['#.b', 'a.b', true],
    ['#.b', 'a.b.c', false],
    ['a.#.b', 'a.b', true],
    ['a.#.b', 'a.x.b', true],
    ['a.#.b', 'a.x.y.b', true],
    ['a.#.b', 'a.x.y', false],
    ['#.a.#', 'a', true],
    ['#.a.#', 'x.a.y', true],
    ['#.a.#', 'x.y', false],
    ['#.#', 'a.b', true],
    // A wildcard is one only as a whole word.
    ['a*', 'a*', true],
    ['a*', 'ab', false],
    ['a*', 'a', false],
    ['*a', 'a', false],
    ['**', '**', true],
    ['**', 'a', false],
    ['a#', 'a#', true],
    ['a#', 'a', false],
    ['##', '##', true],
    ['##', 'a.b', false],
    ['a.b*', 'a.bc', false],
    // Words are compared byte for byte.
    ['a.b', 'a.b', true],
    ['a.b', 'A.b', false],
    ['a.b', 'a.B', false],
    ['a. b', 'a.b', false],
    ['a.b', 'a.b ', false],
    ['é', 'é', true],
    ['é', 'é', false],
    ['*.é', 'x.é', true],
    // A key that has a wildcard in it is an ordinary key to the exchange.
    ['a', '*', false],
    ['*', '*', true],
    ['*', '#', true],
    ['#', '*.#', true],
  ])('pattern %j and key %j: %s', (pattern, key, expected) => {
    expect(topicMatches(pattern, key)).toBe(expected);
  });

  it('matches a key of 128 words, which is 255 bytes, by exactly 128 stars and not by 127 or 129', () => {
    const key = Array.from({ length: 128 }, () => 'a').join('.');
    const stars = (count: number) => Array.from({ length: count }, () => '*').join('.');

    expect(topicMatches(stars(128), key)).toBe(true);
    expect(topicMatches(stars(127), key)).toBe(false);
    expect(topicMatches(stars(129), key)).toBe(false);
    expect(topicMatches(`${stars(127)}.#`, key)).toBe(true);
    expect(topicMatches('#', key)).toBe(true);
    expect(topicMatches('a.#.a', key)).toBe(true);
  });
});

describe('alignTopic: which key words each pattern word matched', () => {
  const seg = (pattern: string, ...words: string[]) => ({ pattern, words });

  it.each<[string, string, ReturnType<typeof seg>[]]>([
    ['a.b', 'a.b', [seg('a', 'a'), seg('b', 'b')]],
    ['a.*.b', 'a.x.b', [seg('a', 'a'), seg('*', 'x'), seg('b', 'b')]],
    ['a.*.b', 'a..b', [seg('a', 'a'), seg('*', ''), seg('b', 'b')]],
    ['a.#.b', 'a.x.y.b', [seg('a', 'a'), seg('#', 'x', 'y'), seg('b', 'b')]],
    ['a.#.b', 'a.b', [seg('a', 'a'), seg('#'), seg('b', 'b')]],
    ['#', '', [seg('#')]],
    ['#', 'a.b', [seg('#', 'a', 'b')]],
    ['', '', []],
    ['*.*', 'a.', [seg('*', 'a'), seg('*', '')]],
    ['a*', 'a*', [seg('a*', 'a*')]],
    // The first # takes as few words as it can, so that the next one takes the rest.
    ['#.#', 'a.b', [seg('#'), seg('#', 'a', 'b')]],
    ['#.a.#', 'x.a.a.y', [seg('#', 'x'), seg('a', 'a'), seg('#', 'a', 'y')]],
    ['#.*', 'a.b.c', [seg('#', 'a', 'b'), seg('*', 'c')]],
  ])('aligns pattern %j with key %j', (pattern, key, segments) => {
    expect(alignTopic(pattern, key)).toEqual({ matched: true, segments });
  });

  it.each<[string, string, ReturnType<typeof seg>[], unknown]>([
    ['a.b', 'a.c', [seg('a', 'a')], { kind: 'word-differs', patternIndex: 1, keyIndex: 1 }],
    ['a.b', 'b.b', [], { kind: 'word-differs', patternIndex: 0, keyIndex: 0 }],
    ['a.*', 'b', [], { kind: 'word-differs', patternIndex: 0, keyIndex: 0 }],
    ['a.b', 'a', [seg('a', 'a')], { kind: 'key-ran-out', patternIndex: 1 }],
    ['*', '', [], { kind: 'key-ran-out', patternIndex: 0 }],
    ['a.*.b', 'a.b', [seg('a', 'a'), seg('*', 'b')], { kind: 'key-ran-out', patternIndex: 2 }],
    ['a', 'a.b', [seg('a', 'a')], { kind: 'key-has-extra-words', keyIndex: 1 }],
    ['', 'a', [], { kind: 'key-has-extra-words', keyIndex: 0 }],
    ['a.*', 'a.b.c', [seg('a', 'a'), seg('*', 'b')], { kind: 'key-has-extra-words', keyIndex: 2 }],
    // # takes the rest of the key, and then there is nothing left for the word after it.
    ['a.#.c', 'a.b.d', [seg('a', 'a'), seg('#', 'b', 'd')], { kind: 'key-ran-out', patternIndex: 2 }],
    ['#.x', 'a.b', [seg('#', 'a', 'b')], { kind: 'key-ran-out', patternIndex: 1 }],
  ])('says where pattern %j stops on key %j', (pattern, key, segments, miss) => {
    expect(alignTopic(pattern, key)).toEqual({ matched: false, segments, miss });
  });

  it('can be written as JSON and read back as it was, which the trace needs', () => {
    for (const [pattern, key] of [
      ['a.#.b', 'a.x.y.b'],
      ['a.b', 'a.c'],
      ['', 'a'],
      ['*', ''],
    ] as const) {
      const alignment = alignTopic(pattern, key);

      expect(JSON.parse(JSON.stringify(alignment))).toEqual(alignment);
    }
  });
});

// --- properties ---------------------------------------------------------------------------------------------------

/** A naive matcher, written separately from the one under test, from the wording of rule 4. */
function reference(pattern: readonly string[], key: readonly string[]): boolean {
  const [head, ...rest] = pattern;
  if (head === undefined) {
    return key.length === 0;
  }
  if (head === '#') {
    return key.some((_, skipped) => reference(rest, key.slice(skipped))) || reference(rest, []);
  }
  const [first, ...others] = key;
  return first !== undefined && (head === '*' || head === first) && reference(rest, others);
}

const arbWord = fc.constantFrom('a', 'b', '', '*', '#', 'a*', 'ab');
const arbPattern = fc.array(arbWord, { maxLength: 5 }).map((words) => words.join('.'));
const arbKeyWord = fc.constantFrom('a', 'b', '', 'ab', '*');
const arbKey = fc.array(arbKeyWord, { maxLength: 6 }).map((words) => words.join('.'));
const words = (text: string) => (text === '' ? [] : text.split('.'));

describe('topicMatches, as a property', () => {
  it('agrees with a naive matcher on any pattern and key', () => {
    fc.assert(
      fc.property(arbPattern, arbKey, (pattern, key) => {
        expect(topicMatches(pattern, key)).toBe(reference(words(pattern), words(key)));
      }),
    );
  });

  it('matches every key with #, and only the empty key with the empty pattern', () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        expect(topicMatches('#', key)).toBe(true);
        expect(topicMatches('', key)).toBe(key === '');
      }),
    );
  });

  it('matches a key with itself when it has no wildcard words, and with a # added at either end', () => {
    const arbLiteralKey = fc.array(fc.constantFrom('a', 'b', '', 'ab'), { maxLength: 5 }).map((list) => list.join('.'));

    fc.assert(
      fc.property(arbLiteralKey, (key) => {
        expect(topicMatches(key, key)).toBe(true);
        expect(topicMatches(key === '' ? '#' : `${key}.#`, key)).toBe(true);
        expect(topicMatches(key === '' ? '#' : `#.${key}`, key)).toBe(true);
      }),
    );
  });
});

describe('alignTopic, as a property', () => {
  it('says matched when topicMatches does', () => {
    fc.assert(
      fc.property(arbPattern, arbKey, (pattern, key) => {
        expect(alignTopic(pattern, key).matched).toBe(topicMatches(pattern, key));
      }),
    );
  });

  it('for a match, gives every pattern word the key words it took, which are the whole key in order', () => {
    fc.assert(
      fc.property(arbPattern, arbKey, (pattern, key) => {
        const alignment = alignTopic(pattern, key);
        fc.pre(alignment.matched);

        expect(alignment.segments.map((segment) => segment.pattern)).toEqual(words(pattern));
        expect(alignment.segments.flatMap((segment) => segment.words)).toEqual(words(key));
        for (const { pattern: word, words: taken } of alignment.segments) {
          if (word === '#') {
            continue;
          }
          expect(taken).toHaveLength(1);
          if (word !== '*') {
            expect(taken[0]).toBe(word);
          }
        }
        expect('miss' in alignment).toBe(false);
      }),
    );
  });

  it('for a miss, shows how far the pattern got: its segments are a prefix of both, and the miss says why it stopped', () => {
    fc.assert(
      fc.property(arbPattern, arbKey, (pattern, key) => {
        const alignment = alignTopic(pattern, key);
        fc.pre(!alignment.matched);
        const patternWords = words(pattern);
        const keyWords = words(key);
        const used = alignment.segments.length;
        const consumed = alignment.segments.flatMap((segment) => segment.words);

        expect(alignment.segments.map((segment) => segment.pattern)).toEqual(patternWords.slice(0, used));
        expect(consumed).toEqual(keyWords.slice(0, consumed.length));
        // The part that it did align is a match on its own.
        expect(reference(patternWords.slice(0, used), consumed)).toBe(true);

        const { miss } = alignment;
        expect(miss).toBeDefined();
        if (miss?.kind === 'word-differs') {
          expect(miss.patternIndex).toBe(used);
          expect(miss.keyIndex).toBe(consumed.length);
          expect(patternWords[miss.patternIndex]).not.toBe('*');
          expect(patternWords[miss.patternIndex]).not.toBe('#');
          expect(patternWords[miss.patternIndex]).not.toBe(keyWords[miss.keyIndex]);
        } else if (miss?.kind === 'key-ran-out') {
          expect(miss.patternIndex).toBe(used);
          expect(consumed).toHaveLength(keyWords.length);
          expect(used).toBeLessThan(patternWords.length);
        } else if (miss?.kind === 'key-has-extra-words') {
          expect(used).toBe(patternWords.length);
          expect(miss.keyIndex).toBe(consumed.length);
          expect(consumed.length).toBeLessThan(keyWords.length);
        }
      }),
    );
  });

  it('gives the same alignment every time, and one that survives JSON', () => {
    fc.assert(
      fc.property(arbPattern, arbKey, (pattern, key) => {
        const alignment = alignTopic(pattern, key);

        expect(alignTopic(pattern, key)).toEqual(alignment);
        expect(JSON.parse(JSON.stringify(alignment))).toEqual(alignment);
      }),
    );
  });
});

describe('topicSamples', () => {
  it('gives keys that match and keys that do not, for a pattern', () => {
    expect(topicSamples('orders.*.created')).toEqual({
      matching: ['orders.x.created', 'orders..created'],
      nonMatching: ['', 'orders.x.created.extra', 'extra.orders.x.created', 'ordersx.x.created', 'orders.x.createdx'],
    });
  });

  it('uses zero, one and two words for a #, and an empty word for a *', () => {
    expect(topicSamples('a.#.b').matching).toEqual(['a.b', 'a.y.b', 'a.y.z.b']);
    expect(topicSamples('#').matching).toEqual(['', 'y', 'y.z']);
    // A * that is an empty word cannot stand alone as a key, because "" is no words at all.
    expect(topicSamples('*.#').matching).toEqual(['x', 'x.y', 'x.y.z']);
    expect(topicSamples('*.b').matching).toEqual(['x.b', '.b']);
  });

  it('leaves out the samples that match when they are meant not to, such as an extra word after a #', () => {
    expect(topicSamples('a.#').nonMatching).not.toContain('a.y.extra');
    expect(topicSamples('#').nonMatching).toEqual([]);
  });

  it('handles the empty pattern, which matches only the empty key', () => {
    expect(topicSamples('')).toEqual({ matching: [''], nonMatching: ['.extra', 'extra.'] });
  });

  it('handles a pattern that is a single word, and one with no wildcard', () => {
    expect(topicSamples('orders')).toEqual({
      matching: ['orders'],
      nonMatching: ['', 'orders.extra', 'extra.orders', 'ordersx'],
    });
  });

  it('keeps every sample within 255 bytes, so that each could be sent', () => {
    const long = Array.from({ length: 128 }, () => 'a').join('.');
    const { matching, nonMatching } = topicSamples(`${long}.#`);

    for (const key of [...matching, ...nonMatching]) {
      expect(key.length).toBeLessThanOrEqual(255);
    }
    expect(matching).toContain(long);
  });

  it('leaves out a sample of 256 bytes and keeps one of 254, because the limit is 255', () => {
    const { matching } = topicSamples(`${'a'.repeat(254)}.#`);

    expect(matching).toEqual(['a'.repeat(254)]);
  });

  it('gives no sample that is too long, even for a pattern that is too long itself', () => {
    const { matching, nonMatching } = topicSamples(Array.from({ length: 200 }, () => 'abcdef').join('.'));

    expect(matching).toEqual([]);
    expect(nonMatching.every((key) => key.length <= 255)).toBe(true);
  });

  it('gives the same samples every time', () => {
    expect(topicSamples('a.#.b.*')).toEqual(topicSamples('a.#.b.*'));
  });

  it('only gives matching samples that match, and non-matching samples that do not, for any pattern', () => {
    fc.assert(
      fc.property(arbPattern, (pattern) => {
        const { matching, nonMatching } = topicSamples(pattern);

        for (const key of matching) {
          expect(topicMatches(pattern, key), `matching ${key}`).toBe(true);
        }
        for (const key of nonMatching) {
          expect(topicMatches(pattern, key), `non-matching ${key}`).toBe(false);
        }
        expect(new Set(matching).size).toBe(matching.length);
        expect(new Set(nonMatching).size).toBe(nonMatching.length);
        expect(matching.length).toBeLessThanOrEqual(4);
        expect(nonMatching.length).toBeLessThanOrEqual(5);
      }),
    );
  });

  it('always has a matching sample for a pattern that is short enough', () => {
    fc.assert(
      fc.property(arbPattern, (pattern) => {
        expect(topicSamples(pattern).matching.length).toBeGreaterThan(0);
      }),
    );
  });
});

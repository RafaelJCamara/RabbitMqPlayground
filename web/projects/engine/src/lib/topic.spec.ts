import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { alignTopic, hashWordCount, splitTopic, TOPIC_MAX_HASH_WORDS, topicMatches, topicSamples } from './topic';

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

describe('hashWordCount (ADR-0022)', () => {
  it('allows two # words in a binding key', () => {
    expect(TOPIC_MAX_HASH_WORDS).toBe(2);
  });

  it.each<[string, number]>([
    ['', 0],
    ['#', 1],
    ['a.b', 0],
    ['#.#', 2],
    ['#.#.#', 3],
    ['a.#.b.#.c', 2],
    ['a.#.b.#.c.#', 3],
    ['#.*.#.*.#', 3],
    ['*.*.*', 0],
    // Only a whole word that is exactly # counts.
    ['##.#.#', 2],
    ['a#.#', 1],
    ['#a.#', 1],
    ['# .#', 1],
    ['#..#', 2],
    ['.#.', 1],
  ])('counts the # words of %j as %i', (key, count) => {
    expect(hashWordCount(key)).toBe(count);
  });

  it('is the number of words that are exactly #, for any key', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('#', '*', 'a', '##', ''), { maxLength: 8 }), (words) => {
        expect(hashWordCount(words.join('.'))).toBe(splitTopic(words.join('.')).filter((word) => word === '#').length);
        expect(hashWordCount(words.join('.'))).toBeLessThanOrEqual(words.length);
      }),
    );
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

describe('alignTopic: which key words each pattern word matched (ADR-0059)', () => {
  const seg = (pattern: string, ...words: string[]) => ({ pattern, words, outcome: 'matched' });
  /** A word of the pattern that met another word of the key. */
  const differs = (pattern: string, word: string) => ({ pattern, words: [word], outcome: 'differs' });
  /** A word of the pattern that the key had no word left for. */
  const missing = (pattern: string) => ({ pattern, words: [], outcome: 'missing' });

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
    // The words between two # are found in the first place that they fit, which leaves the most room for what follows.
    ['a.#.b.#.c', 'a.b.b.c', [seg('a', 'a'), seg('#'), seg('b', 'b'), seg('#', 'b'), seg('c', 'c')]],
    ['#.*.b.#', 'a.x.b.y', [seg('#', 'a'), seg('*', 'x'), seg('b', 'b'), seg('#', 'y')]],
  ])('aligns pattern %j with key %j', (pattern, key, segments) => {
    expect(alignTopic(pattern, key)).toStrictEqual({ matched: true, segments });
  });

  it.each<[string, string, ReturnType<typeof seg>[], unknown]>([
    // Without a #, every word is anchored to the start, each is judged on its own, and the first that is wrong is the miss.
    ['a.b', 'a.c', [seg('a', 'a'), differs('b', 'c')], { kind: 'word-differs', patternIndex: 1, keyIndex: 1 }],
    ['a.b', 'b.c', [differs('a', 'b'), differs('b', 'c')], { kind: 'word-differs', patternIndex: 0, keyIndex: 0 }],
    ['a.b', 'b.b', [differs('a', 'b'), seg('b', 'b')], { kind: 'word-differs', patternIndex: 0, keyIndex: 0 }],
    ['a.*', 'b', [differs('a', 'b'), missing('*')], { kind: 'word-differs', patternIndex: 0, keyIndex: 0 }],
    ['a.b', 'a', [seg('a', 'a'), missing('b')], { kind: 'key-too-short', needs: 2, has: 1 }],
    ['*', '', [missing('*')], { kind: 'key-too-short', needs: 1, has: 0 }],
    ['a.*.b', 'a.b', [seg('a', 'a'), seg('*', 'b'), missing('b')], { kind: 'key-too-short', needs: 3, has: 2 }],
    ['a', 'a.b', [seg('a', 'a')], { kind: 'key-has-extra-words', keyIndex: 1 }],
    ['', 'a', [], { kind: 'key-has-extra-words', keyIndex: 0 }],
    ['a.*', 'a.b.c', [seg('a', 'a'), seg('*', 'b')], { kind: 'key-has-extra-words', keyIndex: 2 }],
    // With a #, the words before the first are anchored to the start of the key and the words after the last to its end.
    [
      'a.#.c',
      'a.b.d',
      [seg('a', 'a'), seg('#', 'b'), differs('c', 'd')],
      { kind: 'word-differs', patternIndex: 2, keyIndex: 2 },
    ],
    ['#.x', 'a.b', [seg('#', 'a'), differs('x', 'b')], { kind: 'word-differs', patternIndex: 1, keyIndex: 1 }],
    // The key goes on after the last word of the pattern, and a # at the front could take it. The key has to end in a.
    ['#.a', 'a.b', [seg('#', 'a'), differs('a', 'b')], { kind: 'word-differs', patternIndex: 1, keyIndex: 1 }],
    ['#.a*', 'ba', [seg('#'), differs('a*', 'ba')], { kind: 'word-differs', patternIndex: 1, keyIndex: 0 }],
    // The part before the first # is looked at first, and then the length of the key, and then the part after the last #.
    [
      'x.#.y',
      'a.b.c',
      [differs('x', 'a'), seg('#', 'b'), differs('y', 'c')],
      { kind: 'word-differs', patternIndex: 0, keyIndex: 0 },
    ],
    ['a.#.b', 'a', [seg('a', 'a'), seg('#'), missing('b')], { kind: 'key-too-short', needs: 2, has: 1 }],
    ['b.c.#', '', [missing('b'), missing('c'), seg('#')], { kind: 'key-too-short', needs: 2, has: 0 }],
    ['*.#.#', '', [missing('*'), seg('#'), seg('#')], { kind: 'key-too-short', needs: 1, has: 0 }],
    ['#.b.b', 'a', [seg('#'), missing('b'), differs('b', 'a')], { kind: 'key-too-short', needs: 2, has: 1 }],
    [
      'a.#.b.c',
      'a.c',
      [seg('a', 'a'), seg('#'), missing('b'), seg('c', 'c')],
      { kind: 'key-too-short', needs: 3, has: 2 },
    ],
    [
      '#.b.#.c.#.d',
      'a.d',
      [seg('#'), missing('b'), seg('#'), missing('c'), seg('#', 'a'), seg('d', 'd')],
      { kind: 'key-too-short', needs: 3, has: 2 },
    ],
    [
      'x.#.b.#.c',
      'a.b.c',
      [differs('x', 'a'), seg('#'), seg('b', 'b'), seg('#'), seg('c', 'c')],
      { kind: 'word-differs', patternIndex: 0, keyIndex: 0 },
    ],
    [
      'a.#.b.#.c',
      'a.x.y.c',
      [seg('a', 'a'), seg('#'), missing('b'), seg('#', 'x', 'y'), seg('c', 'c')],
      { kind: 'middle-not-found', patternIndex: 2 },
    ],
  ])('says what pattern %j made of key %j', (pattern, key, segments, miss) => {
    expect(alignTopic(pattern, key)).toStrictEqual({ matched: false, segments, miss });
  });

  it('can be written as JSON and read back as it was, which the trace needs', () => {
    for (const [pattern, key] of [
      ['a.#.b', 'a.x.y.b'],
      ['a.b', 'a.c'],
      ['', 'a'],
      ['*', ''],
      ['a.#.b.#.c', 'a.x.y.c'],
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

/** What an alignment owes to its pattern and its key, whatever the words are. It answers what is wrong, so that an empty list is a good alignment. */
function problemsOf(pattern: string, key: string): string[] {
  const alignment = alignTopic(pattern, key);
  const patternWords = words(pattern);
  const keyWords = words(key);
  const { segments } = alignment;
  const problems: string[] = [];
  const say = (problem: string) => problems.push(problem);

  if (alignment.matched !== topicMatches(pattern, key)) {
    say('matched is not what topicMatches says');
  }
  if (JSON.stringify(segments.map((segment) => segment.pattern)) !== JSON.stringify(patternWords)) {
    say('the segments are not the words of the pattern');
  }
  segments.forEach(({ pattern: word, words: taken, outcome }, index) => {
    const at = `segment ${index} (${word})`;
    if (word === '#') {
      if (outcome !== 'matched') say(`${at}: a # is always matched`);
    } else if (outcome === 'missing') {
      if (taken.length !== 0) say(`${at}: missing, and has words`);
    } else if (taken.length !== 1) {
      say(`${at}: a word that is not missing takes one word`);
    } else if ((word === '*' || word === taken[0]) !== (outcome === 'matched')) {
      say(`${at}: the outcome is not whether the word fits`);
    }
  });
  const taken = segments.flatMap((segment) => segment.words);
  if (taken.length > keyWords.length) {
    say('the segments took more words than the key has');
  }

  const { miss } = alignment;
  if (alignment.matched) {
    if (miss !== undefined) say('a match has a miss');
    if (segments.some(({ outcome }) => outcome !== 'matched')) say('a match has a segment that is not matched');
    if (JSON.stringify(taken) !== JSON.stringify(keyWords)) say('a match did not take the whole key, in order');
    return problems;
  }
  if (miss === undefined) {
    say('a miss has no reason');
    return problems;
  }
  const hashes = patternWords.filter((word) => word === '#').length;
  const fixed = patternWords.length - hashes;
  switch (miss.kind) {
    case 'word-differs': {
      const segment = segments[miss.patternIndex];
      if (segment?.outcome !== 'differs') say('word-differs at a segment that does not differ');
      if (segment?.words[0] !== keyWords[miss.keyIndex]) say('word-differs names another key word than the one it met');
      break;
    }
    case 'key-too-short':
      if (miss.needs !== fixed || miss.has !== keyWords.length || miss.has >= miss.needs)
        say('key-too-short counts wrong');
      if (!segments.some(({ outcome }) => outcome === 'missing')) say('key-too-short with no segment missing');
      break;
    case 'key-has-extra-words':
      if (hashes !== 0) say('a # takes any extra words');
      if (miss.keyIndex !== patternWords.length || miss.keyIndex >= keyWords.length)
        say('extra words start in the wrong place');
      if (segments.some(({ outcome }) => outcome !== 'matched')) say('extra words with a segment that is not matched');
      break;
    case 'middle-not-found':
      if (hashes < 2) say('a middle needs two #');
      if (segments[miss.patternIndex]?.outcome !== 'missing') say('middle-not-found at a segment that is not missing');
      if (segments[miss.patternIndex]?.pattern === '#') say('middle-not-found at a #');
      break;
  }
  if (hashes === 0) {
    // Nothing is looked for: every word is compared with the word of the key at its place.
    patternWords.forEach((word, index) => {
      const there = keyWords[index];
      const expected = there === undefined ? 'missing' : word === '*' || word === there ? 'matched' : 'differs';
      if (segments[index]?.outcome !== expected) say(`word ${index} of a pattern with no #: ${expected} expected`);
    });
  }
  return problems;
}

describe('alignTopic, as a property', () => {
  it('says matched when topicMatches does', () => {
    fc.assert(
      fc.property(arbPattern, arbKey, (pattern, key) => {
        expect(alignTopic(pattern, key).matched).toBe(topicMatches(pattern, key));
      }),
    );
  });

  it('gives every pattern word the key words it took, and a reason for a miss that its segments bear out', () => {
    fc.assert(
      fc.property(arbPattern, arbKey, (pattern, key) => {
        expect(problemsOf(pattern, key)).toEqual([]);
      }),
    );
  });

  it('holds for every pattern of up to four words and every key of up to four words, over a small alphabet', () => {
    const lists = (alphabet: readonly string[], most: number): string[] => {
      let level: string[][] = [[]];
      const all: string[] = [''];
      for (let length = 1; length <= most; length++) {
        level = level.flatMap((list) => alphabet.map((word) => [...list, word]));
        all.push(...level.map((list) => list.join('.')));
      }
      return all;
    };
    const patterns = lists(['a', 'b', '*', '#'], 4);
    const keys = lists(['a', 'b', ''], 4);
    let checked = 0;
    for (const pattern of patterns) {
      for (const key of keys) {
        const problems = problemsOf(pattern, key);
        if (problems.length > 0) {
          throw new Error(
            `pattern ${JSON.stringify(pattern)} against key ${JSON.stringify(key)}: ${problems.join('; ')}`,
          );
        }
        checked += 1;
      }
    }

    expect(checked).toBe(patterns.length * keys.length);
    expect(checked).toBeGreaterThan(40_000);
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

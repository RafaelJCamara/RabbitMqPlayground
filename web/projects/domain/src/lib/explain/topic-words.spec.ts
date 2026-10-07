import { alignTopic, splitTopic, TOPIC_MAX_HASH_WORDS } from '@rmq/engine';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { topicWords } from './topic-words';
import { SHORT_MOST } from './words';

const wordsOf = (pattern: string, key: string) =>
  topicWords(pattern, key, splitTopic(pattern), splitTopic(key), alignTopic(pattern, key));

describe('what a topic binding says of a key (ADR-0059, ADR-0060)', () => {
  it.each<[string, string, string]>([
    ['order.*', 'order.created', 'The pattern "order.*" matches the key "order.created": * took "created".'],
    ['a.#.b', 'a.x.y.b', 'The pattern "a.#.b" matches the key "a.x.y.b": # took "x.y".'],
    ['a.#.b', 'a.b', 'The pattern "a.#.b" matches the key "a.b": # took no words.'],
    ['a.*.b', 'a..b', 'The pattern "a.*.b" matches the key "a..b": * took an empty word.'],
    ['*.#.*', 'x.y.z.w', 'The pattern "*.#.*" matches the key "x.y.z.w": * took "x"; # took "y.z"; * took "w".'],
    ['a.b', 'a.b', 'The pattern "a.b" is the key "a.b", word for word.'],
    ['', '', 'The empty pattern is the empty key, word for word.'],
    ['#', '', 'The pattern "#" matches the empty key: # took no words.'],
  ])('says that %j matches %j: %s', (pattern, key, text) => {
    expect(wordsOf(pattern, key)).toEqual({ text, short: 'matches' });
  });

  it.each<[string, string, string, string]>([
    [
      'order.*',
      'payment.created',
      'The pattern "order.*" does not match the key "payment.created": the first word of the key is "payment", and the pattern asks for "order".',
      'first word is "payment", not "order"',
    ],
    [
      'a.b',
      'a.c',
      'The pattern "a.b" does not match the key "a.c": the last word of the key is "c", and the pattern asks for "b".',
      'last word is "c", not "b"',
    ],
    [
      'a.b.c',
      'a.x.c',
      'The pattern "a.b.c" does not match the key "a.x.c": word 2 of the key is "x", and the pattern asks for "b".',
      'word 2 is "x", not "b"',
    ],
    [
      'a',
      'b',
      'The pattern "a" does not match the key "b": the only word of the key is "b", and the pattern asks for "a".',
      'only word is "b", not "a"',
    ],
    [
      'a..b',
      'a.x.b',
      'The pattern "a..b" does not match the key "a.x.b": word 2 of the key is "x", and the pattern asks for an empty word.',
      'word 2 is "x", not an empty word',
    ],
    [
      'a.x',
      'a.',
      'The pattern "a.x" does not match the key "a.": the last word of the key is an empty word, and the pattern asks for "x".',
      'last word is an empty word, not "x"',
    ],
    // A pattern with a #: the part after it is counted from the end of the key, so "ends in" is what is said of the last word.
    [
      'a.#.c',
      'a.b.d',
      'The pattern "a.#.c" does not match the key "a.b.d": the last word of the key is "d", and the pattern asks for "c".',
      'last word is "d", not "c"',
    ],
    [
      '#.x',
      'k.y',
      'The pattern "#.x" does not match the key "k.y": the last word of the key is "y", and the pattern asks for "x".',
      'last word is "y", not "x"',
    ],
  ])('says where %j and %j differ', (pattern, key, text, short) => {
    expect(wordsOf(pattern, key)).toEqual({ text, short });
  });

  it('says that a key is too short, and that only a # can stand for no words', () => {
    expect(wordsOf('a.b.c', 'a.b')).toEqual({
      text: 'The pattern "a.b.c" does not match the key "a.b": the pattern has 3 words, so the key needs 3, and it has 2.',
      short: 'needs 3 words, has 2',
    });
    expect(wordsOf('a.#.b', 'a')).toEqual({
      text: 'The pattern "a.#.b" does not match the key "a": it needs at least 2 words, because a "#" can take any number of words but every other word of the pattern needs a word of the key, and the key has 1.',
      short: 'needs 2 or more words, has 1',
    });
  });

  it('says that an empty key has no words at all, which is why a * does not match it', () => {
    expect(wordsOf('*', '')).toEqual({
      text: 'The pattern "*" does not match the empty key: the pattern has 1 word, so the key needs 1, and it has 0. An empty key has no words at all, and even a "*" needs a word (the key "a." has two, the second of them empty).',
      short: 'needs 1 words, has 0',
    });
    // Without a * in the pattern the note has nothing to explain.
    expect(wordsOf('a.b', '').text).not.toContain('An empty key');
    expect(wordsOf('#.a', '').text).not.toContain('An empty key');
  });

  it('says that a key has words that a pattern with no # has no place for', () => {
    expect(wordsOf('a.b', 'a.b.c')).toEqual({
      text: 'The pattern "a.b" does not match the key "a.b.c": the pattern has 2 words and the key has 3, and without a "#" the key has to have as many words as the pattern.',
      short: 'key has 3 words, pattern 2',
    });
    expect(wordsOf('', 'a').text).toBe(
      'The empty pattern does not match the key "a": the pattern has 0 words and the key has 1, and without a "#" the key has to have as many words as the pattern.',
    );
  });

  it('says that the words between two # are not in the key', () => {
    expect(wordsOf('a.#.b.c.#.d', 'a.x.y.d')).toEqual({
      text: 'The pattern "a.#.b.c.#.d" does not match the key "a.x.y.d": "b.c" has to come between the two "#", after the start of the key and before its end, and it is not there.',
      short: '"b.c" is nowhere between the ends',
    });
  });

  it('keeps the short reason within the room that an edge has, however long the words are', () => {
    const long = 'w'.repeat(100);
    const { short } = wordsOf(`a.${long}`, 'a.b');

    expect([...short].length).toBeLessThanOrEqual(SHORT_MOST);
    expect(short.endsWith('…')).toBe(true);
  });

  it('gives a sentence and a short reason for any pattern and key, and a short reason that fits', () => {
    const arbWord = fc.constantFrom('a', 'b', '', '*', '#', 'a*', 'ab', 'a'.repeat(60));
    const arbPattern = fc
      .array(arbWord, { maxLength: 5 })
      .map((list) => list.join('.'))
      .filter((text) => splitTopic(text).filter((word) => word === '#').length <= TOPIC_MAX_HASH_WORDS);
    const arbKey = fc.array(fc.constantFrom('a', 'b', '', 'ab', '*'), { maxLength: 6 }).map((list) => list.join('.'));

    fc.assert(
      fc.property(arbPattern, arbKey, (pattern, key) => {
        const { text, short } = wordsOf(pattern, key);

        expect(text.endsWith('.')).toBe(true);
        expect(short).not.toBe('');
        expect([...short].length).toBeLessThanOrEqual(SHORT_MOST);
        expect(wordsOf(pattern, key)).toEqual({ text, short });
      }),
    );
  });
});
